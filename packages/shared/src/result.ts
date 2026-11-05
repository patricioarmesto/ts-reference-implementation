export interface DomainError {
  code: string
  message: string
  status: number
  details?: unknown
}

export type Ok<T> = { ok: true; value: T }
export type Err<E = DomainError> = { ok: false; error: E }
export type Result<T, E = DomainError> = Ok<T> | Err<E>

export const Ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const Err = <E = DomainError>(error: E): Err<E> => ({ ok: false, error })

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok
