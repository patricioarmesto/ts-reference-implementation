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
