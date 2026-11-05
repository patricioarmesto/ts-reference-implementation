import express, { Router, type Express, type NextFunction, type Request, type Response } from 'express'
import { createGetDashboardUseCase } from './features/dashboard/usecase.js'
import { createDashboardController } from './features/dashboard/controller.js'
import type { StatsProvider } from './features/dashboard/stats.js'
import { createTodosUseCases } from './features/todos/usecase.js'
import { createTodosController } from './features/todos/controller.js'
import type { TodosRepo } from './features/todos/repo.js'
import type { ActivityLog } from './shared/activityLog.js'
import { installE2E } from './shared/e2e.js'
import { logger } from './shared/observability/logger.js'

export interface AppDeps {
  todosRepo: TodosRepo
  activityLog: ActivityLog
  stats: StatsProvider
  e2e?: boolean
  webDist?: string
}

export function createApp(deps: AppDeps): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json())

  if (deps.e2e) installE2E(app)

  const todoUseCases = createTodosUseCases({
    repo: deps.todosRepo,
    activityLog: deps.activityLog,
  })
  const dashboardUseCase = createGetDashboardUseCase({
    todosRepo: deps.todosRepo,
    stats: deps.stats,
    activityLog: deps.activityLog,
  })

  const router = Router()
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  router.use('/todos', createTodosController(todoUseCases))
  router.use('/dashboard', createDashboardController(dashboardUseCase))

  app.use('/api/v1', router)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found' } })
  })

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } })
      return
    }
    logger.error('unhandled request error', {
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } })
  })

  return app
}
