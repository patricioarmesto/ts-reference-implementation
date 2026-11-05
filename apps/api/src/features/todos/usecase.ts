import { randomUUID } from 'node:crypto'
import {
  Ok,
  type CreateTodoInput,
  type DeleteTodoOutput,
  type ListTodosOutput,
  type ListTodosQuery,
  type Result,
  type TodoOutput,
  type UpdateTodoInput,
} from '@repo/shared'
import { runSpan } from '../../shared/observability/tracing.js'
import type { ActivityLog } from '../../shared/activityLog.js'
import type { TodosRepo } from './repo.js'

export interface TodosUseCases {
  list(input: ListTodosQuery): Promise<Result<ListTodosOutput>>
  create(input: CreateTodoInput): Promise<Result<TodoOutput>>
  setCompleted(id: string, input: UpdateTodoInput): Promise<Result<TodoOutput>>
  remove(id: string): Promise<Result<DeleteTodoOutput>>
}

export function createTodosUseCases(deps: {
  repo: TodosRepo
  activityLog: ActivityLog
}): TodosUseCases {
  return {
    list: (input) =>
      runSpan('ListTodosUseCase', async () => {
        const result = await deps.repo.list(input.filter)
        if (!result.ok) return result
        return Ok({ todos: result.value })
      }),

    create: (input) =>
      runSpan('CreateTodoUseCase', async () => {
        const result = await deps.repo.create(input)
        if (!result.ok) return result
        const todo = result.value
        deps.activityLog.append({
          id: randomUUID(),
          type: 'created',
          todoId: todo.id,
          title: todo.title,
          at: new Date().toISOString(),
        })
        return Ok({ todo })
      }),

    setCompleted: (id, input) =>
      runSpan('SetTodoCompletedUseCase', async () => {
        const before = await deps.repo.findById(id)
        if (!before.ok) return before
        const result = await deps.repo.setCompleted(id, input.completed)
        if (!result.ok) return result
        deps.activityLog.append({
          id: randomUUID(),
          type: input.completed ? 'completed' : 'reopened',
          todoId: id,
          title: result.value.title,
          at: new Date().toISOString(),
        })
        return Ok({ todo: result.value })
      }),

    remove: (id) =>
      runSpan('DeleteTodoUseCase', async () => {
        const before = await deps.repo.findById(id)
        if (!before.ok) return before
        const result = await deps.repo.remove(id)
        if (!result.ok) return result
        deps.activityLog.append({
          id: randomUUID(),
          type: 'deleted',
          todoId: id,
          title: before.value.title,
          at: new Date().toISOString(),
        })
        return Ok({ id: result.value })
      }),
  }
}
