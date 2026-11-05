import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TodoFilter } from '@repo/shared'
import { todosApi } from './todos.api.js'

export const todosKeys = {
  all: ['todos'] as const,
  list: (filter: TodoFilter) => ['todos', filter] as const,
}

function useRefreshTodos() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: todosKeys.all })
    void client.invalidateQueries({ queryKey: ['dashboard'] })
  }
}

export function useTodos(filter: TodoFilter) {
  return useQuery({ queryKey: todosKeys.list(filter), queryFn: () => todosApi.list(filter) })
}

export function useCreateTodo() {
  const refresh = useRefreshTodos()
  return useMutation({ mutationFn: (title: string) => todosApi.create(title), onSuccess: refresh })
}

export function useSetTodoCompleted() {
  const refresh = useRefreshTodos()
  return useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      todosApi.setCompleted(id, completed),
    onSuccess: refresh,
  })
}

export function useRemoveTodo() {
  const refresh = useRefreshTodos()
  return useMutation({ mutationFn: (id: string) => todosApi.remove(id), onSuccess: refresh })
}
