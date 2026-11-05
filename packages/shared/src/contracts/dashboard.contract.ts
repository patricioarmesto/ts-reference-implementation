import { z } from 'zod'
import { TodoSchema } from './todos.contract.js'

export const StatsSchema = z.object({
  total: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  completionRate: z.number().min(0).max(1),
})
export type Stats = z.infer<typeof StatsSchema>

export const ActivityTypeSchema = z.enum(['created', 'completed', 'reopened', 'deleted'])

export const ActivityEntrySchema = z.object({
  id: z.string().min(1),
  type: ActivityTypeSchema,
  todoId: z.string().min(1),
  title: z.string().min(1),
  at: z.string().datetime(),
})
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>

export const DashboardOutputSchema = z.object({
  todos: z.array(TodoSchema),
  stats: StatsSchema.nullable(),
  activity: z.array(ActivityEntrySchema).nullable(),
  meta: z.object({
    partial: z.boolean(),
    warnings: z.array(z.string()),
    failedTasks: z.array(z.string()),
  }),
})
export type DashboardOutput = z.infer<typeof DashboardOutputSchema>
