import { describe, expect, it } from 'vitest'
import { Err, Ok, isErr, isOk, type DomainError, type Result } from './result.js'

describe('Result', () => {
  it('wraps success values', () => {
    const result = Ok(42)
    expect(result).toEqual({ ok: true, value: 42 })
  })

  it('wraps domain errors', () => {
    const error: DomainError = { code: 'NOT_FOUND', message: 'missing', status: 404 }
    expect(Err(error)).toEqual({ ok: false, error })
  })

  it('narrows to the value branch', () => {
    const result: Result<number> = Ok(1)
    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value).toBe(1)
  })

  it('narrows to the error branch', () => {
    const result: Result<number> = Err({ code: 'X', message: 'x', status: 500 })
    if (!isErr(result)) throw new Error('expected err')
    expect(result.error.code).toBe('X')
  })
})
