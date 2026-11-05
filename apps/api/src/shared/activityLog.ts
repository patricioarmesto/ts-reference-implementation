import type { ActivityEntry } from '@repo/shared'
import { currentE2EContext } from './e2e.js'

export interface ActivityLog {
  append(entry: ActivityEntry): void
  recent(limit?: number): ActivityEntry[]
}

export function createActivityLog(): ActivityLog {
  const entries: ActivityEntry[] = []
  const active = (): ActivityEntry[] => currentE2EContext()?.activity ?? entries

  return {
    append(entry) {
      const log = active()
      log.push(entry)
      if (log.length > 50) log.shift()
    },
    recent(limit = 10) {
      return active().slice(-limit).reverse()
    },
  }
}
