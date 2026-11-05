import { SpanStatusCode, trace } from '@opentelemetry/api'
import { Err, Ok, type DomainError, type Result } from '@repo/shared'
import { internalError } from './errors.js'

export type FanOutTask<T> = {
  run: (signal: AbortSignal) => Promise<Result<T>>
  critical?: boolean
  timeoutMs?: number
}

export type FanOutTasks = Record<string, FanOutTask<unknown>>

type TaskValue<T> = T extends FanOutTask<infer V> ? V : never
export type FanOutData<T extends FanOutTasks> = { [K in keyof T]: TaskValue<T[K]> }

export interface FanOutResult<T extends FanOutTasks> {
  data: Partial<FanOutData<T>>
  warnings: string[]
  failedTasks: string[]
  partial: boolean
}

interface TaskOutcome {
  name: string
  critical: boolean
  result: Result<unknown>
}

async function execute(
  name: string,
  task: FanOutTask<unknown>,
  sharedSignal: AbortSignal,
): Promise<TaskOutcome> {
  const local = new AbortController()
  const signal = AbortSignal.any([sharedSignal, local.signal])
  const timeoutMs = task.timeoutMs ?? 2000
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<Result<unknown>>((resolve) => {
    timer = setTimeout(() => {
      local.abort()
      resolve(
        Err({
          code: 'TIMEOUT',
          message: `Task "${name}" timed out after ${timeoutMs}ms`,
          status: 503,
        }),
      )
    }, timeoutMs)
  })

  const run = (async (): Promise<Result<unknown>> => {
    try {
      return await task.run(signal)
    } catch (error) {
      return Err(internalError(error instanceof Error ? error.message : `Task "${name}" failed`))
    }
  })()

  const result = await Promise.race([run, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })

  return { name, critical: task.critical === true, result }
}

export async function fanOut<T extends FanOutTasks>(
  tasks: T,
  opts: { abortOnCritical?: boolean } = {},
): Promise<Result<FanOutResult<T>>> {
  const tracer = trace.getTracer('todo-api')
  return tracer.startActiveSpan('fanOut', async (span) => {
    const names = Object.keys(tasks)
    const shared = new AbortController()
    const abortOnCritical = opts.abortOnCritical !== false
    const outcomes = await Promise.all(
      names.map(async (name) => {
        const outcome = await execute(name, tasks[name]!, shared.signal)
        if (abortOnCritical && outcome.critical && !outcome.result.ok) {
          shared.abort()
        }
        return outcome
      }),
    )

    const critical = outcomes.find((outcome) => outcome.critical && !outcome.result.ok)
    if (critical) {
      const error = critical.result.ok
        ? internalError()
        : (critical.result.error as DomainError)
      span.setAttributes({ tasks: names.join(','), failed_tasks: critical.name, partial: false })
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
      span.end()
      return Err(error)
    }

    const data: Partial<FanOutData<T>> = {}
    const warnings: string[] = []
    const failedTasks: string[] = []

    for (const outcome of outcomes) {
      if (outcome.result.ok) {
        ;(data as Record<string, unknown>)[outcome.name] = outcome.result.value
        continue
      }
      failedTasks.push(outcome.name)
      warnings.push(`${outcome.name} unavailable: ${outcome.result.error.message}`)
    }

    const partial = failedTasks.length > 0
    span.setAttributes({
      tasks: names.join(','),
      failed_tasks: failedTasks.join(','),
      partial,
    })
    span.end()
    return Ok({ data, warnings, failedTasks, partial })
  })
}
