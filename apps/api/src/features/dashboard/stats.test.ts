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
