import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { Result } from '@repo/shared'

export function sendResult<T>(res: Response, result: Result<T>, successStatus = 200): void {
  if (result.ok) {
    res.status(successStatus).json(result.value)
    return
  }
  const { code, message, details } = result.error
  res.status(result.error.status).json({
    error: details === undefined ? { code, message } : { code, message, details },
  })
}

export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next)
  }
}
