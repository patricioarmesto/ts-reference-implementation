# AGENTS.md

## Overview
Monorepo with vertical slices. One business intent = one folder.
Stack: pnpm workspaces, Express API, Vite React, shared zod contracts, Result<T,E>, Otel.

## Structure
- packages/shared/src/result.ts and contracts/[feature].contract.ts = single source of truth
- apps/api/src/features/[feature]/ = domain.ts, repo.ts, usecase.ts, controller.ts, test.ts, README.md
- apps/api/src/shared/ = fanOut.ts, httpClient.ts, observability/otel.ts
- apps/web/src/features/[feature]/ = [feature].api.ts, [feature].query.ts, [Feature]Page.tsx
- apps/api/src/app.ts = composition root, apps/api/src/server.ts = entry (otel must be first import)

## How to Run
pnpm install
pnpm --filter @repo/shared build
pnpm dev -> api :3000, web :5173 (Vite proxies /api)
pnpm build -> builds shared -> web -> api
pnpm start -> NODE_ENV=production, api serves ../web/dist
pnpm --filter api test [feature]
pnpm e2e

## How to Group Features
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

## Contracts
Contracts live in packages/shared/src/contracts/. They are zod schemas.
- Validator + Type in one: backend uses parse(), frontend uses inferred type
- Single source of truth: both apps import from @repo/shared
- Agents must modify contract FIRST, then fix type errors

Example contract file defines DashboardInput and DashboardOutput with zod.

Never create DTO outside contracts.

## Result<T,E>
Never throw expected errors across layers. Use Result.

Example:
  const r = await repo.findById()
  if (!r.ok) return Err(r.error)
  return Ok(user)

DomainError has code and status. Controller maps to HTTP.

## fanOut
Use shared/fanOut.ts, never raw Promise.all or allSettled.

Example: fanOut({ user: {run: s=>repos.user(id,s), critical:true, timeoutMs:2000}, orders: {run: s=>repos.orders(id,s), critical:false} }, {abortOnCritical:true})

critical:true aborts others via AbortController. Degradable failures return partial with meta.warnings.

## Tests
Co-located, not in /tests.
- dashboard.test.ts = usecase test with fake repos returning Result
- dashboard.controller.test.ts = contract test using DashboardOutput.safeParse(res.body)
- web: DashboardPage.test.tsx with msw

Always run pnpm --filter api test [feature] after touching a feature.

## E2E
- E2E lives in apps/web/e2e/features/[feature]/[feature].e2e.ts
- Uses Playwright, reuses contracts from @repo/shared to validate mocks
- Run pnpm e2e for one feature: pnpm --filter web exec playwright test dashboard
- Use data-testid, not CSS selectors: <div data-testid="partial-banner">
- Mock degradable failures with page.route() to test fanOut partial paths
- Traces saved on failure: npx playwright show-report
- Keep e2e minimal - only critical user journeys, not every edge case (that's for usecase.test.ts)

## Observability - Otel
Setup in apps/api/src/shared/observability/otel.ts. MUST be first import in server.ts.

Rules:
- Never console.log, use logger from observability/logger.ts (injects trace_id)
- Every usecase starts span: tracer.startActiveSpan('GetDashboardUseCase')
- fanOut creates span with attributes tasks, failed_tasks, partial
- Result.Err sets span status ERROR

If collector down, set OTEL_TRACES_EXPORTER=none in .env to disable.

Collector: docker compose up jaeger otel-collector -> http://localhost:16686

## Serving React
Dev: Vite :5173 proxies /api to :3000
Prod: Express serves static ../web/dist with SPA fallback. API routes must be mounted BEFORE static.

In app.ts: app.use('/api/v1', router) first, then express.static(dist), then app.get('*') fallback that ignores /api.

## Adding a New Feature
1. pnpm gen feature [name]
2. Add contract in packages/shared/src/contracts/
3. Implement repo + usecase + controller in apps/api/src/features/[name]/
4. Add api + query + Page in apps/web/src/features/[name]/
5. Wire in app.ts and App.tsx
6. pnpm --filter shared build && test

## DO / DON'T
DO: Keep slices co-located, small files <250 lines, update README, use Result, use shared contracts
DON'T: Create domain/ application/ infrastructure/ layers, duplicate types outside shared, throw for expected errors, mount static before /api

## When It Breaks
- Cannot find @repo/shared -> pnpm install at root, then pnpm --filter shared build, check tsconfig paths
- Otel crash -> move import './shared/observability/otel.js' to line 1 of server.ts, or set OTEL_TRACES_EXPORTER=none
- API returns index.html -> static mounted before /api, fix order in app.ts
- safeParse fails -> contract and implementation drifted, fix contract first then build shared
- pnpm dev hangs -> kill all, rm -rf node_modules/.cache, reinstall