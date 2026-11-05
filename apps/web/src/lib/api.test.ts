import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError, apiFetch } from './api.js'

const respond = (body: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
} as unknown as Response)

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ todos: [] })))
    await expect(apiFetch('/todos')).resolves.toEqual({ todos: [] })
  })

  it('throws a typed error built from the ApiError envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid todo' } }, 400,
    )))
    await expect(apiFetch('/todos')).rejects.toMatchObject({
      name: 'ApiRequestError', status: 400, code: 'VALIDATION_ERROR', message: 'Invalid todo',
    })
  })

  it('falls back to a generic error when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('Unexpected token <') },
    } as unknown as Response)))

    const error = await apiFetch('/todos').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 502, message: 'Request failed with status 502' })
  })
})
