import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'

describe('app shell', () => {
  it('reports health', async () => {
    const res = await request(createApp()).get('/api/v1/health').expect(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(createApp()).get('/api/nope').expect(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('maps malformed JSON to a validation error', async () => {
    const res = await request(createApp())
      .post('/api/v1/todos')
      .set('content-type', 'application/json')
      .send('{bad')
      .expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})
