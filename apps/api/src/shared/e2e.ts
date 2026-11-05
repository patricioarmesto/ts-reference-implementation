import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { Express, NextFunction, Request, Response } from 'express'
import { Err, SeedInputSchema, type ActivityEntry, type Todo } from '@repo/shared'
import { notFoundError, validationError } from './errors.js'
import { sendResult } from './http.js'

export interface E2EContext {
  todos: Map<string, Todo>
  activity: ActivityEntry[]
}

const storage = new AsyncLocalStorage<E2EContext>()
const partitions = new Map<string, E2EContext>()
let seedCounter = 0

export const currentE2EContext = (): E2EContext | undefined => storage.getStore()

export function runWithE2EContext<T>(context: E2EContext, fn: () => T): T {
  return storage.run(context, fn)
}

export function installE2E(app: Express, _deps?: unknown): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const seedId = req.header('x-e2e-seed-id')
    if (!seedId) {
      next()
      return
    }
    const context = partitions.get(seedId)
    if (!context) {
      res.status(404).json({
        error: { code: 'E2E_SEED_NOT_FOUND', message: `Seed ${seedId} not found` },
      })
      return
    }
    runWithE2EContext(context, next)
  })

  app.post('/api/test/seed', (req: Request, res: Response) => {
    const parsed = SeedInputSchema.safeParse(req.body)
    if (!parsed.success) {
      sendResult(res, Err(validationError('Invalid seed input', parsed.error.flatten())))
      return
    }

    seedCounter += 1
    const id = `e2e-${Date.now()}-${seedCounter}`
    const now = new Date().toISOString()
    const todos = new Map<string, Todo>()
    for (const title of parsed.data.todos ?? []) {
      const todo: Todo = {
        id: randomUUID(),
        title,
        completed: false,
        createdAt: now,
        updatedAt: now,
      }
      todos.set(todo.id, todo)
    }
    partitions.set(id, { todos, activity: [] })
    res.status(201).json({ id })
  })

  app.delete('/api/test/seed/:id', (req: Request, res: Response) => {
    const id = req.params.id ?? ''
    if (!partitions.delete(id)) {
      sendResult(res, Err(notFoundError(`Seed ${id} not found`)))
      return
    }
    res.json({ id })
  })
}
