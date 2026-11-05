import { describe, expect, it, vi } from 'vitest'
import { httpGetJson } from './httpClient.js'

describe('httpGetJson', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"total":2}', { status: 200 })))
    const result = await httpGetJson<{ total: number }>('http://stats.local/stats')
    expect(result).toEqual({ ok: true, value: { total: 2 } })
  })

  it('maps non-2xx responses to UPSTREAM_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const result = await httpGetJson('http://stats.local/stats')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('UPSTREAM_ERROR')
  })

  it('maps network failures to UPSTREAM_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const result = await httpGetJson('http://stats.local/stats')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('UPSTREAM_UNAVAILABLE')
    expect(result.error.message).toContain('offline')
  })
})
