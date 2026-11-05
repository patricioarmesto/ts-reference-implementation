import {
  CreateTodoInputSchema,
  UpdateTodoInputSchema,
  type DeleteTodoOutput,
  type ListTodosOutput,
  type TodoFilter,
  type TodoOutput,
} from '@repo/shared'
import { apiFetch } from '../../lib/api.js'

export const todosApi = {
  list: (filter: TodoFilter) => apiFetch<ListTodosOutput>(`/todos?filter=${filter}`),
  create: (title: string) =>
    apiFetch<TodoOutput>('/todos', {
      method: 'POST',
      body: JSON.stringify(CreateTodoInputSchema.parse({ title })),
    }),
  setCompleted: (id: string, completed: boolean) =>
    apiFetch<TodoOutput>(`/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(UpdateTodoInputSchema.parse({ completed })),
    }),
  remove: (id: string) =>
    apiFetch<DeleteTodoOutput>(`/todos/${id}`, { method: 'DELETE' }),
}
