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
