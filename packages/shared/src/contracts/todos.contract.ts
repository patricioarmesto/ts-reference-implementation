import { z } from 'zod'

export const TodoFilterSchema = z.enum(['all', 'active', 'done'])
export type TodoFilter = z.infer<typeof TodoFilterSchema>

export const TodoSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  completed: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Todo = z.infer<typeof TodoSchema>

export const TodoIdParamsSchema = z.object({ id: z.string().min(1) })
export type TodoIdParams = z.infer<typeof TodoIdParamsSchema>

export const CreateTodoInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
})
export type CreateTodoInput = z.infer<typeof CreateTodoInputSchema>

export const UpdateTodoInputSchema = z.object({ completed: z.boolean() })
export type UpdateTodoInput = z.infer<typeof UpdateTodoInputSchema>

export const ListTodosQuerySchema = z.object({ filter: TodoFilterSchema.default('all') })
export type ListTodosQuery = z.infer<typeof ListTodosQuerySchema>

export const ListTodosOutputSchema = z.object({ todos: z.array(TodoSchema) })
export type ListTodosOutput = z.infer<typeof ListTodosOutputSchema>

export const TodoOutputSchema = z.object({ todo: TodoSchema })
export type TodoOutput = z.infer<typeof TodoOutputSchema>

export const DeleteTodoOutputSchema = z.object({ id: z.string().min(1) })
export type DeleteTodoOutput = z.infer<typeof DeleteTodoOutputSchema>
