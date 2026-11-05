import {
  ApiErrorSchema, ListTodosOutputSchema, Ok, TodoOutputSchema,
} from '@repo/shared'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { createActivityLog } from '../../shared/activityLog.js'
import type { StatsProvider } from '../dashboard/stats.js'
import { createMemoryTodosRepo } from './repo.js'

const stats: StatsProvider = {
  get: async () => Ok({ total: 0, active: 0, completed: 0, completionRate: 0 }),
}

function appWithTodos() {
  return createApp({
    todosRepo: createMemoryTodosRepo(['seeded']),
    activityLog: createActivityLog(),
    stats,
  })
}

describe('todos controller', () => {
  it('lists todos with a contract-valid body', async () => {
    const res = await request(appWithTodos()).get('/api/v1/todos').expect(200)
    const parsed = ListTodosOutputSchema.safeParse(res.body)
    expect(parsed.success).toBe(true)
    expect(res.body.todos).toHaveLength(1)
  })

  it('rejects an unknown filter', async () => {
    const res = await request(appWithTodos()).get('/api/v1/todos?filter=later').expect(400)
    expect(ApiErrorSchema.safeParse(res.body).success).toBe(true)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('creates a todo with a contract-valid body', async () => {
    const res = await request(appWithTodos())
      .post('/api/v1/todos')
      .send({ title: '  write tests  ' })
      .expect(201)
    expect(TodoOutputSchema.safeParse(res.body).success).toBe(true)
    expect(res.body.todo.title).toBe('write tests')
  })

  it('rejects a blank title', async () => {
    const res = await request(appWithTodos())
      .post('/api/v1/todos')
      .send({ title: '   ' })
      .expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects a title over 200 characters', async () => {
    const res = await request(appWithTodos())
      .post('/api/v1/todos')
      .send({ title: 'x'.repeat(201) })
      .expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('updates completed and returns the todo', async () => {
    const app = appWithTodos()
    const list = await request(app).get('/api/v1/todos').expect(200)
    const id: string = list.body.todos[0].id

    const res = await request(app)
      .patch(`/api/v1/todos/${id}`)
      .send({ completed: true })
      .expect(200)
    expect(TodoOutputSchema.safeParse(res.body).success).toBe(true)
    expect(res.body.todo.completed).toBe(true)
  })

  it('returns 404 for a missing todo and a second delete', async () => {
    const app = appWithTodos()
    const list = await request(app).get('/api/v1/todos').expect(200)
    const id: string = list.body.todos[0].id

    await request(app).delete(`/api/v1/todos/${id}`).expect(200)
    const res = await request(app).delete(`/api/v1/todos/${id}`).expect(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})
