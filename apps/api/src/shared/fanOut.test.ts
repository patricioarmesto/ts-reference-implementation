import { Err, Ok } from '@repo/shared'
import { describe, expect, it } from 'vitest'
import { fanOut } from './fanOut.js'

describe('fanOut', () => {
  it('returns all values when every task succeeds', async () => {
    const result = await fanOut({
      user: { run: async () => Ok('pat'), critical: true },
      orders: { run: async () => Ok([1, 2]) },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.data).toEqual({ user: 'pat', orders: [1, 2] })
    expect(result.value.partial).toBe(false)
    expect(result.value.warnings).toEqual([])
  })

  it('returns partial data when a degradable task fails', async () => {
    const result = await fanOut({
      todos: { run: async () => Ok(['a']) },
      stats: { run: async () => Err({ code: 'STATS_DOWN', message: 'stats down', status: 503 }) },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.data).toEqual({ todos: ['a'] })
    expect(result.value.partial).toBe(true)
    expect(result.value.failedTasks).toEqual(['stats'])
    expect(result.value.warnings[0]).toContain('stats')
  })

  it('aborts siblings and fails when a critical task fails', async () => {
    let siblingAborted = false
    const result = await fanOut({
      todos: {
        run: async () => Err({ code: 'DB_DOWN', message: 'db down', status: 503 }),
        critical: true,
      },
      activity: {
        run: (signal) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => {
              siblingAborted = true
              resolve(Ok([]))
            })
          }),
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('DB_DOWN')
    expect(siblingAborted).toBe(true)
  })

  it('marks a timed-out task as failed', async () => {
    const result = await fanOut({
      todos: { run: async () => Ok(['a']) },
      slow: {
        run: () => new Promise(() => undefined),
        timeoutMs: 10,
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.partial).toBe(true)
    expect(result.value.failedTasks).toEqual(['slow'])
    expect(result.value.warnings[0]).toContain('timed out')
  })
})
