# AGENTS.md

## 1. Overview
Monorepo with vertical slices. One business intent = one folder.
Stack: pnpm workspaces, 【entity-Express¦canonical_name=Express】 API, Vite React, shared zod contracts, Result<T,E>, Otel, Playwright.

## 2. Structure
- packages/shared/src/result.ts and contracts/[feature].contract.ts = single source of truth
- apps/api/src/features/[feature]/ = domain.ts, repo.ts, usecase.ts, controller.ts, test.ts, README.md
- apps/api/src/shared/ = fanOut.ts, httpClient.ts, observability/otel.ts, logger.ts
- apps/web/src/features/[feature]/ = [feature].api.ts, [feature].query.ts, [Feature]Page.tsx
- apps/web/e2e/features/[feature]/ = [feature].e2e.ts + fixtures/seeded.ts + global-setup.ts
- apps/api/src/app.ts = composition root, server.ts = entry (otel must be first import)

## 3. How to Run
pnpm install
pnpm --filter @repo/shared build
pnpm dev -> api :3000, web :5173 (Vite proxies /api)
pnpm build -> builds shared -> web -> api
pnpm start -> NODE_ENV=production, api serves ../web/dist
pnpm --filter api test [feature]
pnpm e2e -> runs Playwright with global setup

## 4. How to Group Features
Group by intent that changes together, not by entity.
- auth/ = login, logout, register (intent: identity)
- dashboard/ = user+orders+recs aggregation (intent: see overview)
- checkout/ = cart+payment+order (intent: buy)

Rules:
1. Mirror your nav. /dashboard -> features/dashboard/
2. If folder >8 files or >800 LOC, split into checkout/cart/, checkout/payment/
3. Shared DTOs (UserDto) live in @repo/shared, never duplicate
4. Each feature has README.md: Intent + what is critical vs degradable
5. Frontend and backend feature names must match 1:1

## 5. Contracts
Contracts live in packages/shared/src/contracts/. They are zod schemas.
- Validator + Type in one: backend uses parse(), frontend uses inferred type
- Single source of truth: both apps import same file
- Agents must modify contract FIRST, then fix type errors

Never create DTO outside contracts. Contract example defines DashboardInput and DashboardOutput with zod.

## 6. Result<T,E>
Never throw expected errors across layers. Use Result from @repo/shared.
If repo fails, return Err({code, status}), not throw. Controller maps Err to HTTP. Use Ok(value) for success.

## 7. fanOut
Use shared/fanOut.ts, never raw Promise.all or allSettled.
Example: fanOut({ user: {run: s=>repos.user(id,s), critical:true, timeoutMs:2000}, orders: {run: s=>repos.orders(id,s), critical:false} }, {abortOnCritical:true})
critical:true aborts others via AbortController. Degradable failures return partial with meta.warnings.

## 8. Tests - Order Matters
Run in this order, fail fast:
1. Unit / UseCase: apps/api/src/features/[feature]/[feature].test.ts - fake repos returning Result, 4 cases: ok, partial, critical fail, timeout
2. Contract: [feature].controller.test.ts - supertest + DashboardOutput.safeParse(res.body)
3. Web component: DashboardPage.test.tsx with mocked fetch returning contract-valid data
4. E2E: only happy path + one partial UI check

Never run e2e if unit fails. E2E is for wiring, not business logic.

## 9. E2E Browser Tests
Playwright in apps/web/e2e/. Config webServer starts api and web.

Location:
- e2e/features/[feature]/[feature].e2e.ts
- e2e/fixtures/seeded.ts - per-test isolated data
- e2e/global-setup.ts and global-teardown.ts

Use data-testid, not CSS. Mock degradable failures with page.route() but validate mock with DashboardOutput.parse().

Scripts:
pnpm --filter web exec playwright test dashboard
pnpm --filter web exec playwright test --ui

## 10. Test Data - Seed / Teardown
Never seed DB directly from Playwright. Use test-only API when E2E=true.

In app.ts:
- if E2E=true, mount POST /api/test/seed that creates unique id e2e-${Date.now()} and stores in-memory Map
- mount DELETE /api/test/seed/:id that deletes
- repos check app.get('e2eStore') and use it instead of real APIs when present

Fixture pattern:
- seeded.ts creates user via POST /api/test/seed, yields id via use(id), then DELETEs in teardown even if test fails
- global-setup.ts seeds one user and sets process.env.E2E_USER_ID
- global-teardown.ts deletes it

Run: E2E=true pnpm dev, then pnpm e2e. Each test gets unique id, no collision in parallel.

## 11. Observability - Otel
Setup in apps/api/src/shared/observability/otel.ts. MUST be first import in server.ts.

Rules:
- Never console.log, use logger from observability/logger.ts (injects trace_id)
- Every usecase starts span: tracer.startActiveSpan('GetDashboardUseCase')
- fanOut creates span with attributes tasks, failed_tasks, partial
- Result.Err sets span status ERROR

Env: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318, or OTEL_TRACES_EXPORTER=none to disable
Collector: docker compose up jaeger otel-collector -> http://localhost:16686

## 12. Serving React
Dev: Vite :5173 proxies /api to :3000
Prod: 【entity-Express¦canonical_name=Express】 serves static ../web/dist with SPA fallback. API routes must be mounted BEFORE static.

Order in app.ts: app.use('/api/v1', router) first, then 【entity-express¦canonical_name=Express】.static(dist), then app.get('*') fallback that ignores /api.

## 13. Adding a New Feature
1. pnpm gen feature [name]
2. Add contract in packages/shared/src/contracts/
3. Implement repo + usecase + controller in apps/api/src/features/[name]/
4. Add api + query + Page in apps/web/src/features/[name]/
5. Add usecase.test.ts (4 cases) + controller.test.ts (contract parse) + e2e test
6. Wire in app.ts and App.tsx
7. pnpm --filter shared build && test

## 14. DO / DON'T
DO: Keep slices co-located, small files <250 lines, update README, use Result, use shared contracts, use data-testid
DON'T: Create domain/ application/ infrastructure/ layers, duplicate types outside shared, throw for expected errors, mount static before /api, seed DB directly from e2e

## 15. When It Breaks
- Cannot find @repo/shared -> pnpm install at root, then pnpm --filter shared build, check tsconfig paths
- Otel crash -> move import otel to line 1 of server.ts, or set OTEL_TRACES_EXPORTER=none
- API returns index.html -> static mounted before /api, fix order in app.ts
- safeParse fails -> contract and implementation drifted, fix contract first then build shared
- e2e seed not cleaned -> fixture teardown not called, ensure use(id) is in try/finally via fixture, check DELETE endpoint
- Playwright webServer timeout -> api not starting because shared not built, run pnpm --filter shared build first

## 16. Checklist Before PR
- Contract updated in packages/shared if API changed?
- pnpm --filter api test [feature] passes (ok, partial, critical, timeout)?
- pnpm --filter api test:contract passes (safeParse)?
- pnpm e2e [feature].e2e.ts passes?
- No console.log, no throw for expected errors, used Result?
- Span attributes added for new branches?
- README intent updated? data-testid added?
- Seed/teardown cleans up even on failure?