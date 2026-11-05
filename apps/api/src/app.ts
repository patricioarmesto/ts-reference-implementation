import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { logger } from './shared/observability/logger.js'

export interface AppDeps {
  webDist?: string
}

export function createApp(_deps: AppDeps = {}): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json())

  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

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
