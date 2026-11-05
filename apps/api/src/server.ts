import './shared/observability/otel.js'
import { createApp } from './app.js'
import { createStats } from './features/dashboard/stats.js'
import { createMemoryTodosRepo } from './features/todos/repo.js'
import { createActivityLog } from './shared/activityLog.js'
import { logger } from './shared/observability/logger.js'

const todosRepo = createMemoryTodosRepo()

const app = createApp({
  todosRepo,
  activityLog: createActivityLog(),
  stats: createStats({ todosRepo }),
  e2e: process.env.E2E === 'true',
})

const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => {
  logger.info('api listening', { port })
})
