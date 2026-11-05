import './shared/observability/otel.js'
import { createApp } from './app.js'
import { createMemoryTodosRepo } from './features/todos/repo.js'
import { createActivityLog } from './shared/activityLog.js'
import { logger } from './shared/observability/logger.js'

const port = Number(process.env.PORT ?? 3000)
const app = createApp({
  todosRepo: createMemoryTodosRepo(),
  activityLog: createActivityLog(),
})

app.listen(port, () => {
  logger.info('api listening', { port })
})
