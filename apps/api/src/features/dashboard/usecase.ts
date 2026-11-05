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
