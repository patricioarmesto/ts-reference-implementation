import { trace } from '@opentelemetry/api'

type Fields = Record<string, unknown>

function write(level: 'info' | 'warn' | 'error', message: string, fields: Fields = {}): void {
  const span = trace.getActiveSpan()?.spanContext()
  process.stdout.write(
    `${JSON.stringify({ level, message, trace_id: span?.traceId, span_id: span?.spanId, ...fields })}\n`,
  )
}

export const logger = {
  info: (message: string, fields?: Fields) => write('info', message, fields),
  warn: (message: string, fields?: Fields) => write('warn', message, fields),
  error: (message: string, fields?: Fields) => write('error', message, fields),
}
