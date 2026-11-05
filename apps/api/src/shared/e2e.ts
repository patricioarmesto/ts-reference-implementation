import { AsyncLocalStorage } from 'node:async_hooks'
import type { ActivityEntry, Todo } from '@repo/shared'

export interface E2EContext {
  todos: Map<string, Todo>
  activity: ActivityEntry[]
}

const storage = new AsyncLocalStorage<E2EContext>()

export const currentE2EContext = (): E2EContext | undefined => storage.getStore()

export function runWithE2EContext<T>(context: E2EContext, fn: () => T): T {
  return storage.run(context, fn)
}
