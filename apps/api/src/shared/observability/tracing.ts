import { SpanStatusCode, trace, type Attributes } from '@opentelemetry/api'
import type { Result } from '@repo/shared'

const tracer = trace.getTracer('todo-api')

export async function runSpan<T>(
  name: string,
  fn: () => Promise<Result<T>>,
  attributes: Attributes = {},
): Promise<Result<T>> {
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attributes)
    try {
      const result = await fn()
      if (!result.ok) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: result.error.message })
        span.recordException({ name: result.error.code, message: result.error.message })
      }
      return result
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'unknown error',
      })
      span.recordException(error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      span.end()
    }
  })
}
