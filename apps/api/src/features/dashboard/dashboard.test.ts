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
