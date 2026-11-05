# Todo Web App — Reference Implementation Design

**Date:** 2026-11-04
**Status:** Approved design, pending spec review
**Author:** Patricio Armesto + agent

## 1. Context

This repository currently contains only `AGENTS.md` and `README.md`. `AGENTS.md`
describes a monorepo with vertical slices, shared zod contracts, `Result<T,E>`,
an Express API, a Vite React app, `fanOut` partial-failure handling, and
OpenTelemetry tracing. None of it exists yet.

The goal is a working, inspectable **reference implementation** of that
architecture. The todo feature is deliberately small so the architecture — not
product surface — is the focus.

## 2. Intent and success criteria

**Intent:** someone can clone the repo, run it, read a feature slice end to end,
and see every rule in `AGENTS.md` applied rather than described.

Success means:

1. `pnpm install && pnpm dev` gives a working app at `http://localhost:5173`.
2. `pnpm test` and `pnpm test:contract` pass in the mandated order — usecases
   (ok, partial, critical, timeout), contract tests via
   `pnpm --filter api test:contract`, then web component tests with mocked fetch.
3. `pnpm e2e` passes against the dev servers: happy paths plus one partial-UI
   check, with every seeded record cleaned up by fixture teardown.
4. Every type crossing API ↔ web is defined once, in `@repo/shared`.
5. The dashboard returns a partial result with `meta.warnings` when a
   degradable dependency fails, and the UI surfaces it.
6. A request appears in Jaeger as a trace with a usecase span and fanOut
   attributes when the collector is running.
7. Each feature folder has a `README.md` stating intent and what is critical
   vs degradable.

**Non-goals:** this is not a product, does not need multi-user support, and is
not deployed anywhere.

## 3. Constraints and assumptions

- Single user. No auth, no users table, no sessions.
- Todos live in memory; data resets when the API restarts. The repo interface is
  the seam for a future database.
- Local-only operation. Jaeger and the OTel collector run via docker compose.
- TypeScript end to end, ESM (`"type": "module"`, `.js` extensions in relative
  imports), Node >= 20, pnpm 9.
- Dependency majors: TypeScript 5, Express 4 (the SPA fallback pattern in
  `AGENTS.md` assumes `app.get('*')`), React 18, Vite 5, Zod 3, TanStack Query 5,
  Vitest 2, Playwright 1.x, OpenTelemetry JS 1.x. Patch versions are not pinned
  in this spec; install current stable within those majors.
- Web component tests stub `fetch` directly (no msw), and every stubbed response
  is parsed with its shared contract.
- A test-only seed API exists only when `E2E=true`; it is never mounted in
  normal dev or production.
- No component library. Hand-written CSS.
- No CI pipeline in this phase.

## 4. Approaches considered

**A. Two slices: `todos` + `dashboard` — CHOSEN.** Matches the `AGENTS.md` rule
that a dashboard is an aggregation with its own intent. fanOut aggregates across
slices, and a degradable task can fail on demand, so partial results are
demonstrable and testable.

**B. One `todos` slice owning both routes — rejected.** Fewer files, but it puts
"see overview" intent inside CRUD, contradicting the architecture being
demonstrated, and fanOut becomes a self-call.

**C. Two slices plus a persisted `activity` slice — rejected.** More realistic but
adds an audit-log subsystem and a second contract for roughly the same fanOut
lesson. Activity stays a shared in-memory log instead.

## 5. Repository layout

```
package.json                 root scripts, devDependencies (concurrently)
pnpm-workspace.yaml
tsconfig.base.json
docker-compose.yml           jaeger + otel-collector
otel-collector-config.yaml
.env.example
scripts/
  gen-feature.mjs

packages/shared/
  package.json               name @repo/shared, builds to dist
  src/index.ts               barrel export
  src/result.ts
  src/contracts/todos.contract.ts
  src/contracts/dashboard.contract.ts
  src/contracts/error.contract.ts
  src/contracts/test-seed.contract.ts   E2E-only seed route DTOs
  src/result.test.ts
  src/contracts/todos.contract.test.ts

apps/api/
  package.json
  src/server.ts              first import: otel
  src/app.ts                 composition root
  src/shared/fanOut.ts
  src/shared/fanOut.test.ts
  src/shared/httpClient.ts   fetch + timeout, returns Result
  src/shared/httpClient.test.ts
  src/shared/e2e.ts          test-only seed store + routes (E2E=true)
  src/shared/e2e.test.ts
  src/shared/activityLog.ts
  src/shared/http.ts         sendResult + error mapping
  src/shared/observability/otel.ts
  src/shared/observability/logger.ts
  src/features/todos/
    domain.ts                Todo, invariants, DomainError codes
    repo.ts                  Repo interface + in-memory implementation + seed
    usecase.ts
    controller.ts
    todos.test.ts
    todos.controller.test.ts
    README.md
  src/features/dashboard/
    stats.ts                 simulated analytics dependency
    usecase.ts
    controller.ts
    dashboard.test.ts
    dashboard.controller.test.ts
    README.md

apps/web/
  package.json               @playwright/test devDependency
  index.html
  vite.config.ts             /api proxy -> :3000
  playwright.config.ts       testDir './e2e', webServer = api + web dev servers
  e2e/
    global-setup.ts          seeds one record, sets E2E_SEED_ID
    global-teardown.ts       deletes it
    fixtures/seeded.ts       per-test seed fixture, header + try/finally cleanup
    features/todos/todos.e2e.ts
    features/dashboard/dashboard.e2e.ts
    features/dashboard/dashboard-partial.e2e.ts
  src/main.tsx
  src/App.tsx                nav + routes
  src/lib/api.ts             fetch wrapper over ApiError envelope
  src/lib/queryClient.ts
  src/test/setup.ts          jest-dom + fetch stub reset
  src/styles.css
  src/features/todos/
    todos.api.ts
    todos.query.ts
    TodosPage.tsx
    TodosPage.test.tsx
  src/features/dashboard/
    dashboard.api.ts
    dashboard.query.ts
    DashboardPage.tsx
    DashboardPage.test.tsx
```

Routes: `/todos` (default redirect) and `/dashboard`, via `react-router-dom`.
Frontend and backend feature folder names match 1:1.

## 6. Contracts (`@repo/shared`)

Zod schemas are the single definition. The API calls `.parse()`; the web imports
`z.infer` types. No DTO is declared outside this package.

```ts
// result.ts
type Result<T, E = DomainError> = Ok<T> | Err<E>
Ok<T>  = { ok: true; value: T }
Err<E> = { ok: false; error: E }
DomainError = { code: string; message: string; status: number; details?: unknown }
// helpers: Ok(), Err(), isOk(), isErr()

// todos.contract.ts
Todo             = { id: string; title: string; completed: boolean;
                     createdAt: string; updatedAt: string }   // ISO 8601
CreateTodoInput  = { title: string }                         // trimmed, 1..200
UpdateTodoInput  = { completed: boolean }
TodoFilter       = 'all' | 'active' | 'done'
ListTodosQuery   = { filter?: TodoFilter }                   // default 'all'
ListTodosOutput  = { todos: Todo[] }
TodoOutput       = { todo: Todo }
DeleteTodoOutput = { id: string }

// dashboard.contract.ts
Stats           = { total: number; active: number; completed: number;
                    completionRate: number }                 // 0..1
ActivityEntry   = { id: string; type: 'created' | 'completed' | 'reopened' | 'deleted';
                    todoId: string; title: string; at: string }
DashboardOutput = { todos: Todo[];
                    stats: Stats | null;
                    activity: ActivityEntry[] | null;
                    meta: { partial: boolean;
                            warnings: string[];
                            failedTasks: string[] } }

// error.contract.ts
ApiError = { error: { code: string; message: string; details?: unknown } }

// test-seed.contract.ts — routes exist only when E2E=true
SeedInput  = { todos?: string[] }          // optional initial titles
SeedOutput = { id: string }                 // e2e-<timestamp>-<counter>
```

`stats` and `activity` are nullable because either degradable task may fail.
`meta.failedTasks` carries machine-readable task names for debugging;
`meta.warnings` carries human-readable messages for the UI.

`test-seed` is the only test-only contract. It lets Playwright create isolated
data without touching internals, and it exists to satisfy the "no direct seeding
from e2e" rule in `AGENTS.md`.

## 7. HTTP API

Mounted at `/api/v1` in `app.ts`, before static assets.

| Method | Path                | Success | Body / query                  |
| ------ | ------------------- | ------- | ----------------------------- |
| GET    | `/todos`            | 200     | `ListTodosOutput`, `?filter=` |
| POST   | `/todos`            | 201     | `CreateTodoInput` → `TodoOutput` |
| PATCH  | `/todos/:id`        | 200     | `UpdateTodoInput` → `TodoOutput` |
| DELETE | `/todos/:id`        | 200     | `DeleteTodoOutput`            |
| GET    | `/dashboard`        | 200     | `DashboardOutput`             |
| GET    | `/health`           | 200     | `{ status: 'ok' }`            |

`PATCH` takes an explicit `completed` boolean (idempotent) rather than toggling
server state. `DELETE` returns a body so every handler follows the same
Result-to-response shape. Unknown `/api/*` paths return JSON 404 and are never
served `index.html`.

**E2E-only routes**, mounted by `createApp` only when `E2E=true`, outside
`/api/v1`:

| Method | Path                  | Success | Body / result            |
| ------ | --------------------- | ------- | ------------------------ |
| POST   | `/api/test/seed`      | 201     | `SeedInput` → `SeedOutput` |
| DELETE | `/api/test/seed/:id`  | 200     | `{ id }`                 |

Routes are absent (404) when `E2E` is unset, so they cannot be reached in normal
dev or production. Seeding accepts optional todo titles; each seed id owns an
isolated partition so parallel Playwright workers cannot collide.

## 8. Domain and repositories

- `Todo` is created with `crypto.randomUUID()`, trimmed title, `completed: false`,
  and equal `createdAt`/`updatedAt` timestamps.
- `PATCH` sets `completed` and refreshes `updatedAt`, regardless of previous
  value.
- Deleting a missing todo is `NOT_FOUND`.
- In-memory repo is a `Map<string, Todo>` behind an interface:

```ts
interface TodosRepo {
  list(filter: TodoFilter): Promise<Result<Todo[]>>
  findById(id: string): Promise<Result<Todo>>
  create(input: CreateTodoInput): Promise<Result<Todo>>
  setCompleted(id: string, completed: boolean): Promise<Result<Todo>>
  remove(id: string): Promise<Result<string>>
}
```

Repo methods return `Result` so the usecase never handles exceptions. The
in-memory implementation seeds three sample todos in the default store at module
init so the app and dashboard are not empty on first load. Seeding is documented
in the feature README and is not configurable in this phase.

**E2E partitioning.** When `E2E=true`, `createApp` installs the test-seed routes
and an `AsyncLocalStorage` context. Middleware reads the `x-e2e-seed-id` request
header; the repo resolves its `Map` from that context (falling back to the
default store when no header is present). Usecase and repo interfaces stay
unchanged, seeding/deleting a partition cannot touch other tests' data, and
normal mode never sees the context or the routes.

This repo has no users, so `AGENTS.md`'s "seed one user" fixture is realized as
"seed one todo partition". The partition context uses `AsyncLocalStorage` rather
than repos reaching into `app.get('e2eStore')`; that keeps repos free of Express
coupling while preserving the isolation intent.

## 9. fanOut

Single implementation in `apps/api/src/shared/fanOut.ts`; raw `Promise.all` /
`allSettled` is forbidden elsewhere.

```ts
type Task<T> = {
  run: (signal: AbortSignal) => Promise<Result<T>>
  critical?: boolean
  timeoutMs?: number      // default 2000
}

fanOut(tasks: Record<string, Task<T>>, opts: { abortOnCritical?: boolean }): Promise<
  Result<{ data: Partial<Record<string, T>>;
           warnings: string[];
           failedTasks: string[];
           partial: boolean }>
>
```

Behavior:

- All tasks start concurrently with one shared `AbortController`.
- A critical failure or timeout aborts siblings when `abortOnCritical` is true
  and resolves `Err` with that task's DomainError (normalized to `INTERNAL` if
  the task returned a non-DomainError). fanOut stays generic; the dashboard
  usecase maps a critical failure to `DASHBOARD_UNAVAILABLE` 503.
- A degradable failure or timeout keeps sibling values, adds one warning and one
  `failedTasks` entry, and sets `partial: true`.
- The span records `tasks`, `failed_tasks`, and `partial` attributes.
- Task results are `Result` values; a thrown exception is caught and treated as a
  failure with an `INTERNAL` DomainError.

## 10. Dashboard aggregation

`GetDashboardUseCase` calls:

| Task       | Source                                   | Critical | Failure mode                       |
| ---------- | ---------------------------------------- | -------- | ---------------------------------- |
| `todos`    | todos repo, all todos                    | yes      | usecase returns 503 `DASHBOARD_UNAVAILABLE` |
| `stats`    | `features/dashboard/stats.ts`            | no       | stats `null` + warning             |
| `activity` | `shared/activityLog.ts`, last 10 entries | no       | activity `null` + warning          |

`stats.ts` stands in for an analytics service. By default it computes
total/active/completed and `completionRate` from the todos repo and returns
`Err(DASHBOARD_UNAVAILABLE)` when `FAIL_STATS=1`. When `STATS_URL` is set it calls
that service through `shared/httpClient.ts` (timeout + `Result`, no raw `fetch`
in features), which is the realistic outbound-call path and keeps the shared
client exercised. Both paths are covered by unit tests. This makes partial
results observable in the browser and in usecase/controller tests without
requiring a second service; e2e partial paths are mocked at the network layer
instead (section 14).

`activityLog.ts` is a capped ring buffer (50 entries) appended by todos usecases
on create/completed/reopened/delete. It stores the todo title at event time so
deleted todos still appear in the feed. This is the one genuine cross-slice data
dependency and is intentional: it exercises shared infrastructure without adding
a third feature slice.

## 11. Error handling

- Expected errors are returned as `Result`, never thrown across layers.
- Codes: `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `DASHBOARD_UNAVAILABLE`
  (503), `INTERNAL` (500).
- Controllers use `safeParse` on body/query/params. Failure becomes
  `Err(VALIDATION_ERROR)` with flattened zod issues in `details`.
- `sendResult(res, result, successStatus)` in `shared/http.ts` maps `Ok` to the
  success status and `Err` to `error.status` with the `ApiError` envelope.
- The Express error middleware logs unexpected throws via the logger and returns
  `INTERNAL` 500 in the same envelope.
- Web `lib/api.ts` parses the envelope on non-2xx and throws `ApiRequestError`
  carrying code/message/status; pages render the message in an `aria-live` region.
- `app.ts` exports `createApp(deps)` (todos repo, stats, activity log) and
  `server.ts` passes production implementations. Controller tests inject fakes
  through `createApp`, so the real routers, validators, and error mapping are
  exercised while failures are induced deterministically.

## 12. Observability

- `apps/api/src/shared/observability/otel.ts` is the first import in `server.ts`.
  It starts a NodeSDK with an OTLP HTTP exporter at
  `http://localhost:4318/v1/traces`, service name `todo-api`, and
  auto-instrumentation for http/express.
- `OTEL_TRACES_EXPORTER=none` disables tracing entirely (documented escape hatch
  when the collector is down).
- Every usecase opens a span: `ListTodosUseCase`, `CreateTodoUseCase`,
  `SetTodoCompletedUseCase`, `DeleteTodoUseCase`, `GetDashboardUseCase`. `Err`
  sets status ERROR and records the exception.
- `logger.ts` emits JSON lines with level, message, and `trace_id`/`span_id` from
  the active span. No `console.log` in application code.
- `docker compose up jaeger otel-collector` exposes Jaeger UI on :16686; the
  collector receives OTLP HTTP on :4318 and forwards to Jaeger on :4317.
- `GET /health` is a trivial handler used for readiness checks; it does no
  logging and opens no manual spans (auto-instrumentation may still record it).

## 13. Web app

- `App.tsx`: header with nav links (Todos, Dashboard) and a warning-free shell;
  routes render `TodosPage` and `DashboardPage`.
- `TodosPage`: title input + Add button, filter tabs All/Active/Done, list with
  checkbox and delete button, empty state, loading state, inline error. Mutations
  invalidate both `['todos']` and `['dashboard']`.
- `DashboardPage`: stat cards (total/active/completed/completion rate), recent
  activity feed, preview of up to five active todos, and a dismissible warning
  banner when `meta.partial` is true. Critical failure renders an error state
  with retry.
- Accessibility: labelled form controls, semantic `ul`/`li`, checkbox with an
  accessible name per todo, `aria-live="polite"` for errors and warnings, focus
  returned to the title input after adding.
- `data-testid` hooks for e2e: `todo-input`, `todo-add`, `todo-item`,
  `todo-toggle`, `todo-delete`, `filter-all|active|done`, `stats`,
  `activity-list`, `partial-banner`, `error-banner`. Tests use these, not CSS
  selectors.
- Styling: one `styles.css`, CSS variables, responsive down to 360px,
  `prefers-color-scheme` dark variant. No CSS framework.

## 14. Testing

Order matters, fail fast (`AGENTS.md` §8): usecase → contract → web component →
e2e. E2E is only run after unit/contract tests pass.

**Shared** (`vitest`)

- `result.test.ts`: Ok/Err narrowing, helpers.
- `todos.contract.test.ts`: rejects empty/blank title, >200 chars, bad filter.

**API usecases** (`vitest`, fake repos returning `Result`)

- `fanOut.test.ts`: all succeed; degradable failure yields partial + warning;
  critical failure aborts siblings; timeout marks the task failed.
- `todos.test.ts`: create/list/filter/set-completed/delete; `NOT_FOUND`; blank
  title rejection; activity-log side effects. Todos is not a fanOut usecase, so
  partial/critical/timeout do not apply here.
- `dashboard.test.ts`: the four mandated cases — ok; partial (`stats` fails, result
  has `stats: null` + warning); critical failure (`todos` task fails →
  `DASHBOARD_UNAVAILABLE`); timeout (`stats` task exceeds `timeoutMs` → partial).
  Also asserts activity ordering and the 50-entry cap.
- `e2e.test.ts`: seed partition create/list isolation and delete; routes return
  404 when `E2E` is unset.

**API contract** (`supertest` + shared `safeParse`)

- `todos.controller.test.ts`: status codes and JSON shape validated with
  `ListTodosOutput.safeParse`, `TodoOutput.safeParse`, `ApiError.safeParse`.
- `dashboard.controller.test.ts`: 200 full and partial with
  `DashboardOutput.safeParse`; 503 shape when the critical task fails (failure
  injected through `createApp` fakes).
- Both run under `pnpm --filter api test:contract`; usecase tests run under
  `pnpm --filter api test [feature]`. The `test` script excludes
  `*.controller.test.ts`; `test:contract` matches only those files.

**Web components** (`vitest` + Testing Library, fetch stubbed with `vi.stubGlobal`)

- Stubs return contract-valid data built with `ListTodosOutput.parse` /
  `DashboardOutput.parse`; no msw.
- `TodosPage.test.tsx`: renders todos, adds one, toggles, filters, shows the
  server error message from the `ApiError` envelope.
- `DashboardPage.test.tsx`: renders stats and activity; renders the warning
  banner and null-stat placeholders when the response is partial.

**E2E** (`@playwright/test`, per `AGENTS.md` §§9–10)

- Location: `apps/web/e2e/features/[feature]/[feature].e2e.ts`; config at
  `apps/web/playwright.config.ts` (`testDir: './e2e'`, `trace:
  'retain-on-failure'`, html reporter, `globalSetup`/`globalTeardown`). Workers
  may run in parallel because every test owns a seed partition.
- `webServer` starts **both** dev servers: API with `E2E=true` on :3000 and Vite
  on :5173 (baseURL). It builds `@repo/shared` first so the API can boot; a
  manually started `E2E=true pnpm dev` is reused outside CI. Playwright starts the
  webServer before global setup, so seeding can hit a live API.
- Seed data only through the test API. `e2e/fixtures/seeded.ts` extends the
  Playwright `test` with a `seed` fixture: POST `/api/test/seed`, set
  `x-e2e-seed-id` via `page.setExtraHTTPHeaders`, `use(id)`, then DELETE in
  `finally` even when the test fails. `global-setup.ts` seeds one record and sets
  `process.env.E2E_SEED_ID`; `global-teardown.ts` deletes it.
- `todos/todos.e2e.ts`: critical journey — add via `todo-input`/`todo-add`,
  toggle, filter Active/Done, reload and confirm persistence.
- `dashboard/dashboard.e2e.ts`: nav works, stats/activity reflect data seeded
  through the UI, active preview renders.
- `dashboard/dashboard-partial.e2e.ts`: `page.route('**/api/v1/dashboard', ...)`
  fulfills a partial payload built and validated with `DashboardOutput.parse`;
  asserts `data-testid="partial-banner"` is visible and todo content still
  renders.
- Selectors are `data-testid` only. Scope is the happy path plus the single
  partial-UI check; validation, empty states, ordering, and failure permutations
  stay in usecase/page tests.
- Runs: `pnpm e2e`; one feature:
  `pnpm --filter web exec playwright test dashboard`; interactive:
  `pnpm --filter web exec playwright test --ui`. Report/traces on failure:
  `npx playwright show-report`. `pnpm exec playwright install chromium` is a
  one-time local prerequisite; CI is out of scope.

## 15. Dev workflow and configuration

Root scripts:

| Script             | Behavior                                                                 |
| ------------------ | ------------------------------------------------------------------------ |
| `dev`              | build shared, then run shared `tsc -w`, api `tsx watch`, web `vite` concurrently |
| `build`            | shared → web → api                                                       |
| `start`            | `NODE_ENV=production node apps/api/dist/server.js`                       |
| `test`             | `@repo/shared` + api usecase/unit + web component tests                  |
| `test:contract`    | `pnpm --filter api test:contract` (supertest + `safeParse`)              |
| `e2e`              | `pnpm --filter web exec playwright test` (webServer starts api `E2E=true` + web) |
| `gen`              | `node scripts/gen-feature.mjs`                                           |
| `typecheck`        | `pnpm -r typecheck`                                                      |

- `@repo/shared` compiles to `dist` with declarations; api/web resolve it through
  package exports. Editing shared during dev requires the running `tsc -w`.
- Vite dev server proxies `/api` to `http://localhost:3000`. No CORS middleware is
  needed: dev is same-origin through the proxy, production is same-origin from
  Express.
- Production: Express mounts `/api/v1`, then `express.static(apps/web/dist)`, then
  a SPA fallback that ignores `/api` paths.
- `.env.example`: `PORT=3000`, `OTEL_TRACES_EXPORTER=otlp`,
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`, `FAIL_STATS=0`,
  `STATS_URL=` (unset: compute locally), `E2E=0`.
- `E2E=true` exposes `/api/test/seed` and request-scoped partitions. Playwright's
  webServer sets it for the API; `pnpm dev` does not.
- `pnpm gen feature <name>` creates api (`domain`, `repo`, `usecase`,
  `controller`, `README`) and web (`api`, `query`, `Page`) skeleton files with
  TODO markers and prints the wiring steps. It scaffolds structure only; it does
  not generate working feature logic.

## 16. Risks and mitigations

- **OTel exporter noise when the collector is down.** Documented `none` escape
  hatch and `.env.example` default; `/health` stays trace-free.
- **fanOut complexity leaking into usecases.** fanOut is the only concurrency
  primitive; its API is fixed by this spec and tested in isolation.
- **Shared package build friction in dev.** `dev` prebuilds and watches shared;
  `build` orders shared first; troubleshooting section in `AGENTS.md`-style
  README updates is part of the plan.
- **E2E seed leakage or collisions.** Each seed id owns a partition; the
  `seeded.ts` fixture deletes in `finally`, global teardown removes the shared
  seed, and `shared/e2e.test.ts` covers seed/delete. Parallel workers do not
  share data.
- **Test-only API reaching production.** Routes and the partition context are
  mounted only when `E2E=true`; the contract test asserts a 404 when unset.
- **Playwright webServer timeout.** webServer builds `@repo/shared` before
  starting the API; `pnpm --filter @repo/shared build` is the documented fix.
- **Express 4 vs 5 routing.** Pinned to Express 4; the SPA fallback uses
  `app.get('*')` and API routes are mounted first.

## 17. Out of scope

Auth/users, database persistence, editing todo titles, drag-and-drop ordering,
pagination, filtering by date, CI pipelines, deployment, rate limiting, i18n,
and any feature slice beyond `todos` and `dashboard`.
