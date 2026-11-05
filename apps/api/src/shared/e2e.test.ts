import { ApiErrorSchema, Ok } from '@repo/shared'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { createActivityLog } from './activityLog.js'
import { createMemoryTodosRepo } from '../features/todos/repo.js'

const stats = { get: async () => Ok({ total: 0, active: 0, completed: 0, completionRate: 0 }) }

const app = (e2e: boolean) => createApp({
  todosRepo: createMemoryTodosRepo([]),
  activityLog: createActivityLog(),
  stats,
  e2e,
})

describe('e2e seed api', () => {
  it('is absent unless E2E is enabled', async () => {
    const res = await request(app(false)).post('/api/test/seed').send({}).expect(404)
    expect(ApiErrorSchema.safeParse(res.body).success).toBe(true)
  })

  it('creates an isolated partition per seed id', async () => {
    const server = app(true)
    const first = await request(server).post('/api/test/seed')
      .send({ todos: ['first seed'] }).expect(201)
    const second = await request(server).post('/api/test/seed')
      .send({ todos: ['second seed'] }).expect(201)

    const firstList = await request(server).get('/api/v1/todos')
      .set('x-e2e-seed-id', first.body.id).expect(200)
    const secondList = await request(server).get('/api/v1/todos')
      .set('x-e2e-seed-id', second.body.id).expect(200)

    expect(firstList.body.todos.map((todo: { title: string }) => todo.title)).toEqual(['first seed'])
    expect(secondList.body.todos.map((todo: { title: string }) => todo.title)).toEqual(['second seed'])

    await request(server).post('/api/v1/todos')
      .set('x-e2e-seed-id', first.body.id)
      .send({ title: 'only in first' })
      .expect(201)

    const secondAgain = await request(server).get('/api/v1/todos')
      .set('x-e2e-seed-id', second.body.id).expect(200)
    expect(secondAgain.body.todos).toHaveLength(1)

    await request(server).delete(`/api/test/seed/${first.body.id}`).expect(200)
    await request(server).delete(`/api/test/seed/${second.body.id}`).expect(200)
  })

  it('rejects an unknown or deleted seed id', async () => {
    const server = app(true)
    const created = await request(server).post('/api/test/seed').send({}).expect(201)

    await request(server).get('/api/v1/todos')
      .set('x-e2e-seed-id', 'e2e-missing').expect(404)

    await request(server).delete(`/api/test/seed/${created.body.id}`).expect(200)
    const stale = await request(server).get('/api/v1/todos')
      .set('x-e2e-seed-id', created.body.id).expect(404)
    expect(stale.body.error.code).toBe('E2E_SEED_NOT_FOUND')
  })
})
