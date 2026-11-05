# Todo Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `todos` + `dashboard` reference monorepo from the design spec: shared zod contracts, `Result<T,E>`, cross-slice `fanOut` with partial results, Otel tracing, and Playwright e2e with seeded fixtures.

**Architecture:** pnpm workspace with `@repo/shared` (Result + contracts), an Express API split into two vertical slices (`todos`, `dashboard`), and a Vite React app. The dashboard fans out over the todos repo, a stats provider, and an activity ring buffer. E2E uses a test-only seed API guarded by `E2E=true` with request-scoped partitions.

**Tech Stack:** TypeScript 5, pnpm 9, Node 20+, Express 4, Zod 3, React 18, Vite 5, TanStack Query 5, Vitest 2, Testing Library, Playwright, OpenTelemetry JS.

**Spec:** `docs/superpowers/specs/2026-11-04-todo-web-app-design.md`

## Global Constraints

- ESM everywhere: `"type": "module"`; relative imports end in `.js`; `module`/`moduleResolution` are `NodeNext` in Node packages.
- Node >= 20, pnpm 9. Dependency majors: TypeScript 5, Express 4, React 18, Vite 5, Zod 3, TanStack Query 5, Vitest 2, Playwright 1.x, OpenTelemetry JS 1.x.
- Types crossing API ↔ web live only in `packages/shared/src/contracts/`; never declare a DTO elsewhere.
- Expected errors travel as `Result<T, DomainError>`; never throw across layers. Controllers map `Err` to HTTP and validate with `safeParse`.
- Use `apps/api/src/shared/fanOut.ts`; never raw `Promise.all`/`allSettled`.
- Never `console.log`; use the logger. Otel import is line 1 of `server.ts`.
- Every usecase opens a span; every `Result.Err` sets span status ERROR.
- Test order: usecase → contract → web component → e2e. Never run e2e before unit/contract tests pass.
- E2E: `data-testid` only; seed only through `POST /api/test/seed` when `E2E=true`.
- Shared must be built before api/web typecheck, tests, dev, or Playwright boots. Root scripts handle it; direct package commands need a prior `pnpm --filter @repo/shared build`.
- Files stay under 250 lines; feature folders stay at or below 8 files.

## Review Focus

Inputs/conditions the spec implies but tests must pin explicitly (tests are added in the owning task):

1. Whitespace-only or >200-char title → 400 `VALIDATION_ERROR` (Task 7 controller test). The composer trims before enabling, sends via the contract, and clears only on success (Task 11 page implementation).
2. Deleting an already-deleted todo → 404 rendered as an inline error, not a stuck pending state (Task 7 controller test, Task 11 page test).
3. `STATS_URL` returns malformed JSON or a 500 → dashboard is partial with a warning, never a crash (Task 8 stats test).
4. Unknown/stale `x-e2e-seed-id` → 404 JSON, never a write into another partition or the default store (Task 10 test).
5. API/keyboard/proxy returns non-JSON or offline → web shows the generic error message instead of throwing a JSON parse error (Task 11 fetch-client/page test).

## File Map

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore, .env.example
docker-compose.yml, otel-collector-config.yaml
scripts/gen-feature.mjs

packages/shared/src/{result.ts,index.ts}
packages/shared/src/contracts/{todos,dashboard,error,test-seed}.contract.ts

apps/api/src/{app.ts,server.ts}
apps/api/src/shared/{http.ts,errors.ts,fanOut.ts,httpClient.ts,activityLog.ts,e2e.ts}
apps/api/src/shared/observability/{otel.ts,logger.ts,tracing.ts}
apps/api/src/features/todos/{domain.ts,repo.ts,usecase.ts,controller.ts}
apps/api/src/features/dashboard/{stats.ts,usecase.ts,controller.ts}

apps/web/src/{main.tsx,App.tsx,styles.css}
apps/web/src/lib/{api.ts,queryClient.ts}
apps/web/src/features/todos/{todos.api.ts,todos.query.ts,TodosPage.tsx}
apps/web/src/features/dashboard/{dashboard.api.ts,dashboard.query.ts,DashboardPage.tsx}
apps/web/playwright.config.ts
apps/web/e2e/{global-setup.ts,global-teardown.ts,fixtures/seeded.ts}
apps/web/e2e/features/{todos,dashboard}/*.e2e.ts
```

---

### Task 1: Monorepo scaffold + `Result`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/tsconfig.build.json`
- Create: `packages/shared/src/result.ts`, `packages/shared/src/result.test.ts`, `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `Ok<T>(value): Ok<T>`, `Err<E>(error): Err<E>`, `isOk`, `isErr`, `Result<T,E>`, `DomainError`, `Ok`, `Err` types.

- [ ] **Step 1: Create workspace files**

`package.json`
```json
{
  "name": "ts-ri",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "pnpm --filter @repo/shared build && concurrently -n shared,api,web -c blue,green,magenta \"pnpm --filter @repo/shared dev\" \"pnpm --filter api dev\" \"pnpm --filter web dev\"",
    "build": "pnpm --filter @repo/shared build && pnpm --filter web build && pnpm --filter api build",
    "start": "NODE_ENV=production node apps/api/dist/server.js",
    "test": "pnpm --filter @repo/shared build && pnpm --filter @repo/shared test && pnpm --filter api test && pnpm --filter api test:contract && pnpm --filter web test",
    "test:contract": "pnpm --filter api test:contract",
    "e2e": "pnpm --filter @repo/shared build && pnpm --filter web exec playwright test",
    "gen": "node scripts/gen-feature.mjs",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": { "concurrently": "^9.1.0" }
}
```

`pnpm-workspace.yaml`
```yaml
packages:
  - apps/*
  - packages/*
```

`tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

`.gitignore`
```
node_modules
dist
.env
*.tsbuildinfo
coverage
playwright-report
test-results
.e2e-global-seed.json
```

`.env.example`
```
PORT=3000
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
FAIL_STATS=0
STATS_URL=
E2E=0
```

- [ ] **Step 2: Create the shared package config**

`packages/shared/package.json`
```json
{
  "name": "@repo/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsc -p tsconfig.build.json --watch --preserveWatchOutput",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^2.1.4" }
}
```

`packages/shared/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`packages/shared/tsconfig.build.json`
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false },
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Write the failing `Result` test**

`packages/shared/src/result.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { Err, Ok, isErr, isOk, type DomainError, type Result } from './result.js'

describe('Result', () => {
  it('wraps success values', () => {
    const result = Ok(42)
    expect(result).toEqual({ ok: true, value: 42 })
  })

  it('wraps domain errors', () => {
    const error: DomainError = { code: 'NOT_FOUND', message: 'missing', status: 404 }
    expect(Err(error)).toEqual({ ok: false, error })
  })

  it('narrows to the value branch', () => {
    const result: Result<number> = Ok(1)
    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value).toBe(1)
  })

  it('narrows to the error branch', () => {
    const result: Result<number> = Err({ code: 'X', message: 'x', status: 500 })
    if (!isErr(result)) throw new Error('expected err')
    expect(result.error.code).toBe('X')
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @repo/shared test`
Expected: FAIL — cannot resolve `./result.js`.

- [ ] **Step 5: Implement `Result`**

`packages/shared/src/result.ts`
```ts
export interface DomainError {
  code: string
  message: string
  status: number
  details?: unknown
}

export type Ok<T> = { ok: true; value: T }
export type Err<E = DomainError> = { ok: false; error: E }
export type Result<T, E = DomainError> = Ok<T> | Err<E>

export const Ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const Err = <E = DomainError>(error: E): Err<E> => ({ ok: false, error })

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok
```

`packages/shared/src/index.ts`
```ts
export * from './result.js'
```

- [ ] **Step 6: Install and verify**

Run: `pnpm install`
Then: `pnpm --filter @repo/shared build && pnpm --filter @repo/shared test`
Expected: build succeeds; 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "build: scaffold pnpm workspace and shared result type"
```

---

### Task 2: Shared contracts

**Files:**
- Create: `packages/shared/src/contracts/todos.contract.ts`
- Create: `packages/shared/src/contracts/dashboard.contract.ts`
- Create: `packages/shared/src/contracts/error.contract.ts`
- Create: `packages/shared/src/contracts/test-seed.contract.ts`
- Create: `packages/shared/src/contracts/todos.contract.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `TodoSchema`, `Todo`, `TodoFilter`, `TodoFilterSchema`, `TodoIdParamsSchema`, `CreateTodoInputSchema`, `CreateTodoInput`, `UpdateTodoInputSchema`, `UpdateTodoInput`, `ListTodosQuerySchema`, `ListTodosQuery`, `ListTodosOutputSchema`, `ListTodosOutput`, `TodoOutputSchema`, `TodoOutput`, `DeleteTodoOutputSchema`, `DeleteTodoOutput`.
- Produces: `StatsSchema`, `Stats`, `ActivityEntrySchema`, `ActivityEntry`, `DashboardOutputSchema`, `DashboardOutput`.
- Produces: `ApiErrorSchema`, `ApiError`, `SeedInputSchema`, `SeedInput`, `SeedOutputSchema`, `SeedOutput`.

- [ ] **Step 1: Write the failing contract test**

`packages/shared/src/contracts/todos.contract.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { CreateTodoInputSchema, ListTodosQuerySchema } from './todos.contract.js'

describe('todos contracts', () => {
  it('trims a valid title', () => {
    expect(CreateTodoInputSchema.parse({ title: '  Buy milk  ' }).title).toBe('Buy milk')
  })

  it('rejects a whitespace-only title', () => {
    expect(CreateTodoInputSchema.safeParse({ title: '   ' }).success).toBe(false)
  })

  it('rejects titles over 200 characters', () => {
    expect(CreateTodoInputSchema.safeParse({ title: 'x'.repeat(201) }).success).toBe(false)
  })

  it('defaults the filter to all', () => {
    expect(ListTodosQuerySchema.parse({}).filter).toBe('all')
  })

  it('rejects an unknown filter', () => {
    expect(ListTodosQuerySchema.safeParse({ filter: 'later' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @repo/shared test`
Expected: FAIL — cannot resolve `./todos.contract.js`.

- [ ] **Step 3: Implement the contracts**

`packages/shared/src/contracts/todos.contract.ts`
```ts
import { z } from 'zod'

export const TodoFilterSchema = z.enum(['all', 'active', 'done'])
export type TodoFilter = z.infer<typeof TodoFilterSchema>

export const TodoSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  completed: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Todo = z.infer<typeof TodoSchema>

export const TodoIdParamsSchema = z.object({ id: z.string().min(1) })
export type TodoIdParams = z.infer<typeof TodoIdParamsSchema>

export const CreateTodoInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
})
export type CreateTodoInput = z.infer<typeof CreateTodoInputSchema>

export const UpdateTodoInputSchema = z.object({ completed: z.boolean() })
export type UpdateTodoInput = z.infer<typeof UpdateTodoInputSchema>

export const ListTodosQuerySchema = z.object({ filter: TodoFilterSchema.default('all') })
export type ListTodosQuery = z.infer<typeof ListTodosQuerySchema>

export const ListTodosOutputSchema = z.object({ todos: z.array(TodoSchema) })
export type ListTodosOutput = z.infer<typeof ListTodosOutputSchema>

export const TodoOutputSchema = z.object({ todo: TodoSchema })
export type TodoOutput = z.infer<typeof TodoOutputSchema>

export const DeleteTodoOutputSchema = z.object({ id: z.string().min(1) })
export type DeleteTodoOutput = z.infer<typeof DeleteTodoOutputSchema>
```

`packages/shared/src/contracts/dashboard.contract.ts`
```ts
import { z } from 'zod'
import { TodoSchema } from './todos.contract.js'

export const StatsSchema = z.object({
  total: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  completionRate: z.number().min(0).max(1),
})
export type Stats = z.infer<typeof StatsSchema>

export const ActivityTypeSchema = z.enum(['created', 'completed', 'reopened', 'deleted'])

export const ActivityEntrySchema = z.object({
  id: z.string().min(1),
  type: ActivityTypeSchema,
  todoId: z.string().min(1),
  title: z.string().min(1),
  at: z.string().datetime(),
})
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>

export const DashboardOutputSchema = z.object({
  todos: z.array(TodoSchema),
  stats: StatsSchema.nullable(),
  activity: z.array(ActivityEntrySchema).nullable(),
  meta: z.object({
    partial: z.boolean(),
    warnings: z.array(z.string()),
    failedTasks: z.array(z.string()),
  }),
})
export type DashboardOutput = z.infer<typeof DashboardOutputSchema>
```

`packages/shared/src/contracts/error.contract.ts`
```ts
import { z } from 'zod'

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})
export type ApiError = z.infer<typeof ApiErrorSchema>
```

`packages/shared/src/contracts/test-seed.contract.ts`
```ts
import { z } from 'zod'

export const SeedInputSchema = z.object({
  todos: z.array(z.string().trim().min(1).max(200)).optional(),
})
export type SeedInput = z.infer<typeof SeedInputSchema>

export const SeedOutputSchema = z.object({ id: z.string().min(1) })
export type SeedOutput = z.infer<typeof SeedOutputSchema>
```

`packages/shared/src/index.ts`
```ts
export * from './result.js'
export * from './contracts/todos.contract.js'
export * from './contracts/dashboard.contract.js'
export * from './contracts/error.contract.js'
export * from './contracts/test-seed.contract.js'
```

- [ ] **Step 4: Run tests and build**

Run: `pnpm --filter @repo/shared test && pnpm --filter @repo/shared build`
Expected: all tests PASS, `dist/index.d.ts` exists.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add todo, dashboard, error, and seed contracts"
```

---

### Task 3: API shell, observability, health

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`
- Create: `apps/api/src/shared/observability/{otel.ts,logger.ts,tracing.ts}`
- Create: `apps/api/src/shared/{http.ts,errors.ts}`
- Create: `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/app.test.ts`
- Create: `docker-compose.yml`, `otel-collector-config.yaml`

**Interfaces:**
- Produces: `createApp(deps?: AppDeps): Express`, `sendResult(res, result, successStatus?)`, `asyncHandler(fn)`, `logger.info|warn|error`, `runSpan(name, fn, attributes?)`.
- Produces: error constructors `validationError`, `notFoundError`, `dashboardUnavailable`, `internalError`.
- Produces: `AppDeps` with optional `webDist?: string` (extended in later tasks).

- [ ] **Step 1: Write the failing app test**

`apps/api/src/app.test.ts`
```ts
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'

describe('app shell', () => {
  it('reports health', async () => {
    const res = await request(createApp()).get('/api/v1/health').expect(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(createApp()).get('/api/nope').expect(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('maps malformed JSON to a validation error', async () => {
    const res = await request(createApp())
      .post('/api/v1/todos')
      .set('content-type', 'application/json')
      .send('{bad')
      .expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter api test`
Expected: FAIL — `Cannot find module './app.js'`.

- [ ] **Step 3: Create package and compiler config**

`apps/api/package.json`
```json
{
  "name": "api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "test": "vitest run --exclude '**/*.controller.test.ts'",
    "test:contract": "vitest run controller.test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/auto-instrumentations-node": "^0.53.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.55.0",
    "@opentelemetry/sdk-node": "^0.55.0",
    "@repo/shared": "workspace:*",
    "express": "^4.21.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.9.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

`apps/api/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

`apps/api/tsconfig.build.json`
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false },
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 4: Implement shared HTTP/error/logging/tracing helpers**

`apps/api/src/shared/errors.ts`
```ts
import type { DomainError } from '@repo/shared'

export const validationError = (message: string, details?: unknown): DomainError => ({
  code: 'VALIDATION_ERROR', message, status: 400, details,
})

export const notFoundError = (message: string): DomainError => ({
  code: 'NOT_FOUND', message, status: 404,
})

export const dashboardUnavailable = (): DomainError => ({
  code: 'DASHBOARD_UNAVAILABLE', message: 'Dashboard is temporarily unavailable', status: 503,
})

export const internalError = (message = 'Internal server error'): DomainError => ({
  code: 'INTERNAL', message, status: 500,
})
```

`apps/api/src/shared/http.ts`
```ts
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { Result } from '@repo/shared'

export function sendResult<T>(res: Response, result: Result<T>, successStatus = 200): void {
  if (result.ok) {
    res.status(successStatus).json(result.value)
    return
  }
  const { code, message, details } = result.error
  res.status(result.error.status).json({
    error: details === undefined ? { code, message } : { code, message, details },
  })
}

export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next)
  }
}
```

`apps/api/src/shared/observability/logger.ts`
```ts
import { trace } from '@opentelemetry/api'

type Fields = Record<string, unknown>

function write(level: 'info' | 'warn' | 'error', message: string, fields: Fields = {}): void {
  const span = trace.getActiveSpan()?.spanContext()
  process.stdout.write(
    `${JSON.stringify({ level, message, trace_id: span?.traceId, span_id: span?.spanId, ...fields })}\n`,
  )
}

export const logger = {
  info: (message: string, fields?: Fields) => write('info', message, fields),
  warn: (message: string, fields?: Fields) => write('warn', message, fields),
  error: (message: string, fields?: Fields) => write('error', message, fields),
}
```

`apps/api/src/shared/observability/tracing.ts`
```ts
import { SpanStatusCode, trace, type Attributes } from '@opentelemetry/api'
import type { Result } from '@repo/shared'

const tracer = trace.getTracer('todo-api')

export async function runSpan<T>(
  name: string,
  fn: () => Promise<Result<T>>,
  attributes: Attributes = {},
): Promise<Result<T>> {
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attributes)
    try {
      const result = await fn()
      if (!result.ok) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: result.error.message })
        span.recordException({ name: result.error.code, message: result.error.message })
      }
      return result
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'unknown error',
      })
      span.recordException(error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      span.end()
    }
  })
}
```

`apps/api/src/shared/observability/otel.ts`
```ts
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { NodeSDK } from '@opentelemetry/sdk-node'

if (process.env.OTEL_TRACES_EXPORTER !== 'none' && process.env.NODE_ENV !== 'test') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'
  const sdk = new NodeSDK({
    serviceName: 'todo-api',
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
    ],
  })
  sdk.start()
  process.on('SIGTERM', () => {
    void sdk.shutdown()
  })
}
```

- [ ] **Step 5: Implement the app and server**

`apps/api/src/app.ts`
```ts
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { logger } from './shared/observability/logger.js'

export interface AppDeps {
  webDist?: string
}

export function createApp(_deps: AppDeps = {}): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json())

  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found' } })
  })

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } })
      return
    }
    logger.error('unhandled request error', {
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } })
  })

  return app
}
```

`apps/api/src/server.ts`
```ts
import './shared/observability/otel.js'
import { createApp } from './app.js'
import { logger } from './shared/observability/logger.js'

const port = Number(process.env.PORT ?? 3000)
const app = createApp()

app.listen(port, () => {
  logger.info('api listening', { port })
})
```

- [ ] **Step 6: Add the local trace collector**

`docker-compose.yml`
```yaml
services:
  jaeger:
    image: jaegertracing/all-in-one:1.57
    environment:
      - COLLECTOR_OTLP_ENABLED=true
    ports:
      - "16686:16686"
      - "4317:4317"

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.111.0
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml:ro
    ports:
      - "4318:4318"
    depends_on:
      - jaeger
```

`otel-collector-config.yaml`
```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlp:
    endpoint: jaeger:4317
    tls:
      insecure: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlp]
```

- [ ] **Step 7: Verify**

Run: `pnpm install && pnpm --filter @repo/shared build && pnpm --filter api test`
Expected: 3 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api package.json pnpm-lock.yaml docker-compose.yml otel-collector-config.yaml
git commit -m "feat(api): add express shell, result-to-http mapping, and otel bootstrap"
```

---

### Task 4: `fanOut` and `httpClient`

**Files:**
- Create: `apps/api/src/shared/fanOut.ts`, `apps/api/src/shared/fanOut.test.ts`
- Create: `apps/api/src/shared/httpClient.ts`, `apps/api/src/shared/httpClient.test.ts`

**Interfaces:**
- Produces: `fanOut<T extends FanOutTasks>(tasks, opts?): Promise<Result<FanOutResult<T>>>`, `FanOutTask<T>`, `FanOutTasks`, `FanOutData<T>`, `FanOutResult<T>`.
- Produces: `httpGetJson<T>(url, opts?): Promise<Result<T>>`.

- [ ] **Step 1: Write the failing `fanOut` tests**

`apps/api/src/shared/fanOut.test.ts`
```ts
import { Err, Ok } from '@repo/shared'
import { describe, expect, it } from 'vitest'
import { fanOut } from './fanOut.js'

describe('fanOut', () => {
  it('returns all values when every task succeeds', async () => {
    const result = await fanOut({
      user: { run: async () => Ok('pat'), critical: true },
      orders: { run: async () => Ok([1, 2]) },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.data).toEqual({ user: 'pat', orders: [1, 2] })
    expect(result.value.partial).toBe(false)
    expect(result.value.warnings).toEqual([])
  })

  it('returns partial data when a degradable task fails', async () => {
    const result = await fanOut({
      todos: { run: async () => Ok(['a']) },
      stats: { run: async () => Err({ code: 'STATS_DOWN', message: 'stats down', status: 503 }) },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.data).toEqual({ todos: ['a'] })
    expect(result.value.partial).toBe(true)
    expect(result.value.failedTasks).toEqual(['stats'])
    expect(result.value.warnings[0]).toContain('stats')
  })

  it('aborts siblings and fails when a critical task fails', async () => {
    let siblingAborted = false
    const result = await fanOut({
      todos: {
        run: async () => Err({ code: 'DB_DOWN', message: 'db down', status: 503 }),
        critical: true,
      },
      activity: {
        run: (signal) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => {
              siblingAborted = true
              resolve(Ok([]))
            })
          }),
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('DB_DOWN')
    expect(siblingAborted).toBe(true)
  })

  it('marks a timed-out task as failed', async () => {
    const result = await fanOut({
      todos: { run: async () => Ok(['a']) },
      slow: {
        run: () => new Promise(() => undefined),
        timeoutMs: 10,
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.partial).toBe(true)
    expect(result.value.failedTasks).toEqual(['slow'])
    expect(result.value.warnings[0]).toContain('timed out')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api test fanOut`
Expected: FAIL — cannot resolve `./fanOut.js`.

- [ ] **Step 3: Implement `fanOut`**

`apps/api/src/shared/fanOut.ts`
```ts
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { Err, Ok, type DomainError, type Result } from '@repo/shared'
import { internalError } from './errors.js'

export type FanOutTask<T> = {
  run: (signal: AbortSignal) => Promise<Result<T>>
  critical?: boolean
  timeoutMs?: number
}

export type FanOutTasks = Record<string, FanOutTask<unknown>>

type TaskValue<T> = T extends FanOutTask<infer V> ? V : never
export type FanOutData<T extends FanOutTasks> = { [K in keyof T]: TaskValue<T[K]> }

export interface FanOutResult<T extends FanOutTasks> {
  data: Partial<FanOutData<T>>
  warnings: string[]
  failedTasks: string[]
  partial: boolean
}

interface TaskOutcome {
  name: string
  critical: boolean
  result: Result<unknown>
}

async function execute(
  name: string,
  task: FanOutTask<unknown>,
  sharedSignal: AbortSignal,
): Promise<TaskOutcome> {
  const local = new AbortController()
  const signal = AbortSignal.any([sharedSignal, local.signal])
  const timeoutMs = task.timeoutMs ?? 2000
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<Result<unknown>>((resolve) => {
    timer = setTimeout(() => {
      local.abort()
      resolve(Err({ code: 'TIMEOUT', message: `Task "${name}" timed out after ${timeoutMs}ms`, status: 503 }))
    }, timeoutMs)
  })

  const run = (async (): Promise<Result<unknown>> => {
    try {
      return await task.run(signal)
    } catch (error) {
      return Err(internalError(error instanceof Error ? error.message : `Task "${name}" failed`))
    }
  })()

  const result = await Promise.race([run, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })

  return { name, critical: task.critical === true, result }
}

export async function fanOut<T extends FanOutTasks>(
  tasks: T,
  opts: { abortOnCritical?: boolean } = {},
): Promise<Result<FanOutResult<T>>> {
  const tracer = trace.getTracer('todo-api')
  return tracer.startActiveSpan('fanOut', async (span) => {
    const names = Object.keys(tasks)
    const shared = new AbortController()
    const abortOnCritical = opts.abortOnCritical !== false
    const outcomes = await Promise.all(
      names.map(async (name) => {
        const outcome = await execute(name, tasks[name]!, shared.signal)
        if (abortOnCritical && outcome.critical && !outcome.result.ok) {
          shared.abort()
        }
        return outcome
      }),
    )

    const critical = outcomes.find((outcome) => outcome.critical && !outcome.result.ok)
    if (critical) {
      const error = critical.result.ok
        ? internalError()
        : (critical.result.error as DomainError)
      span.setAttributes({ tasks: names.join(','), failed_tasks: critical.name, partial: false })
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
      span.end()
      return Err(error)
    }

    const data: Partial<FanOutData<T>> = {}
    const warnings: string[] = []
    const failedTasks: string[] = []

    for (const outcome of outcomes) {
      if (outcome.result.ok) {
        ;(data as Record<string, unknown>)[outcome.name] = outcome.result.value
        continue
      }
      failedTasks.push(outcome.name)
      warnings.push(`${outcome.name} unavailable: ${outcome.result.error.message}`)
    }

    const partial = failedTasks.length > 0
    span.setAttributes({
      tasks: names.join(','),
      failed_tasks: failedTasks.join(','),
      partial,
    })
    span.end()
    return Ok({ data, warnings, failedTasks, partial })
  })
}
```

- [ ] **Step 4: Write the failing `httpClient` tests**

`apps/api/src/shared/httpClient.test.ts`
```ts
import { describe, expect, it, vi } from 'vitest'
import { httpGetJson } from './httpClient.js'

describe('httpGetJson', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"total":2}', { status: 200 })))
    const result = await httpGetJson<{ total: number }>('http://stats.local/stats')
    expect(result).toEqual({ ok: true, value: { total: 2 } })
  })

  it('maps non-2xx responses to UPSTREAM_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const result = await httpGetJson('http://stats.local/stats')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('UPSTREAM_ERROR')
  })

  it('maps network failures to UPSTREAM_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const result = await httpGetJson('http://stats.local/stats')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('UPSTREAM_UNAVAILABLE')
    expect(result.error.message).toContain('offline')
  })
})
```

- [ ] **Step 5: Run to verify failure**

Run: `pnpm --filter api test httpClient`
Expected: FAIL — cannot resolve `./httpClient.js`.

- [ ] **Step 6: Implement `httpGetJson`**

`apps/api/src/shared/httpClient.ts`
```ts
import { Err, Ok, type Result } from '@repo/shared'

export async function httpGetJson<T>(
  url: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Result<T>> {
  const timeoutMs = opts.timeoutMs ?? 2000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onAbort)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      return Err({
        code: 'UPSTREAM_ERROR',
        message: `GET ${url} returned ${response.status}`,
        status: 502,
      })
    }
    return Ok((await response.json()) as T)
  } catch (error) {
    return Err({
      code: 'UPSTREAM_UNAVAILABLE',
      message: error instanceof Error ? error.message : `GET ${url} failed`,
      status: 503,
    })
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm --filter api test fanOut httpClient`
Expected: all tests PASS.

```bash
git add apps/api/src/shared
git commit -m "feat(api): add fanOut with partial results and result-based http client"
```

---

### Task 5: Todos domain, repository, activity log, E2E context

**Files:**
- Create: `apps/api/src/features/todos/domain.ts`
- Create: `apps/api/src/features/todos/repo.ts`
- Create: `apps/api/src/features/todos/repo.test.ts`
- Create: `apps/api/src/shared/activityLog.ts`
- Create: `apps/api/src/shared/e2e.ts` (context only; routes added in Task 10)

**Interfaces:**
- Produces: `makeTodo(title, now?): Todo`, `SEED_TITLES`.
- Produces: `TodosRepo` with `list(filter)`, `findById(id)`, `create(input)`, `setCompleted(id, completed)`, `remove(id)`; `createMemoryTodosRepo(seedTitles?)`.
- Produces: `ActivityLog` with `append(entry)` and `recent(limit?)`; `createActivityLog()`.
- Produces: `E2EContext`, `currentE2EContext()`, `runWithE2EContext(context, fn)`.

- [ ] **Step 1: Write the failing repo test**

`apps/api/src/features/todos/repo.test.ts`
```ts
import type { ActivityEntry } from '@repo/shared'
import { describe, expect, it } from 'vitest'
import { createActivityLog } from '../../shared/activityLog.js'
import { createMemoryTodosRepo } from './repo.js'

describe('memory todos repo', () => {
  it('seeds todos and filters them', async () => {
    const repo = createMemoryTodosRepo(['one', 'two'])
    const all = await repo.list('all')
    expect(all.ok).toBe(true)
    if (!all.ok) return
    expect(all.value.map((todo) => todo.title)).toEqual(['one', 'two'])

    const first = all.value[0]!
    await repo.setCompleted(first.id, true)
    const active = await repo.list('active')
    const done = await repo.list('done')
    expect(active.ok && active.value.map((todo) => todo.title)).toEqual(['two'])
    expect(done.ok && done.value.map((todo) => todo.title)).toEqual(['one'])
  })

  it('creates a todo with timestamps', async () => {
    const repo = createMemoryTodosRepo([])
    const result = await repo.create({ title: 'new task' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.title).toBe('new task')
    expect(result.value.completed).toBe(false)
    expect(result.value.createdAt).toBe(result.value.updatedAt)
  })

  it('updates completed and updatedAt', async () => {
    const repo = createMemoryTodosRepo([])
    const created = await repo.create({ title: 'task' })
    if (!created.ok) throw new Error('create failed')
    const updated = await repo.setCompleted(created.value.id, true)
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.value.completed).toBe(true)
    expect(updated.value.updatedAt >= updated.value.createdAt).toBe(true)
  })

  it('returns NOT_FOUND for missing todos', async () => {
    const repo = createMemoryTodosRepo([])
    const found = await repo.findById('missing')
    const removed = await repo.remove('missing')
    expect(found.ok).toBe(false)
    expect(removed.ok).toBe(false)
    if (!removed.ok) expect(removed.error.status).toBe(404)
  })
})

describe('activity log', () => {
  const entry = (id: string): ActivityEntry => ({
    id,
    type: 'created',
    todoId: id,
    title: `todo ${id}`,
    at: '2026-01-01T00:00:00.000Z',
  })

  it('returns newest entries first', () => {
    const log = createActivityLog()
    log.append(entry('1'))
    log.append(entry('2'))
    expect(log.recent().map((item) => item.id)).toEqual(['2', '1'])
  })

  it('caps the ring buffer at 50 entries', () => {
    const log = createActivityLog()
    for (let index = 0; index < 60; index += 1) log.append(entry(String(index)))
    const recent = log.recent(50)
    expect(recent).toHaveLength(50)
    expect(recent[0]?.id).toBe('59')
    expect(recent[49]?.id).toBe('10')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api test repo`
Expected: FAIL — cannot resolve `./repo.js`.

- [ ] **Step 3: Implement domain, E2E context, activity log, repo**

`apps/api/src/features/todos/domain.ts`
```ts
import { randomUUID } from 'node:crypto'
import type { Todo } from '@repo/shared'

export const SEED_TITLES = ['Read AGENTS.md', 'Ship the reference app', 'Buy milk'] as const

export function makeTodo(title: string, now = new Date()): Todo {
  const timestamp = now.toISOString()
  return { id: randomUUID(), title, completed: false, createdAt: timestamp, updatedAt: timestamp }
}
```

`apps/api/src/shared/e2e.ts`
```ts
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ActivityEntry, Todo } from '@repo/shared'

export interface E2EContext {
  todos: Map<string, Todo>
  activity: ActivityEntry[]
}

const storage = new AsyncLocalStorage<E2EContext>()

export const currentE2EContext = (): E2EContext | undefined => storage.getStore()

export function runWithE2EContext<T>(context: E2EContext, fn: () => T): T {
  return storage.run(context, fn)
}
```

`apps/api/src/shared/activityLog.ts`
```ts
import type { ActivityEntry } from '@repo/shared'
import { currentE2EContext } from './e2e.js'

export interface ActivityLog {
  append(entry: ActivityEntry): void
  recent(limit?: number): ActivityEntry[]
}

export function createActivityLog(): ActivityLog {
  const entries: ActivityEntry[] = []
  const active = (): ActivityEntry[] => currentE2EContext()?.activity ?? entries

  return {
    append(entry) {
      const log = active()
      log.push(entry)
      if (log.length > 50) log.shift()
    },
    recent(limit = 10) {
      return active().slice(-limit).reverse()
    },
  }
}
```

`apps/api/src/features/todos/repo.ts`
```ts
import { Err, Ok, type CreateTodoInput, type Result, type Todo, type TodoFilter } from '@repo/shared'
import { notFoundError } from '../../shared/errors.js'
import { currentE2EContext } from '../../shared/e2e.js'
import { makeTodo, SEED_TITLES } from './domain.js'

export interface TodosRepo {
  list(filter: TodoFilter): Promise<Result<Todo[]>>
  findById(id: string): Promise<Result<Todo>>
  create(input: CreateTodoInput): Promise<Result<Todo>>
  setCompleted(id: string, completed: boolean): Promise<Result<Todo>>
  remove(id: string): Promise<Result<string>>
}

export function createMemoryTodosRepo(seedTitles: readonly string[] = SEED_TITLES): TodosRepo {
  const defaultStore = new Map<string, Todo>()
  for (const title of seedTitles) {
    const todo = makeTodo(title)
    defaultStore.set(todo.id, todo)
  }

  const store = (): Map<string, Todo> => currentE2EContext()?.todos ?? defaultStore

  return {
    async list(filter) {
      const todos = [...store().values()]
      if (filter === 'active') return Ok(todos.filter((todo) => !todo.completed))
      if (filter === 'done') return Ok(todos.filter((todo) => todo.completed))
      return Ok(todos)
    },

    async findById(id) {
      const todo = store().get(id)
      return todo ? Ok(todo) : Err(notFoundError(`Todo ${id} not found`))
    },

    async create(input) {
      const todo = makeTodo(input.title)
      store().set(todo.id, todo)
      return Ok(todo)
    },

    async setCompleted(id, completed) {
      const todo = store().get(id)
      if (!todo) return Err(notFoundError(`Todo ${id} not found`))
      const updated: Todo = { ...todo, completed, updatedAt: new Date().toISOString() }
      store().set(id, updated)
      return Ok(updated)
    },

    async remove(id) {
      return store().delete(id) ? Ok(id) : Err(notFoundError(`Todo ${id} not found`))
    },
  }
}
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter api test repo`
Expected: 6 tests PASS.

```bash
git add apps/api/src/features/todos apps/api/src/shared
git commit -m "feat(todos): add domain, in-memory repo, activity log, and e2e context"
```

---

### Task 6: Todos usecases

**Files:**
- Create: `apps/api/src/features/todos/usecase.ts`, `apps/api/src/features/todos/todos.test.ts`

**Interfaces:**
- Consumes: `TodosRepo`, `ActivityLog`, `runSpan`.
- Produces: `TodosUseCases` with `list(input)`, `create(input)`, `setCompleted(id, input)`, `remove(id)`; `createTodosUseCases({ repo, activityLog })`.
- Produces: activity entries of type `created`, `completed`, `reopened`, `deleted`.

- [ ] **Step 1: Write the failing usecase tests**

`apps/api/src/features/todos/todos.test.ts`
```ts
import { Err, Ok, type ActivityEntry, type Todo } from '@repo/shared'
import { describe, expect, it } from 'vitest'
import { createActivityLog } from '../../shared/activityLog.js'
import { notFoundError } from '../../shared/errors.js'
import { makeTodo } from './domain.js'
import type { TodosRepo } from './repo.js'
import { createTodosUseCases } from './usecase.js'

const sample = (id: string, title: string, completed = false): Todo => ({
  id, title, completed,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

function createFakeRepo(initial: Todo[] = []): TodosRepo {
  const todos = new Map(initial.map((todo) => [todo.id, todo]))
  return {
    list: async (filter) => {
      const values = [...todos.values()]
      if (filter === 'active') return Ok(values.filter((todo) => !todo.completed))
      if (filter === 'done') return Ok(values.filter((todo) => todo.completed))
      return Ok(values)
    },
    findById: async (id) => {
      const todo = todos.get(id)
      return todo ? Ok(todo) : Err(notFoundError('missing'))
    },
    create: async (input) => {
      const todo = makeTodo(input.title)
      todos.set(todo.id, todo)
      return Ok(todo)
    },
    setCompleted: async (id, completed) => {
      const todo = todos.get(id)
      if (!todo) return Err(notFoundError('missing'))
      const updated = { ...todo, completed }
      todos.set(id, updated)
      return Ok(updated)
    },
    remove: async (id) => (todos.delete(id) ? Ok(id) : Err(notFoundError('missing'))),
  }
}

describe('todos usecases', () => {
  it('lists todos through the repo', async () => {
    const repo = createFakeRepo([sample('1', 'a'), sample('2', 'b', true)])
    const useCases = createTodosUseCases({ repo, activityLog: createActivityLog() })

    const result = await useCases.list({ filter: 'active' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.todos.map((todo) => todo.title)).toEqual(['a'])
  })

  it('creates a todo and records activity', async () => {
    const repo = createFakeRepo()
    const activityLog = createActivityLog()
    const useCases = createTodosUseCases({ repo, activityLog })

    const result = await useCases.create({ title: 'write plan' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.todo.title).toBe('write plan')

    const activity: ActivityEntry[] = activityLog.recent()
    expect(activity[0]?.type).toBe('created')
    expect(activity[0]?.title).toBe('write plan')
  })

  it('records completed and reopened transitions', async () => {
    const repo = createFakeRepo([sample('1', 'a')])
    const activityLog = createActivityLog()
    const useCases = createTodosUseCases({ repo, activityLog })

    await useCases.setCompleted('1', { completed: true })
    await useCases.setCompleted('1', { completed: false })

    expect(activityLog.recent().map((entry) => entry.type)).toEqual([
      'reopened',
      'completed',
    ])
  })

  it('records the title before deleting', async () => {
    const repo = createFakeRepo([sample('1', 'gone soon')])
    const activityLog = createActivityLog()
    const useCases = createTodosUseCases({ repo, activityLog })

    const result = await useCases.remove('1')
    expect(result.ok).toBe(true)
    expect(activityLog.recent()[0]).toMatchObject({ type: 'deleted', title: 'gone soon' })
  })

  it('propagates NOT_FOUND from the repo', async () => {
    const useCases = createTodosUseCases({
      repo: createFakeRepo(),
      activityLog: createActivityLog(),
    })

    const result = await useCases.setCompleted('missing', { completed: true })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NOT_FOUND')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api test todos.test`
Expected: FAIL — cannot resolve `./usecase.js`.

- [ ] **Step 3: Implement the usecases**

`apps/api/src/features/todos/usecase.ts`
```ts
import { randomUUID } from 'node:crypto'
import {
  Ok,
  type CreateTodoInput,
  type DeleteTodoOutput,
  type ListTodosOutput,
  type ListTodosQuery,
  type Result,
  type TodoOutput,
  type UpdateTodoInput,
} from '@repo/shared'
import { runSpan } from '../../shared/observability/tracing.js'
import type { ActivityLog } from '../../shared/activityLog.js'
import type { TodosRepo } from './repo.js'

export interface TodosUseCases {
  list(input: ListTodosQuery): Promise<Result<ListTodosOutput>>
  create(input: CreateTodoInput): Promise<Result<TodoOutput>>
  setCompleted(id: string, input: UpdateTodoInput): Promise<Result<TodoOutput>>
  remove(id: string): Promise<Result<DeleteTodoOutput>>
}

export function createTodosUseCases(deps: {
  repo: TodosRepo
  activityLog: ActivityLog
}): TodosUseCases {
  return {
    list: (input) =>
      runSpan('ListTodosUseCase', async () => {
        const result = await deps.repo.list(input.filter)
        if (!result.ok) return result
        return Ok({ todos: result.value })
      }),

    create: (input) =>
      runSpan('CreateTodoUseCase', async () => {
        const result = await deps.repo.create(input)
        if (!result.ok) return result
        const todo = result.value
        deps.activityLog.append({
          id: randomUUID(),
          type: 'created',
          todoId: todo.id,
          title: todo.title,
          at: new Date().toISOString(),
        })
        return Ok({ todo })
      }),

    setCompleted: (id, input) =>
      runSpan('SetTodoCompletedUseCase', async () => {
        const before = await deps.repo.findById(id)
        if (!before.ok) return before
        const result = await deps.repo.setCompleted(id, input.completed)
        if (!result.ok) return result
        deps.activityLog.append({
          id: randomUUID(),
          type: input.completed ? 'completed' : 'reopened',
          todoId: id,
          title: result.value.title,
          at: new Date().toISOString(),
        })
        return Ok({ todo: result.value })
      }),

    remove: (id) =>
      runSpan('DeleteTodoUseCase', async () => {
        const before = await deps.repo.findById(id)
        if (!before.ok) return before
        const result = await deps.repo.remove(id)
        if (!result.ok) return result
        deps.activityLog.append({
          id: randomUUID(),
          type: 'deleted',
          todoId: id,
          title: before.value.title,
          at: new Date().toISOString(),
        })
        return Ok({ id: result.value })
      }),
  }
}
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter api test todos.test`
Expected: 5 tests PASS.

```bash
git add apps/api/src/features/todos
git commit -m "feat(todos): add usecases with spans and activity logging"
```

---

### Task 7: Todos controller, routes, and feature README

**Files:**
- Create: `apps/api/src/features/todos/controller.ts`, `apps/api/src/features/todos/todos.controller.test.ts`
- Create: `apps/api/src/features/todos/README.md`
- Modify: `apps/api/src/app.ts` (deps + mount todos router)
- Modify: `apps/api/src/app.test.ts` (pass deps)

**Interfaces:**
- Consumes: `TodosUseCases`, contracts, `sendResult`, `asyncHandler`, `validationError`.
- Produces: `createTodosController(useCases): Router`; `AppDeps` now requires `todosRepo` and `activityLog`.

- [ ] **Step 1: Write the failing contract tests**

`apps/api/src/features/todos/todos.controller.test.ts`
```ts
import {
  ApiErrorSchema, ListTodosOutputSchema, TodoOutputSchema,
} from '@repo/shared'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { createActivityLog } from '../../shared/activityLog.js'
import { createMemoryTodosRepo } from './repo.js'

function appWithTodos() {
  return createApp({
    todosRepo: createMemoryTodosRepo(['seeded']),
    activityLog: createActivityLog(),
  })
}

describe('todos controller', () => {
  it('lists todos with a contract-valid body', async () => {
    const res = await request(appWithTodos()).get('/api/v1/todos').expect(200)
    const parsed = ListTodosOutputSchema.safeParse(res.body)
    expect(parsed.success).toBe(true)
    expect(res.body.todos).toHaveLength(1)
  })

  it('rejects an unknown filter', async () => {
    const res = await request(appWithTodos()).get('/api/v1/todos?filter=later').expect(400)
    expect(ApiErrorSchema.safeParse(res.body).success).toBe(true)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('creates a todo with a contract-valid body', async () => {
    const res = await request(appWithTodos())
      .post('/api/v1/todos')
      .send({ title: '  write tests  ' })
      .expect(201)
    expect(TodoOutputSchema.safeParse(res.body).success).toBe(true)
    expect(res.body.todo.title).toBe('write tests')
  })

  it('rejects a blank title', async () => {
    const res = await request(appWithTodos())
      .post('/api/v1/todos')
      .send({ title: '   ' })
      .expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects a title over 200 characters', async () => {
    const res = await request(appWithTodos())
      .post('/api/v1/todos')
      .send({ title: 'x'.repeat(201) })
      .expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('updates completed and returns the todo', async () => {
    const app = appWithTodos()
    const list = await request(app).get('/api/v1/todos').expect(200)
    const id: string = list.body.todos[0].id

    const res = await request(app)
      .patch(`/api/v1/todos/${id}`)
      .send({ completed: true })
      .expect(200)
    expect(TodoOutputSchema.safeParse(res.body).success).toBe(true)
    expect(res.body.todo.completed).toBe(true)
  })

  it('returns 404 for a missing todo and a second delete', async () => {
    const app = appWithTodos()
    const list = await request(app).get('/api/v1/todos').expect(200)
    const id: string = list.body.todos[0].id

    await request(app).delete(`/api/v1/todos/${id}`).expect(200)
    const res = await request(app).delete(`/api/v1/todos/${id}`).expect(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api test:contract`
Expected: FAIL — `createTodosController` route missing, list returns 404.

- [ ] **Step 3: Implement the controller**

`apps/api/src/features/todos/controller.ts`
```ts
import { Router } from 'express'
import {
  CreateTodoInputSchema, Err, ListTodosQuerySchema, TodoIdParamsSchema, UpdateTodoInputSchema,
} from '@repo/shared'
import { asyncHandler, sendResult } from '../../shared/http.js'
import { validationError } from '../../shared/errors.js'
import type { TodosUseCases } from './usecase.js'

export function createTodosController(useCases: TodosUseCases): Router {
  const router = Router()

  router.get('/', asyncHandler(async (req, res) => {
    const query = ListTodosQuerySchema.safeParse(req.query)
    if (!query.success) {
      sendResult(res, Err(validationError('Invalid filter', query.error.flatten())))
      return
    }
    sendResult(res, await useCases.list(query.data))
  }))

  router.post('/', asyncHandler(async (req, res) => {
    const body = CreateTodoInputSchema.safeParse(req.body)
    if (!body.success) {
      sendResult(res, Err(validationError('Invalid todo', body.error.flatten())))
      return
    }
    sendResult(res, await useCases.create(body.data), 201)
  }))

  router.patch('/:id', asyncHandler(async (req, res) => {
    const params = TodoIdParamsSchema.safeParse(req.params)
    const body = UpdateTodoInputSchema.safeParse(req.body)
    if (!params.success || !body.success) {
      sendResult(res, Err(validationError('Invalid update', {
        params: params.success ? undefined : params.error.flatten(),
        body: body.success ? undefined : body.error.flatten(),
      })))
      return
    }
    sendResult(res, await useCases.setCompleted(params.data.id, body.data))
  }))

  router.delete('/:id', asyncHandler(async (req, res) => {
    const params = TodoIdParamsSchema.safeParse(req.params)
    if (!params.success) {
      sendResult(res, Err(validationError('Invalid id', params.error.flatten())))
      return
    }
    sendResult(res, await useCases.remove(params.data.id))
  }))

  return router
}
```

- [ ] **Step 4: Wire the slice into `createApp`**

Replace `apps/api/src/app.ts` with:
```ts
import express, { Router, type Express, type NextFunction, type Request, type Response } from 'express'
import { createTodosUseCases } from './features/todos/usecase.js'
import { createTodosController } from './features/todos/controller.js'
import type { TodosRepo } from './features/todos/repo.js'
import type { ActivityLog } from './shared/activityLog.js'
import { logger } from './shared/observability/logger.js'

export interface AppDeps {
  todosRepo: TodosRepo
  activityLog: ActivityLog
  webDist?: string
}

export function createApp(deps: AppDeps): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json())

  const todoUseCases = createTodosUseCases({
    repo: deps.todosRepo,
    activityLog: deps.activityLog,
  })

  const router = Router()
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  router.use('/todos', createTodosController(todoUseCases))

  app.use('/api/v1', router)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found' } })
  })

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } })
      return
    }
    logger.error('unhandled request error', {
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } })
  })

  return app
}
```

Update `apps/api/src/app.test.ts` to pass deps:
```ts
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { createActivityLog } from './shared/activityLog.js'
import { createMemoryTodosRepo } from './features/todos/repo.js'

const createTestApp = () =>
  createApp({ todosRepo: createMemoryTodosRepo([]), activityLog: createActivityLog() })

describe('app shell', () => {
  it('reports health', async () => {
    const res = await request(createTestApp()).get('/api/v1/health').expect(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(createTestApp()).get('/api/nope').expect(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('maps malformed JSON to a validation error', async () => {
    const res = await request(createTestApp())
      .post('/api/v1/todos')
      .set('content-type', 'application/json')
      .send('{bad')
      .expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})
```

- [ ] **Step 5: Add the feature README**

`apps/api/src/features/todos/README.md`
```markdown
# Todos

**Intent:** capture, complete, filter, and delete a single user's todos.

- Critical: the in-memory repo. If it fails, every todo route fails.
- Degradable: none. This slice has no fanOut; degradable behavior lives in
  `dashboard/`.
- Errors: validation 400, missing todo 404. All expected failures are `Result`
  values mapped by the controller.
- Tests: `repo.test.ts` (storage), `todos.test.ts` (usecases, fake repo),
  `todos.controller.test.ts` (supertest + contract `safeParse`).
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter api test && pnpm --filter api test:contract`
Expected: unit tests PASS, 7 controller tests PASS.

```bash
git add apps/api/src/app.ts apps/api/src/app.test.ts apps/api/src/features/todos
git commit -m "feat(todos): add http controller, validation, and routes"
```

---

### Task 8: Dashboard stats and usecase

**Files:**
- Create: `apps/api/src/features/dashboard/stats.ts`
- Create: `apps/api/src/features/dashboard/stats.test.ts`
- Create: `apps/api/src/features/dashboard/usecase.ts`
- Create: `apps/api/src/features/dashboard/dashboard.test.ts`

**Interfaces:**
- Produces: `StatsProvider` with `get(): Promise<Result<Stats>>`; `createLocalStats(repo)`, `createStats({ todosRepo, statsUrl?, fail? })`.
- Produces: `GetDashboardUseCase = () => Promise<Result<DashboardOutput>>`; `createGetDashboardUseCase({ todosRepo, stats, activityLog, timeouts? })`.
- Extends `fanOut` usage with tasks `todos` (critical), `stats`, `activity`.

- [ ] **Step 1: Write the failing stats tests**

`apps/api/src/features/dashboard/stats.test.ts`
```ts
import { Ok, type Todo } from '@repo/shared'
import { describe, expect, it, vi } from 'vitest'
import { createStats } from './stats.js'
import type { TodosRepo } from '../todos/repo.js'

const todo = (completed: boolean): Todo => ({
  id: String(Math.random()), title: 'x', completed,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const repo = (todos: Todo[]): TodosRepo => ({
  list: async () => Ok(todos),
  findById: async () => Ok(todos[0]!),
  create: async () => Ok(todos[0]!),
  setCompleted: async () => Ok(todos[0]!),
  remove: async () => Ok('x'),
})

describe('stats provider', () => {
  it('computes stats locally from the repo', async () => {
    const stats = await createStats({ todosRepo: repo([todo(true), todo(false)]) }).get()
    expect(stats).toEqual({
      ok: true,
      value: { total: 2, active: 1, completed: 1, completionRate: 0.5 },
    })
  })

  it('fails on demand for demos and tests', async () => {
    const stats = await createStats({ todosRepo: repo([]), fail: true }).get()
    expect(stats.ok).toBe(false)
    if (stats.ok) return
    expect(stats.error.code).toBe('DASHBOARD_UNAVAILABLE')
  })

  it('uses the remote service when a URL is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '{"total":1,"active":0,"completed":1,"completionRate":1}',
      { status: 200 },
    )))
    const stats = await createStats({ todosRepo: repo([]), statsUrl: 'http://stats.local' }).get()
    expect(stats.ok).toBe(true)
    if (!stats.ok) return
    expect(stats.value.completionRate).toBe(1)
  })

  it('degrades when the remote payload is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"total":"nope"}', { status: 200 })))
    const stats = await createStats({ todosRepo: repo([]), statsUrl: 'http://stats.local' }).get()
    expect(stats.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api test stats`
Expected: FAIL — cannot resolve `./stats.js`.

- [ ] **Step 3: Implement stats**

`apps/api/src/features/dashboard/stats.ts`
```ts
import { Err, Ok, StatsSchema, type Result, type Stats } from '@repo/shared'
import { dashboardUnavailable } from '../../shared/errors.js'
import { httpGetJson } from '../../shared/httpClient.js'
import type { TodosRepo } from '../todos/repo.js'

export interface StatsProvider {
  get(): Promise<Result<Stats>>
}

export function createLocalStats(todosRepo: TodosRepo): StatsProvider {
  return {
    async get() {
      const result = await todosRepo.list('all')
      if (!result.ok) return result
      const total = result.value.length
      const completed = result.value.filter((todo) => todo.completed).length
      return Ok({
        total,
        active: total - completed,
        completed,
        completionRate: total === 0 ? 0 : completed / total,
      })
    },
  }
}

export function createStats(options: {
  todosRepo: TodosRepo
  statsUrl?: string
  fail?: boolean
}): StatsProvider {
  if (options.fail || process.env.FAIL_STATS === '1') {
    return { get: async () => Err(dashboardUnavailable()) }
  }

  const url = options.statsUrl ?? process.env.STATS_URL
  if (!url) return createLocalStats(options.todosRepo)

  return {
    async get() {
      const response = await httpGetJson<unknown>(url)
      if (!response.ok) return Err(dashboardUnavailable())
      const parsed = StatsSchema.safeParse(response.value)
      return parsed.success ? Ok(parsed.data) : Err(dashboardUnavailable())
    },
  }
}
```

- [ ] **Step 4: Write the failing dashboard usecase tests (4 cases)**

`apps/api/src/features/dashboard/dashboard.test.ts`
```ts
import { DashboardOutputSchema, Err, Ok, type Todo } from '@repo/shared'
import { describe, expect, it } from 'vitest'
import { createActivityLog } from '../../shared/activityLog.js'
import { notFoundError } from '../../shared/errors.js'
import type { TodosRepo } from '../todos/repo.js'
import type { StatsProvider } from './stats.js'
import { createGetDashboardUseCase } from './usecase.js'

const todo = (id: string): Todo => ({
  id, title: `todo ${id}`, completed: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const repo = (todos: Todo[]): TodosRepo => ({
  list: async () => Ok(todos),
  findById: async () => Ok(todos[0]!),
  create: async () => Ok(todos[0]!),
  setCompleted: async () => Ok(todos[0]!),
  remove: async () => Ok('x'),
})

const statsOk: StatsProvider = {
  get: async () => Ok({ total: 1, active: 1, completed: 0, completionRate: 0 }),
}

describe('GetDashboardUseCase', () => {
  it('returns the full dashboard', async () => {
    const activityLog = createActivityLog()
    activityLog.append({
      id: 'a', type: 'created', todoId: '1', title: 'todo 1',
      at: '2026-01-01T00:00:00.000Z',
    })
    const useCase = createGetDashboardUseCase({
      todosRepo: repo([todo('1')]),
      stats: statsOk,
      activityLog,
    })

    const result = await useCase()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(DashboardOutputSchema.safeParse(result.value).success).toBe(true)
    expect(result.value.meta.partial).toBe(false)
    expect(result.value.stats?.completionRate).toBe(0)
    expect(result.value.activity?.[0]?.type).toBe('created')
  })

  it('returns partial data when stats fails', async () => {
    const useCase = createGetDashboardUseCase({
      todosRepo: repo([todo('1')]),
      stats: { get: async () => Err(notFoundError('stats down')) },
      activityLog: createActivityLog(),
    })

    const result = await useCase()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.stats).toBeNull()
    expect(result.value.meta.partial).toBe(true)
    expect(result.value.meta.failedTasks).toEqual(['stats'])
    expect(result.value.todos).toHaveLength(1)
  })

  it('fails with DASHBOARD_UNAVAILABLE when the critical task fails', async () => {
    const useCase = createGetDashboardUseCase({
      todosRepo: { ...repo([]), list: async () => Err(notFoundError('todos down')) },
      stats: statsOk,
      activityLog: createActivityLog(),
    })

    const result = await useCase()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('DASHBOARD_UNAVAILABLE')
  })

  it('returns partial data when stats times out', async () => {
    const useCase = createGetDashboardUseCase({
      todosRepo: repo([todo('1')]),
      stats: { get: () => new Promise(() => undefined) },
      activityLog: createActivityLog(),
      timeouts: { stats: 10 },
    })

    const result = await useCase()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.meta.partial).toBe(true)
    expect(result.value.meta.failedTasks).toEqual(['stats'])
    expect(result.value.meta.warnings[0]).toContain('timed out')
  })
})
```

- [ ] **Step 5: Implement the dashboard usecase**

`apps/api/src/features/dashboard/usecase.ts`
```ts
import {
  DashboardOutputSchema,
  Err,
  Ok,
  type DashboardOutput,
  type Result,
} from '@repo/shared'
import { dashboardUnavailable, internalError } from '../../shared/errors.js'
import { fanOut } from '../../shared/fanOut.js'
import { runSpan } from '../../shared/observability/tracing.js'
import type { ActivityLog } from '../../shared/activityLog.js'
import type { TodosRepo } from '../todos/repo.js'
import type { StatsProvider } from './stats.js'

export interface DashboardDeps {
  todosRepo: TodosRepo
  stats: StatsProvider
  activityLog: ActivityLog
  timeouts?: { todos?: number; stats?: number; activity?: number }
}

export function createGetDashboardUseCase(deps: DashboardDeps): () => Promise<Result<DashboardOutput>> {
  return () =>
    runSpan('GetDashboardUseCase', async () => {
      const result = await fanOut(
        {
          todos: {
            run: () => deps.todosRepo.list('all'),
            critical: true,
            timeoutMs: deps.timeouts?.todos ?? 2000,
          },
          stats: {
            run: () => deps.stats.get(),
            timeoutMs: deps.timeouts?.stats ?? 2000,
          },
          activity: {
            run: async () => Ok(deps.activityLog.recent(10)),
            timeoutMs: deps.timeouts?.activity ?? 500,
          },
        },
        { abortOnCritical: true },
      )

      if (!result.ok) return Err(dashboardUnavailable())

      const { data, warnings, failedTasks, partial } = result.value
      if (!data.todos) return Err(dashboardUnavailable())

      const parsed = DashboardOutputSchema.safeParse({
        todos: data.todos,
        stats: data.stats ?? null,
        activity: data.activity ?? null,
        meta: { partial, warnings, failedTasks },
      })
      if (!parsed.success) {
        return Err(internalError('Dashboard response did not match its contract'))
      }
      return Ok(parsed.data)
    })
}
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter api test stats dashboard`
Expected: stats tests and 4 dashboard cases PASS.

```bash
git add apps/api/src/features/dashboard
git commit -m "feat(dashboard): add stats provider and fanOut aggregation usecase"
```

---

### Task 9: Dashboard controller and app wiring

**Files:**
- Create: `apps/api/src/features/dashboard/controller.ts`
- Create: `apps/api/src/features/dashboard/dashboard.controller.test.ts`
- Create: `apps/api/src/features/dashboard/README.md`
- Modify: `apps/api/src/app.ts` (require `stats`, mount dashboard router)
- Modify: `apps/api/src/server.ts` (compose real deps)
- Modify: `apps/api/src/app.test.ts`, `apps/api/src/features/todos/todos.controller.test.ts` (pass stats)

**Interfaces:**
- Produces: `createDashboardController(useCase): Router`.
- `AppDeps` final shape: `{ todosRepo, activityLog, stats, e2e?, webDist? }`.

- [ ] **Step 1: Write the failing contract tests**

`apps/api/src/features/dashboard/dashboard.controller.test.ts`
```ts
import { ApiErrorSchema, DashboardOutputSchema, Err, Ok } from '@repo/shared'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { createActivityLog } from '../../shared/activityLog.js'
import { notFoundError } from '../../shared/errors.js'
import { createMemoryTodosRepo } from '../todos/repo.js'
import type { StatsProvider } from './stats.js'

const statsOk: StatsProvider = {
  get: async () => Ok({ total: 1, active: 1, completed: 0, completionRate: 0 }),
}

describe('dashboard controller', () => {
  it('returns a contract-valid full dashboard', async () => {
    const res = await request(createApp({
      todosRepo: createMemoryTodosRepo(['one']),
      activityLog: createActivityLog(),
      stats: statsOk,
    })).get('/api/v1/dashboard').expect(200)

    expect(DashboardOutputSchema.safeParse(res.body).success).toBe(true)
    expect(res.body.meta.partial).toBe(false)
  })

  it('returns a contract-valid partial dashboard', async () => {
    const res = await request(createApp({
      todosRepo: createMemoryTodosRepo(['one']),
      activityLog: createActivityLog(),
      stats: { get: async () => Err(notFoundError('stats down')) },
    })).get('/api/v1/dashboard').expect(200)

    expect(DashboardOutputSchema.safeParse(res.body).success).toBe(true)
    expect(res.body.stats).toBeNull()
    expect(res.body.meta.partial).toBe(true)
  })

  it('returns 503 when the critical todos task fails', async () => {
    const res = await request(createApp({
      todosRepo: {
        ...createMemoryTodosRepo([]),
        list: async () => Err(notFoundError('todos down')),
      },
      activityLog: createActivityLog(),
      stats: statsOk,
    })).get('/api/v1/dashboard').expect(503)

    expect(ApiErrorSchema.safeParse(res.body).success).toBe(true)
    expect(res.body.error.code).toBe('DASHBOARD_UNAVAILABLE')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api test:contract`
Expected: FAIL — `/api/v1/dashboard` returns 404.

- [ ] **Step 3: Implement the controller**

`apps/api/src/features/dashboard/controller.ts`
```ts
import { Router } from 'express'
import type { DashboardOutput, Result } from '@repo/shared'
import { asyncHandler, sendResult } from '../../shared/http.js'

export function createDashboardController(
  useCase: () => Promise<Result<DashboardOutput>>,
): Router {
  const router = Router()

  router.get('/', asyncHandler(async (_req, res) => {
    sendResult(res, await useCase())
  }))

  return router
}
```

- [ ] **Step 4: Wire the slice into `createApp`**

In `apps/api/src/app.ts`, add imports:
```ts
import { createGetDashboardUseCase } from './features/dashboard/usecase.js'
import { createDashboardController } from './features/dashboard/controller.js'
import type { StatsProvider } from './features/dashboard/stats.js'
```
Extend `AppDeps` with `stats: StatsProvider`. After the todos usecases, add:
```ts
  const dashboardUseCase = createGetDashboardUseCase({
    todosRepo: deps.todosRepo,
    stats: deps.stats,
    activityLog: deps.activityLog,
  })
```
Mount it with the other router lines:
```ts
  router.use('/dashboard', createDashboardController(dashboardUseCase))
```

- [ ] **Step 5: Update `server.ts` composition**

`apps/api/src/server.ts`
```ts
import './shared/observability/otel.js'
import { createApp } from './app.js'
import { createStats } from './features/dashboard/stats.js'
import { createMemoryTodosRepo } from './features/todos/repo.js'
import { createActivityLog } from './shared/activityLog.js'
import { logger } from './shared/observability/logger.js'

const todosRepo = createMemoryTodosRepo()

const app = createApp({
  todosRepo,
  activityLog: createActivityLog(),
  stats: createStats({ todosRepo }),
})

const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => {
  logger.info('api listening', { port })
})
```

- [ ] **Step 6: Update existing tests for the new required dep**

Add `stats: statsOk` (or a local provider) to `createApp` calls in `apps/api/src/app.test.ts` and `apps/api/src/features/todos/todos.controller.test.ts`. Example provider:
```ts
const stats: StatsProvider = {
  get: async () => Ok({ total: 0, active: 0, completed: 0, completionRate: 0 }),
}
```

- [ ] **Step 7: Add the feature README**

`apps/api/src/features/dashboard/README.md`
```markdown
# Dashboard

**Intent:** show the overview: every todo, completion stats, and recent activity.

- Critical: `todos` (repo read). If it fails, the whole dashboard is 503.
- Degradable: `stats` (local or `STATS_URL` service) and `activity` (ring buffer).
  Failures return 200 with `meta.partial: true`, `meta.warnings`, and nulls.
- fanOut attributes: `tasks`, `failed_tasks`, `partial` on the span.
- Tests: `dashboard.test.ts` covers ok, partial, critical failure, and timeout;
  `dashboard.controller.test.ts` validates bodies with `DashboardOutput.safeParse`.
```

- [ ] **Step 8: Verify and commit**

Run: `pnpm --filter api test && pnpm --filter api test:contract && pnpm --filter api typecheck`
Expected: all PASS; typecheck clean.

```bash
git add apps/api
git commit -m "feat(dashboard): add controller, wire composition root, and document slice"
```

---

### Task 10: E2E seed API and request-scoped partitions

**Files:**
- Modify: `apps/api/src/shared/e2e.ts` (add partitions, middleware, seed routes, `installE2E`)
- Create: `apps/api/src/shared/e2e.test.ts`
- Modify: `apps/api/src/app.ts` (mount when `deps.e2e`)
- Modify: `apps/api/src/server.ts` (pass `e2e: process.env.E2E === 'true'`)
- Modify: existing `createApp` test helpers to tolerate the optional flag

**Interfaces:**
- Produces: `installE2E(app): void`, `POST /api/test/seed` → 201 `SeedOutput`, `DELETE /api/test/seed/:id` → 200 `{ id }`.
- Produces: `x-e2e-seed-id` request header selects the partition; unknown ids return 404 `E2E_SEED_NOT_FOUND`.
- `AppDeps` gains `e2e?: boolean`.

- [ ] **Step 1: Write the failing seed tests**

`apps/api/src/shared/e2e.test.ts`
```ts
import { ApiErrorSchema, Ok } from '@repo/shared'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { createActivityLog } from './activityLog.js'
import { createMemoryTodosRepo } from '../features/todos/repo.js'

const stats = { get: async () => Ok({ total: 0, active: 0, completed: 0, completionRate: 0 }) }

const app = (e2e: boolean) => createApp({
  todosRepo: createMemoryTodosRepo([]),
  activityLog: createActivityLog(),
  stats,
  e2e,
})

describe('e2e seed api', () => {
  it('is absent unless E2E is enabled', async () => {
    const res = await request(app(false)).post('/api/test/seed').send({}).expect(404)
    expect(ApiErrorSchema.safeParse(res.body).success).toBe(true)
  })

  it('creates an isolated partition per seed id', async () => {
    const server = app(true)
    const first = await request(server).post('/api/test/seed')
      .send({ todos: ['first seed'] }).expect(201)
    const second = await request(server).post('/api/test/seed')
      .send({ todos: ['second seed'] }).expect(201)

    const firstList = await request(server).get('/api/v1/todos')
      .set('x-e2e-seed-id', first.body.id).expect(200)
    const secondList = await request(server).get('/api/v1/todos')
      .set('x-e2e-seed-id', second.body.id).expect(200)

    expect(firstList.body.todos.map((todo: { title: string }) => todo.title)).toEqual(['first seed'])
    expect(secondList.body.todos.map((todo: { title: string }) => todo.title)).toEqual(['second seed'])

    await request(server).post('/api/v1/todos')
      .set('x-e2e-seed-id', first.body.id)
      .send({ title: 'only in first' })
      .expect(201)

    const secondAgain = await request(server).get('/api/v1/todos')
      .set('x-e2e-seed-id', second.body.id).expect(200)
    expect(secondAgain.body.todos).toHaveLength(1)

    await request(server).delete(`/api/test/seed/${first.body.id}`).expect(200)
    await request(server).delete(`/api/test/seed/${second.body.id}`).expect(200)
  })

  it('rejects an unknown or deleted seed id', async () => {
    const server = app(true)
    const created = await request(server).post('/api/test/seed').send({}).expect(201)

    await request(server).get('/api/v1/todos')
      .set('x-e2e-seed-id', 'e2e-missing').expect(404)

    await request(server).delete(`/api/test/seed/${created.body.id}`).expect(200)
    const stale = await request(server).get('/api/v1/todos')
      .set('x-e2e-seed-id', created.body.id).expect(404)
    expect(stale.body.error.code).toBe('E2E_SEED_NOT_FOUND')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api test e2e.test`
Expected: FAIL — `/api/test/seed` returns 404 in both modes (routes not implemented).

- [ ] **Step 3: Implement the seed store and routes**

Replace `apps/api/src/shared/e2e.ts` with:
```ts
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { Express, NextFunction, Request, Response } from 'express'
import { Err, SeedInputSchema, type ActivityEntry, type Todo } from '@repo/shared'
import { notFoundError, validationError } from './errors.js'
import { sendResult } from './http.js'

export interface E2EContext {
  todos: Map<string, Todo>
  activity: ActivityEntry[]
}

const storage = new AsyncLocalStorage<E2EContext>()
const partitions = new Map<string, E2EContext>()
let seedCounter = 0

export const currentE2EContext = (): E2EContext | undefined => storage.getStore()

export function runWithE2EContext<T>(context: E2EContext, fn: () => T): T {
  return storage.run(context, fn)
}

export function installE2E(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const seedId = req.header('x-e2e-seed-id')
    if (!seedId) {
      next()
      return
    }
    const context = partitions.get(seedId)
    if (!context) {
      res.status(404).json({
        error: { code: 'E2E_SEED_NOT_FOUND', message: `Seed ${seedId} not found` },
      })
      return
    }
    runWithE2EContext(context, next)
  })

  app.post('/api/test/seed', (req: Request, res: Response) => {
    const parsed = SeedInputSchema.safeParse(req.body)
    if (!parsed.success) {
      sendResult(res, Err(validationError('Invalid seed input', parsed.error.flatten())))
      return
    }

    seedCounter += 1
    const id = `e2e-${Date.now()}-${seedCounter}`
    const now = new Date().toISOString()
    const todos = new Map<string, Todo>()
    for (const title of parsed.data.todos ?? []) {
      const todo: Todo = {
        id: randomUUID(), title, completed: false, createdAt: now, updatedAt: now,
      }
      todos.set(todo.id, todo)
    }
    partitions.set(id, { todos, activity: [] })
    res.status(201).json({ id })
  })

  app.delete('/api/test/seed/:id', (req: Request, res: Response) => {
    const id = req.params.id ?? ''
    if (!partitions.delete(id)) {
      sendResult(res, Err(notFoundError(`Seed ${id} not found`)))
      return
    }
    res.json({ id })
  })
}
```

- [ ] **Step 4: Mount it and pass the flag**

In `apps/api/src/app.ts`, import `installE2E`:
```ts
import { installE2E } from './shared/e2e.js'
```
Extend `AppDeps`:
```ts
  e2e?: boolean
```
Right after `app.use(express.json())`:
```ts
  if (deps.e2e) installE2E(app)
```
In `apps/api/src/server.ts`, add to `createApp`:
```ts
  e2e: process.env.E2E === 'true',
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter api test e2e.test && pnpm --filter api typecheck`
Expected: 3 seed tests PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/shared/e2e.ts apps/api/src/shared/e2e.test.ts apps/api/src/app.ts apps/api/src/server.ts
git commit -m "feat(api): add e2e seed api with request-scoped partitions"
```

---

### Task 11: Web scaffold, API client, and Todos page

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`
- Create: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`
- Create: `apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts`, `apps/web/src/lib/queryClient.ts`
- Create: `apps/web/src/test/setup.ts`
- Create: `apps/web/src/features/todos/{todos.api.ts,todos.query.ts,TodosPage.tsx,TodosPage.test.tsx}`

**Interfaces:**
- Produces: `apiFetch<T>(path, init?)`, `ApiRequestError { status, code, message }`.
- Produces: `todosApi.list|create|setCompleted|remove`, `todosKeys`, `useTodos(filter)`, `useCreateTodo()`, `useSetTodoCompleted()`, `useRemoveTodo()`.
- Produces: `TodosPage`, `App` (todos route only; dashboard route added in Task 12).

- [ ] **Step 1: Write the failing API client test**

`apps/web/src/lib/api.test.ts`
```ts
import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError, apiFetch } from './api.js'

const respond = (body: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
} as Response)

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ todos: [] })))
    await expect(apiFetch('/todos')).resolves.toEqual({ todos: [] })
  })

  it('throws a typed error built from the ApiError envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid todo' } }, 400,
    )))
    await expect(apiFetch('/todos')).rejects.toMatchObject({
      name: 'ApiRequestError', status: 400, code: 'VALIDATION_ERROR', message: 'Invalid todo',
    })
  })

  it('falls back to a generic error when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('Unexpected token <') },
    } as Response)))

    const error = await apiFetch('/todos').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 502, message: 'Request failed with status 502' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test`
Expected: FAIL — cannot resolve `./api.js` (and web package does not exist yet).

- [ ] **Step 3: Create the web package and config**

`apps/web/package.json`
```json
{
  "name": "web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@repo/shared": "workspace:*",
    "@tanstack/react-query": "^5.59.16",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.27.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.2",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/node": "^22.9.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vitest": "^2.1.4"
  }
}
```

`apps/web/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "noEmit": true,
    "types": ["vite/client", "vitest/globals", "node"]
  },
  "include": ["src", "e2e", "playwright.config.ts", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`
```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    css: false,
  },
})
```

`apps/web/index.html`
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Todo reference</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Implement the client and app shell**

`apps/web/src/lib/api.ts`
```ts
import { ApiErrorSchema } from '@repo/shared'

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const parsed = ApiErrorSchema.safeParse(body)
    if (parsed.success) {
      throw new ApiRequestError(response.status, parsed.data.error.code, parsed.data.error.message)
    }
    throw new ApiRequestError(response.status, 'INTERNAL', `Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}
```

`apps/web/src/lib/queryClient.ts`
```ts
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
})
```

`apps/web/src/test/setup.ts`
```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
```

`apps/web/src/main.tsx`
```tsx
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App.js'
import { queryClient } from './lib/queryClient.js'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('root element missing')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
```

`apps/web/src/App.tsx`
```tsx
import { Navigate, Route, Routes } from 'react-router-dom'
import { TodosPage } from './features/todos/TodosPage.js'

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Todo reference</h1>
        <nav aria-label="Main navigation" />
      </header>
      <main>
        <Routes>
          <Route path="/todos" element={<TodosPage />} />
          <Route path="*" element={<Navigate to="/todos" replace />} />
        </Routes>
      </main>
    </div>
  )
}
```

`apps/web/src/styles.css`
```css
:root {
  color-scheme: light dark;
  --bg: #f7f7f8;
  --panel: #ffffff;
  --text: #1c1c1e;
  --muted: #6b7280;
  --accent: #2563eb;
  --danger: #b91c1c;
  --border: #d4d4d8;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111113;
    --panel: #1b1b1f;
    --text: #f4f4f5;
    --muted: #a1a1aa;
    --accent: #60a5fa;
    --danger: #f87171;
    --border: #333338;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
.app { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; }
.app-header { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; justify-content: space-between; }
nav { display: flex; gap: 12px; }
nav a { color: var(--accent); text-decoration: none; font-weight: 600; }
nav a[aria-current="page"] { text-decoration: underline; }
section { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-top: 16px; }
form { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
input[type="text"], input:not([type]) { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: inherit; }
button { padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); color: inherit; cursor: pointer; }
button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
[data-testid="error-banner"] { color: var(--danger); }
ul { list-style: none; padding: 0; }
li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); }
li label { display: flex; gap: 8px; align-items: center; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
@media (max-width: 420px) { .app { padding: 12px 8px 48px; } }
```

- [ ] **Step 5: Write the failing TodosPage test**

`apps/web/src/features/todos/TodosPage.test.tsx`
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ListTodosOutputSchema, type Todo } from '@repo/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TodosPage } from './TodosPage.js'

const todo = (id: string, title: string, completed = false): Todo => ({
  id, title, completed,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const respond = (body: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
} as Response)

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TodosPage />
    </QueryClientProvider>,
  )
}

describe('TodosPage', () => {
  it('renders todos from the API', async () => {
    const body = ListTodosOutputSchema.parse({ todos: [todo('1', 'Buy milk')] })
    vi.stubGlobal('fetch', vi.fn(async () => respond(body)))

    renderPage()
    expect(await screen.findByText('Buy milk')).toBeInTheDocument()
  })

  it('creates a todo and refetches the list', async () => {
    let todos: Todo[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/todos') && init?.method === 'POST') {
        const created = todo('2', 'Write tests')
        todos = [...todos, created]
        return respond({ todo: created }, 201)
      }
      return respond(ListTodosOutputSchema.parse({ todos }))
    }))

    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByTestId('todo-input'), 'Write tests')
    await user.click(screen.getByTestId('todo-add'))

    expect(await screen.findByText('Write tests')).toBeInTheDocument()
  })

  it('filters via the filter buttons', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const done = todo('1', 'Done task', true)
      const active = todo('2', 'Active task')
      const todos = url.includes('filter=done') ? [done] : url.includes('filter=active') ? [active] : [done, active]
      return respond(ListTodosOutputSchema.parse({ todos }))
    }))

    renderPage()
    expect(await screen.findByText('Done task')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('filter-done'))
    expect(await screen.findByText('Done task')).toBeInTheDocument()
    expect(screen.queryByText('Active task')).not.toBeInTheDocument()
  })

  it('shows the server error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid todo' } }, 400,
    )))

    renderPage()
    expect(await screen.findByTestId('error-banner')).toHaveTextContent('Invalid todo')
  })

  it('shows an inline error when a delete hits an already-deleted todo', async () => {
    const list = ListTodosOutputSchema.parse({ todos: [todo('1', 'Buy milk')] })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return respond({ error: { code: 'NOT_FOUND', message: 'Todo 1 not found' } }, 404)
      }
      return respond(list)
    }))

    renderPage()
    await userEvent.click(await screen.findByTestId('todo-delete'))

    expect(await screen.findByTestId('error-banner')).toHaveTextContent('Todo 1 not found')
  })
})
```

- [ ] **Step 6: Implement todos client, queries, and page**

`apps/web/src/features/todos/todos.api.ts`
```ts
import {
  CreateTodoInputSchema, UpdateTodoInputSchema,
  type DeleteTodoOutput, type ListTodosOutput, type TodoFilter, type TodoOutput,
} from '@repo/shared'
import { apiFetch } from '../../lib/api.js'

export const todosApi = {
  list: (filter: TodoFilter) => apiFetch<ListTodosOutput>(`/todos?filter=${filter}`),
  create: (title: string) =>
    apiFetch<TodoOutput>('/todos', {
      method: 'POST',
      body: JSON.stringify(CreateTodoInputSchema.parse({ title })),
    }),
  setCompleted: (id: string, completed: boolean) =>
    apiFetch<TodoOutput>(`/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(UpdateTodoInputSchema.parse({ completed })),
    }),
  remove: (id: string) =>
    apiFetch<DeleteTodoOutput>(`/todos/${id}`, { method: 'DELETE' }),
}
```

`apps/web/src/features/todos/todos.query.ts`
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TodoFilter } from '@repo/shared'
import { todosApi } from './todos.api.js'

export const todosKeys = {
  all: ['todos'] as const,
  list: (filter: TodoFilter) => ['todos', filter] as const,
}

function useRefreshTodos() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: todosKeys.all })
    void client.invalidateQueries({ queryKey: ['dashboard'] })
  }
}

export function useTodos(filter: TodoFilter) {
  return useQuery({ queryKey: todosKeys.list(filter), queryFn: () => todosApi.list(filter) })
}

export function useCreateTodo() {
  const refresh = useRefreshTodos()
  return useMutation({ mutationFn: (title: string) => todosApi.create(title), onSuccess: refresh })
}

export function useSetTodoCompleted() {
  const refresh = useRefreshTodos()
  return useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      todosApi.setCompleted(id, completed),
    onSuccess: refresh,
  })
}

export function useRemoveTodo() {
  const refresh = useRefreshTodos()
  return useMutation({ mutationFn: (id: string) => todosApi.remove(id), onSuccess: refresh })
}
```

`apps/web/src/features/todos/TodosPage.tsx`
```tsx
import type { TodoFilter } from '@repo/shared'
import { useRef, useState } from 'react'
import {
  useCreateTodo, useRemoveTodo, useSetTodoCompleted, useTodos,
} from './todos.query.js'

const FILTERS: TodoFilter[] = ['all', 'active', 'done']

export function TodosPage() {
  const [filter, setFilter] = useState<TodoFilter>('all')
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const todos = useTodos(filter)
  const create = useCreateTodo()
  const setCompleted = useSetTodoCompleted()
  const remove = useRemoveTodo()
  const error = todos.error ?? create.error ?? setCompleted.error ?? remove.error

  return (
    <section aria-labelledby="todos-heading">
      <h2 id="todos-heading">Todos</h2>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (title.trim().length === 0) return
          create.mutate(title, {
            onSuccess: () => {
              setTitle('')
              inputRef.current?.focus()
            },
          })
        }}
      >
        <label htmlFor="todo-title">New todo</label>
        <input
          id="todo-title"
          data-testid="todo-input"
          ref={inputRef}
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button
          type="submit"
          data-testid="todo-add"
          disabled={create.isPending || title.trim().length === 0}
        >
          Add
        </button>
      </form>

      <div role="group" aria-label="Filter todos">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            data-testid={`filter-${value}`}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" data-testid="error-banner">{error.message}</p>
      ) : null}

      {todos.isPending ? <p>Loading todos…</p> : null}
      {todos.data && todos.data.todos.length === 0 ? <p>No todos yet.</p> : null}

      <ul>
        {todos.data?.todos.map((todo) => (
          <li key={todo.id} data-testid="todo-item">
            <label>
              <input
                type="checkbox"
                data-testid="todo-toggle"
                checked={todo.completed}
                onChange={(event) =>
                  setCompleted.mutate({ id: todo.id, completed: event.target.checked })
                }
              />
              <span>{todo.title}</span>
            </label>
            <button
              type="button"
              data-testid="todo-delete"
              onClick={() => remove.mutate(todo.id)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 7: Run and commit**

Run: `pnpm --filter @repo/shared build && pnpm --filter web test`
Expected: API client tests and 4 page tests PASS.

```bash
git add apps/web
git commit -m "feat(web): add vite shell, typed api client, and todos page"
```

---

### Task 12: Dashboard page and navigation

**Files:**
- Create: `apps/web/src/features/dashboard/{dashboard.api.ts,dashboard.query.ts,DashboardPage.tsx,DashboardPage.test.tsx}`
- Modify: `apps/web/src/App.tsx` (nav links + `/dashboard` route)
- Modify: `apps/web/src/styles.css` (banner + stat styles)

**Interfaces:**
- Consumes: `apiFetch`, `DashboardOutput`, `DashboardOutputSchema`.
- Produces: `dashboardApi.get()`, `dashboardKeys`, `useDashboard()`, `DashboardPage`.
- Produces test ids: `nav-todos`, `nav-dashboard`, `partial-banner`, `dismiss-partial`, `dashboard-warning`, `error-banner`, `stats`, `stats-total`, `stats-active`, `stats-completed`, `stats-rate`, `dashboard-todo`, `activity-list`, `dashboard-activity`, `dashboard-stats-unavailable`.

- [ ] **Step 1: Write the failing page tests**

`apps/web/src/features/dashboard/DashboardPage.test.tsx`
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DashboardOutputSchema, type DashboardOutput } from '@repo/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage.js'

const respond = (body: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
} as Response)

const fullDashboard: DashboardOutput = DashboardOutputSchema.parse({
  todos: [
    {
      id: 't1', title: 'Buy milk', completed: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 't2', title: 'Ship it', completed: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  stats: { total: 2, active: 1, completed: 1, completionRate: 0.5 },
  activity: [
    {
      id: 'a1', type: 'created', todoId: 't1', title: 'Buy milk',
      at: '2026-01-01T00:00:00.000Z',
    },
  ],
  meta: { partial: false, warnings: [], failedTasks: [] },
})

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  )
}

describe('DashboardPage', () => {
  it('renders stats, todos, and activity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(fullDashboard)))

    renderPage()

    expect(await screen.findByTestId('stats')).toBeInTheDocument()
    expect(screen.getByTestId('stats-total')).toHaveTextContent('2')
    expect(screen.getByTestId('stats-active')).toHaveTextContent('1')
    expect(screen.getByTestId('stats-completed')).toHaveTextContent('1')
    expect(screen.getByTestId('stats-rate')).toHaveTextContent('50%')
    expect(screen.getByText('Buy milk')).toBeInTheDocument()
    expect(screen.getAllByTestId('dashboard-todo')).toHaveLength(1)
    const activity = screen.getAllByTestId('dashboard-activity')
    expect(activity).toHaveLength(1)
    expect(within(activity[0]!).getByText('Buy milk')).toBeInTheDocument()
    expect(screen.queryByTestId('partial-banner')).not.toBeInTheDocument()
  })

  it('shows a partial banner and hides missing stats', async () => {
    const partial = DashboardOutputSchema.parse({
      ...fullDashboard,
      stats: null,
      meta: {
        partial: true,
        warnings: ['stats unavailable: stats down'],
        failedTasks: ['stats'],
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => respond(partial)))

    renderPage()

    expect(await screen.findByTestId('partial-banner')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-warning')).toHaveTextContent('stats unavailable')
    expect(screen.getByTestId('dashboard-stats-unavailable')).toBeInTheDocument()
    expect(screen.getByText('Buy milk')).toBeInTheDocument()
  })

  it('dismisses the partial banner', async () => {
    const partial = DashboardOutputSchema.parse({
      ...fullDashboard,
      stats: null,
      meta: { partial: true, warnings: ['stats down'], failedTasks: ['stats'] },
    })
    vi.stubGlobal('fetch', vi.fn(async () => respond(partial)))

    renderPage()
    await userEvent.click(await screen.findByTestId('dismiss-partial'))

    expect(screen.queryByTestId('partial-banner')).not.toBeInTheDocument()
  })

  it('shows the API error when the dashboard is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(
      {
        error: {
          code: 'DASHBOARD_UNAVAILABLE',
          message: 'Dashboard is temporarily unavailable',
        },
      },
      503,
    )))

    renderPage()

    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'Dashboard is temporarily unavailable',
    )
  })

  it('shows a generic error for a non-JSON failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('Unexpected token <') },
    } as Response)))

    renderPage()

    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'Request failed with status 502',
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/shared build && pnpm --filter web test DashboardPage`
Expected: FAIL — cannot resolve `./DashboardPage.js`.

- [ ] **Step 3: Implement the API client, query, and page**

`apps/web/src/features/dashboard/dashboard.api.ts`
```ts
import type { DashboardOutput } from '@repo/shared'
import { apiFetch } from '../../lib/api.js'

export const dashboardApi = {
  get: () => apiFetch<DashboardOutput>('/dashboard'),
}
```

`apps/web/src/features/dashboard/dashboard.query.ts`
```ts
import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from './dashboard.api.js'

export const dashboardKeys = {
  all: ['dashboard'] as const,
}

export function useDashboard() {
  return useQuery({ queryKey: dashboardKeys.all, queryFn: dashboardApi.get })
}
```

`apps/web/src/features/dashboard/DashboardPage.tsx`
```tsx
import { useState } from 'react'
import { useDashboard } from './dashboard.query.js'

export function DashboardPage() {
  const [dismissed, setDismissed] = useState(false)
  const dashboard = useDashboard()

  if (dashboard.isPending) {
    return <p>Loading dashboard…</p>
  }

  if (dashboard.error || !dashboard.data) {
    return (
      <section aria-labelledby="dashboard-heading">
        <h2 id="dashboard-heading">Dashboard</h2>
        <p role="alert" data-testid="error-banner">
          {dashboard.error?.message ?? 'Dashboard unavailable'}
        </p>
      </section>
    )
  }

  const { todos, stats, activity, meta } = dashboard.data
  const activePreview = todos.filter((todo) => !todo.completed).slice(0, 5)

  return (
    <section aria-labelledby="dashboard-heading">
      <h2 id="dashboard-heading">Dashboard</h2>

      {meta.partial && !dismissed ? (
        <div role="status" data-testid="partial-banner">
          <p>Some parts of the dashboard are unavailable.</p>
          <ul>
            {meta.warnings.map((warning) => (
              <li key={warning} data-testid="dashboard-warning">{warning}</li>
            ))}
          </ul>
          <button
            type="button"
            data-testid="dismiss-partial"
            onClick={() => setDismissed(true)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <h3>Stats</h3>
      {stats ? (
        <div className="stats" data-testid="stats">
          <p data-testid="stats-total">Total: {stats.total}</p>
          <p data-testid="stats-active">Active: {stats.active}</p>
          <p data-testid="stats-completed">Completed: {stats.completed}</p>
          <p data-testid="stats-rate">Completion: {Math.round(stats.completionRate * 100)}%</p>
        </div>
      ) : (
        <p data-testid="dashboard-stats-unavailable">Stats are unavailable.</p>
      )}

      <h3>Active todos</h3>
      {activePreview.length === 0 ? <p>No active todos.</p> : null}
      <ul>
        {activePreview.map((todo) => (
          <li key={todo.id} data-testid="dashboard-todo">
            <span>{todo.title}</span>
          </li>
        ))}
      </ul>

      <h3>Recent activity</h3>
      {activity === null ? (
        <p data-testid="dashboard-activity-unavailable">Activity is unavailable.</p>
      ) : activity.length === 0 ? (
        <p>No activity yet.</p>
      ) : (
        <ul data-testid="activity-list">
          {activity.map((entry) => (
            <li key={entry.id} data-testid="dashboard-activity">
              <span>{entry.type}</span>
              <span>{entry.title}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 3b: Update the test ids in the interface note**

The page exposes `partial-banner`, `error-banner`, `stats`, `activity-list`, plus the granular ids listed above. The e2e specs below use the same names.

- [ ] **Step 4: Wire navigation and the route**

Replace `apps/web/src/App.tsx` with:
```tsx
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { DashboardPage } from './features/dashboard/DashboardPage.js'
import { TodosPage } from './features/todos/TodosPage.js'

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Todo reference</h1>
        <nav aria-label="Main navigation">
          <NavLink to="/todos" data-testid="nav-todos">Todos</NavLink>
          <NavLink to="/dashboard" data-testid="nav-dashboard">Dashboard</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/todos" element={<TodosPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="*" element={<Navigate to="/todos" replace />} />
        </Routes>
      </main>
    </div>
  )
}
```

Append to `apps/web/src/styles.css`:
```css
[data-testid="partial-banner"] {
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 8px 12px;
  margin: 12px 0;
}
[data-testid="partial-banner"] ul { margin: 4px 0 0; padding-left: 18px; }
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @repo/shared build && pnpm --filter web test && pnpm --filter web typecheck`
Expected: 5 dashboard tests PASS (plus the earlier todos/api tests); typecheck clean.

```bash
git add apps/web/src
git commit -m "feat(web): add dashboard page with partial-result banner and navigation"
```

---

### Task 13: Playwright e2e suite

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/global-setup.ts`, `apps/web/e2e/global-teardown.ts`
- Create: `apps/web/e2e/fixtures/seeded.ts`
- Create: `apps/web/e2e/features/todos/todos.e2e.ts`
- Create: `apps/web/e2e/features/dashboard/dashboard.e2e.ts`
- Create: `apps/web/e2e/features/dashboard/dashboard-partial.e2e.ts`

**Interfaces:**
- Produces: `test` fixture extending `@playwright/test` with option `seedTodos: string[]` and fixture `seed: { id, todos }`; the fixture adds `x-e2e-seed-id` to every `/api/v1/**` browser request and deletes the partition in teardown.
- Produces: global seed file `apps/web/.e2e-global-seed.json` (already gitignored) containing `{ id }`.

**Notes:**
- The API must run with `E2E=true`; the config does this. Never seed by touching the repo directly.
- Stop a plain `pnpm dev` API before running e2e: `reuseExistingServer` would attach to an API without the seed routes.
- Mutating specs use the per-test `seed` fixture. The dashboard "full" spec uses the global seed so `global-setup`/`global-teardown` are exercised.
- The partial spec fulfills the route with a payload validated by `DashboardOutputSchema.parse`, so a contract drift fails the mock at author time.

- [ ] **Step 1: Add the Playwright config**

`apps/web/playwright.config.ts`
```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const apiURL = process.env.API_URL ?? 'http://localhost:3000'
const webURL = process.env.WEB_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: webURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @repo/shared build && pnpm --filter api dev',
      cwd: repoRoot,
      url: `${apiURL}/api/v1/health`,
      env: { E2E: 'true', OTEL_TRACES_EXPORTER: 'none', PORT: '3000' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm dev',
      cwd: here,
      url: webURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
```

- [ ] **Step 2: Add the global seed lifecycle**

`apps/web/e2e/global-setup.ts`
```ts
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SeedOutputSchema } from '@repo/shared'

const apiURL = process.env.API_URL ?? 'http://localhost:3000'
const seedFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.e2e-global-seed.json',
)

export default async function globalSetup(): Promise<void> {
  const response = await fetch(`${apiURL}/api/test/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ todos: ['Global seeded task'] }),
  })
  if (!response.ok) {
    throw new Error(`Global seed failed with status ${response.status}`)
  }
  const seed = SeedOutputSchema.parse(await response.json())
  await writeFile(seedFile, JSON.stringify({ id: seed.id }), 'utf8')
}
```

`apps/web/e2e/global-teardown.ts`
```ts
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const apiURL = process.env.API_URL ?? 'http://localhost:3000'
const seedFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.e2e-global-seed.json',
)

export default async function globalTeardown(): Promise<void> {
  try {
    const raw = await readFile(seedFile, 'utf8')
    const { id } = JSON.parse(raw) as { id: string }
    await fetch(`${apiURL}/api/test/seed/${id}`, { method: 'DELETE' })
  } catch {
    // Nothing to clean up; do not fail the run because of teardown.
  } finally {
    await rm(seedFile, { force: true })
  }
}
```

- [ ] **Step 3: Add the seeded fixture**

`apps/web/e2e/fixtures/seeded.ts`
```ts
import { expect, test as base, type Page } from '@playwright/test'
import { SeedOutputSchema } from '@repo/shared'

const apiURL = process.env.API_URL ?? 'http://localhost:3000'

interface Seed {
  id: string
  todos: string[]
}

async function attachSeedHeader(page: Page, seedId: string): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    await route.continue({
      headers: { ...route.request().headers(), 'x-e2e-seed-id': seedId },
    })
  })
}

export const test = base.extend<{
  seedTodos: string[]
  seed: Seed
}>({
  seedTodos: [[], { option: true }],

  seed: async ({ request, page, seedTodos }, use) => {
    const response = await request.post(`${apiURL}/api/test/seed`, {
      data: { todos: seedTodos },
    })
    if (!response.ok()) {
      throw new Error(`Seed failed with status ${response.status()}`)
    }
    const { id } = SeedOutputSchema.parse(await response.json())

    await attachSeedHeader(page, id)
    try {
      await use({ id, todos: seedTodos })
    } finally {
      await request.delete(`${apiURL}/api/test/seed/${id}`)
    }
  },
})

export { expect }
```

- [ ] **Step 4: Write the todos journey**

`apps/web/e2e/features/todos/todos.e2e.ts`
```ts
import { expect, test } from '../../fixtures/seeded.js'

test.use({ seedTodos: ['E2E seed one'] })

test('creates, completes, filters, and deletes a todo', async ({ page, seed }) => {
  expect(seed.todos).toEqual(['E2E seed one'])

  await page.goto('/todos')
  await expect(page.getByTestId('todo-item')).toHaveCount(1)

  await page.getByTestId('todo-input').fill('E2E created task')
  await page.getByTestId('todo-add').click()
  await expect(page.getByTestId('todo-item')).toHaveCount(2)
  await expect(page.getByText('E2E created task')).toBeVisible()

  await page.reload()
  await expect(page.getByText('E2E created task')).toBeVisible()

  const created = page.getByTestId('todo-item').filter({ hasText: 'E2E created task' })
  await created.getByTestId('todo-toggle').check()

  await page.getByTestId('filter-active').click()
  await expect(page.getByText('E2E seed one')).toBeVisible()
  await expect(page.getByText('E2E created task')).toHaveCount(0)

  await page.getByTestId('filter-done').click()
  await expect(page.getByText('E2E created task')).toBeVisible()

  await page
    .getByTestId('todo-item')
    .filter({ hasText: 'E2E created task' })
    .getByTestId('todo-delete')
    .click()
  await expect(page.getByText('E2E created task')).toHaveCount(0)
})
```

- [ ] **Step 5: Write the dashboard journey**

`apps/web/e2e/features/dashboard/dashboard.e2e.ts`
```ts
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '../../fixtures/seeded.js'

const seedFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
  '.e2e-global-seed.json',
)

test('shows the global seed and records new activity', async ({ page }) => {
  const { id } = JSON.parse(await readFile(seedFile, 'utf8')) as { id: string }
  await page.route('**/api/v1/**', async (route) => {
    await route.continue({
      headers: { ...route.request().headers(), 'x-e2e-seed-id': id },
    })
  })

  await page.goto('/todos')
  await expect(page.getByText('Global seeded task')).toBeVisible()

  await page.getByTestId('todo-input').fill('Journey task')
  await page.getByTestId('todo-add').click()
  await expect(page.getByText('Journey task')).toBeVisible()

  await page.getByTestId('nav-dashboard').click()

  await expect(page.getByTestId('stats-total')).toHaveText('Total: 2')
  await expect(page.getByTestId('stats-active')).toHaveText('Active: 2')
  await expect(page.getByTestId('stats-rate')).toHaveText('Completion: 0%')
  await expect(page.getByTestId('dashboard-todo')).toHaveCount(2)
  await expect(page.getByTestId('dashboard-activity')).toHaveCount(1)
  await expect(page.getByTestId('dashboard-activity')).toContainText('Journey task')
  await expect(page.getByTestId('partial-banner')).toHaveCount(0)
})
```

- [ ] **Step 6: Write the partial dashboard check**

`apps/web/e2e/features/dashboard/dashboard-partial.e2e.ts`
```ts
import { DashboardOutputSchema } from '@repo/shared'
import { expect, test } from '../../fixtures/seeded.js'

test('shows the partial banner when stats are unavailable', async ({ page }) => {
  const partial = DashboardOutputSchema.parse({
    todos: [
      {
        id: 'partial-1',
        title: 'Partial seed todo',
        completed: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    stats: null,
    activity: [],
    meta: {
      partial: true,
      warnings: ['stats unavailable: stats down'],
      failedTasks: ['stats'],
    },
  })

  await page.route('**/api/v1/dashboard', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(partial),
    })
  })

  await page.goto('/dashboard')

  await expect(page.getByTestId('partial-banner')).toBeVisible()
  await expect(page.getByTestId('dashboard-warning')).toContainText('stats unavailable')
  await expect(page.getByTestId('dashboard-stats-unavailable')).toBeVisible()
  await expect(page.getByText('Partial seed todo')).toBeVisible()
})
```

- [ ] **Step 7: Install Chromium and run**

Run: `pnpm --filter web exec playwright install chromium`
Run: `pnpm e2e`
Expected: 3 e2e tests PASS. Then inspect the report with `pnpm --filter web exec playwright show-report` if a failure occurs.

- [ ] **Step 8: Commit**

```bash
git add apps/web/playwright.config.ts apps/web/e2e
git commit -m "test(e2e): add seeded playwright journeys and partial dashboard check"
```

---

### Task 14: Production static serving, docs, generator, full verification

**Files:**
- Modify: `apps/api/src/app.ts` (serve `webDist` + SPA fallback)
- Modify: `apps/api/src/server.ts` (production `webDist`)
- Create: `apps/api/src/static.test.ts`
- Create: `README.md` (replace the placeholder)
- Create: `scripts/gen-feature.mjs`

**Interfaces:**
- Produces: `createApp({ ..., webDist })` serves `index.html` for non-API GETs and keeps JSON 404s under `/api`.
- Produces: `pnpm gen feature <name>` creating the vertical-slice skeleton.

- [ ] **Step 1: Write the failing static-serving test**

`apps/api/src/static.test.ts`
```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Ok } from '@repo/shared'
import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { createMemoryTodosRepo } from './features/todos/repo.js'
import { createActivityLog } from './shared/activityLog.js'

const dir = mkdtempSync(path.join(tmpdir(), 'todo-web-'))
writeFileSync(path.join(dir, 'index.html'), '<div id="root">spa shell</div>')

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const app = () =>
  createApp({
    todosRepo: createMemoryTodosRepo([]),
    activityLog: createActivityLog(),
    stats: { get: async () => Ok({ total: 0, active: 0, completed: 0, completionRate: 0 }) },
    webDist: dir,
  })

describe('production static serving', () => {
  it('serves index.html for client routes', async () => {
    const res = await request(app()).get('/dashboard').expect(200)
    expect(res.text).toContain('spa shell')
  })

  it('keeps unknown API routes as JSON 404s', async () => {
    const res = await request(app()).get('/api/nope').expect(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api test static`
Expected: FAIL — `/dashboard` returns 404.

- [ ] **Step 3: Serve the built web app**

In `apps/api/src/app.ts`, add the import:
```ts
import path from 'node:path'
```
After the `/api` 404 middleware and before the error middleware, add:
```ts
  const webDist = deps.webDist
  if (webDist) {
    app.use(express.static(webDist))
    app.get('*', (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'))
    })
  }
```
Order matters: `/api/v1` router, then `/api` JSON 404, then static, then SPA fallback, then the error handler.

- [ ] **Step 4: Pass the production build path from `server.ts`**

Replace `apps/api/src/server.ts` with:
```ts
import './shared/observability/otel.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { createStats } from './features/dashboard/stats.js'
import { createMemoryTodosRepo } from './features/todos/repo.js'
import { createActivityLog } from './shared/activityLog.js'
import { logger } from './shared/observability/logger.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const todosRepo = createMemoryTodosRepo()

const app = createApp({
  todosRepo,
  activityLog: createActivityLog(),
  stats: createStats({ todosRepo }),
  e2e: process.env.E2E === 'true',
  webDist:
    process.env.NODE_ENV === 'production'
      ? process.env.WEB_DIST ?? path.resolve(here, '../../web/dist')
      : undefined,
})

const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => {
  logger.info('api listening', { port })
})
```

- [ ] **Step 5: Run the static tests**

Run: `pnpm --filter api test static`
Expected: 2 tests PASS.

- [ ] **Step 6: Write the root README**

Replace `README.md` with:
````markdown
# ts-ri reference app

A small todo app that exists to demonstrate the `ts-ri` architecture end to end:
vertical slices, shared zod contracts, `Result<T,E>`, `fanOut` with partial
results, OpenTelemetry tracing, and seeded Playwright e2e tests.

## Quickstart

```bash
pnpm install
pnpm --filter @repo/shared build
pnpm dev
```

- Web: http://localhost:5173 (Vite proxies `/api` to `:3000`)
- API: http://localhost:3000/api/v1/health

Production:

```bash
pnpm build
pnpm start   # serves the built web app from the API on :3000
```

## Slices

| Slice | Intent | Critical | Degradable |
| --- | --- | --- | --- |
| `todos` | capture, complete, filter, delete todos | in-memory repo | none |
| `dashboard` | overview of todos, stats, activity | `todos` read | `stats`, `activity` |

`GET /api/v1/dashboard` fans out with `todos` critical. If a degradable task
fails or times out, the API still returns 200 with `meta.partial: true`,
`meta.warnings`, and `null` for the missing section. A critical failure returns
`503 DASHBOARD_UNAVAILABLE`.

## Contracts

All cross-app types live in `packages/shared/src/contracts/` as zod schemas.
Change the contract first, then fix type errors in the API and web.

## Tests

```bash
pnpm --filter api test            # unit + usecase tests
pnpm --filter api test:contract   # supertest + safeParse
pnpm --filter web test            # component tests with stubbed fetch
pnpm e2e                          # Playwright, seeds through the test API
pnpm -r typecheck
```

E2E requirements: the API must run with `E2E=true`; `playwright.config.ts`
starts both servers. Tests seed via `POST /api/test/seed` and send
`x-e2e-seed-id`; partitions are deleted in fixture teardown.

## Observability

- Traces: start the collector with `docker compose up jaeger otel-collector`,
  then open http://localhost:16686.
- Disable export with `OTEL_TRACES_EXPORTER=none` (e2e already does).
- Logs are JSON lines with `trace_id`/`span_id`; do not use `console.log`.
- Force a degradable failure with `FAIL_STATS=1`; point stats at a remote
  service with `STATS_URL=http://host/stats`.

## Adding a slice

```bash
pnpm gen feature reports
```

Then add the contract, implement repo/usecase/controller, add the web feature,
and wire it in `app.ts` and `App.tsx`. See `AGENTS.md` for the full checklist.
````

- [ ] **Step 7: Add the feature generator**

`scripts/gen-feature.mjs`
```js
#!/usr/bin/env node
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const name = process.argv[2]

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('Usage: pnpm gen feature <name>  (lowercase letters, digits, dashes)')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiDir = path.join(root, 'apps/api/src/features', name)
const webDir = path.join(root, 'apps/web/src/features', name)

async function exists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

if (await exists(apiDir) || await exists(webDir)) {
  console.error(`Feature "${name}" already exists`)
  process.exit(1)
}

await mkdir(apiDir, { recursive: true })
await mkdir(webDir, { recursive: true })

const files = {
  [path.join(apiDir, 'README.md')]: `# ${name}\n\n**Intent:** TODO\n\n- Critical: TODO\n- Degradable: TODO\n- Tests: TODO\n`,
  [path.join(apiDir, 'domain.ts')]: `// TODO: pure domain types and constructors for ${name}\n`,
  [path.join(apiDir, 'repo.ts')]: `// TODO: repository interface + in-memory implementation for ${name}\n`,
  [path.join(apiDir, 'usecase.ts')]: `// TODO: usecases for ${name}; open a span with runSpan and return Result\n`,
  [path.join(apiDir, 'controller.ts')]: `// TODO: Router for ${name}; safeParse contracts and sendResult\n`,
  [path.join(webDir, `${name}.api.ts`)]: `// TODO: apiFetch calls for ${name}\n`,
  [path.join(webDir, `${name}.query.ts`)]: `// TODO: TanStack Query hooks for ${name}\n`,
  [path.join(webDir, `${name[0].toUpperCase()}${name.slice(1)}Page.tsx`)]:
    `// TODO: page component for ${name}; use data-testid\n`,
}

for (const [file, content] of Object.entries(files)) {
  await writeFile(file, content, 'utf8')
}

console.log(`Created ${name}:`)
console.log(`  apps/api/src/features/${name}/`)
console.log(`  apps/web/src/features/${name}/`)
console.log('Next: add the contract in packages/shared/src/contracts, then wire the router and route.')
```

- [ ] **Step 8: Full verification**

Run this sequence in order and stop at the first failure:

```bash
pnpm install
pnpm --filter @repo/shared build
pnpm --filter @repo/shared test
pnpm --filter api test
pnpm --filter api test:contract
pnpm --filter web test
pnpm -r typecheck
pnpm e2e
pnpm build
```

Then smoke-test production:

```bash
NODE_ENV=production PORT=3100 node apps/api/dist/server.js
curl -s http://localhost:3100/api/v1/health
curl -s http://localhost:3100/dashboard | head -c 200
```

Expected: `{"status":"ok"}` and the built `index.html` shell. Stop the server after checking.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src README.md scripts/gen-feature.mjs
git commit -m "feat: serve the production build, document the app, and add the feature generator"
```
