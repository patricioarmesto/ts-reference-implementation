import { Router } from 'express'
import type { DashboardOutput, Result } from '@repo/shared'
import { asyncHandler, sendResult } from '../../shared/http.js'

export function createDashboardController(
  useCase: () => Promise<Result<DashboardOutput>>,
): Router {
  const router = Router()

  router.get('/', asyncHandler(async (_req, res) => {
    sendResult(res, await useCase())
  }))

  return router
}
