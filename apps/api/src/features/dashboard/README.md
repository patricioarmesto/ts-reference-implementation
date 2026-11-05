# Dashboard

**Intent:** show the overview: every todo, completion stats, and recent activity.

- Critical: `todos` (repo read). If it fails, the whole dashboard is 503.
- Degradable: `stats` (local or `STATS_URL` service) and `activity` (ring buffer).
  Failures return 200 with `meta.partial: true`, `meta.warnings`, and nulls.
- fanOut attributes: `tasks`, `failed_tasks`, `partial` on the span.
- Tests: `dashboard.test.ts` covers ok, partial, critical failure, and timeout;
  `dashboard.controller.test.ts` validates bodies with `DashboardOutput.safeParse`.
