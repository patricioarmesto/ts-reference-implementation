import { Err, Ok, type ActivityEntry, type Todo } from '@repo/shared'
import { describe, expect, it } from 'vitest'
import { createActivityLog } from '../../shared/activityLog.js'
import { notFoundError } from '../../shared/errors.js'
import { makeTodo } from './domain.js'
import type { TodosRepo } from './repo.js'
import { createTodosUseCases } from './usecase.js'

const sample = (id: string, title: string, completed = false): Todo => ({
  id, title, completed,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

function createFakeRepo(initial: Todo[] = []): TodosRepo {
  const todos = new Map(initial.map((todo) => [todo.id, todo]))
  return {
    list: async (filter) => {
      const values = [...todos.values()]
      if (filter === 'active') return Ok(values.filter((todo) => !todo.completed))
      if (filter === 'done') return Ok(values.filter((todo) => todo.completed))
      return Ok(values)
    },
    findById: async (id) => {
      const todo = todos.get(id)
      return todo ? Ok(todo) : Err(notFoundError('missing'))
    },
    create: async (input) => {
      const todo = makeTodo(input.title)
      todos.set(todo.id, todo)
      return Ok(todo)
    },
    setCompleted: async (id, completed) => {
      const todo = todos.get(id)
      if (!todo) return Err(notFoundError('missing'))
      const updated = { ...todo, completed }
      todos.set(id, updated)
      return Ok(updated)
    },
    remove: async (id) => (todos.delete(id) ? Ok(id) : Err(notFoundError('missing'))),
  }
}

describe('todos usecases', () => {
  it('lists todos through the repo', async () => {
    const repo = createFakeRepo([sample('1', 'a'), sample('2', 'b', true)])
    const useCases = createTodosUseCases({ repo, activityLog: createActivityLog() })

    const result = await useCases.list({ filter: 'active' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.todos.map((todo) => todo.title)).toEqual(['a'])
  })

  it('creates a todo and records activity', async () => {
    const repo = createFakeRepo()
    const activityLog = createActivityLog()
    const useCases = createTodosUseCases({ repo, activityLog })

    const result = await useCases.create({ title: 'write plan' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.todo.title).toBe('write plan')

    const activity: ActivityEntry[] = activityLog.recent()
    expect(activity[0]?.type).toBe('created')
    expect(activity[0]?.title).toBe('write plan')
  })

  it('records completed and reopened transitions', async () => {
    const repo = createFakeRepo([sample('1', 'a')])
    const activityLog = createActivityLog()
    const useCases = createTodosUseCases({ repo, activityLog })

    await useCases.setCompleted('1', { completed: true })
    await useCases.setCompleted('1', { completed: false })

    expect(activityLog.recent().map((entry) => entry.type)).toEqual([
      'reopened',
      'completed',
    ])
  })

  it('records the title before deleting', async () => {
    const repo = createFakeRepo([sample('1', 'gone soon')])
    const activityLog = createActivityLog()
    const useCases = createTodosUseCases({ repo, activityLog })

    const result = await useCases.remove('1')
    expect(result.ok).toBe(true)
    expect(activityLog.recent()[0]).toMatchObject({ type: 'deleted', title: 'gone soon' })
  })

  it('propagates NOT_FOUND from the repo', async () => {
    const useCases = createTodosUseCases({
      repo: createFakeRepo(),
      activityLog: createActivityLog(),
    })

    const result = await useCases.setCompleted('missing', { completed: true })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NOT_FOUND')
  })
})
