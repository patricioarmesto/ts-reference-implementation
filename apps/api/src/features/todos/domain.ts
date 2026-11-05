import { randomUUID } from 'node:crypto'
import type { Todo } from '@repo/shared'

export const SEED_TITLES = ['Read AGENTS.md', 'Ship the reference app', 'Buy milk'] as const

export function makeTodo(title: string, now = new Date()): Todo {
  const timestamp = now.toISOString()
  return { id: randomUUID(), title, completed: false, createdAt: timestamp, updatedAt: timestamp }
}
