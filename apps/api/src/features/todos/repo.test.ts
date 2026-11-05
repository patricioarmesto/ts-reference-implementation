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
