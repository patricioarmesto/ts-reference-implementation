import type { TodoFilter } from '@repo/shared'
import { useRef, useState } from 'react'
import {
  useCreateTodo,
  useRemoveTodo,
  useSetTodoCompleted,
  useTodos,
} from './todos.query.js'

const FILTERS: TodoFilter[] = ['all', 'active', 'done']

export function TodosPage() {
  const [filter, setFilter] = useState<TodoFilter>('all')
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const todos = useTodos(filter)
  const create = useCreateTodo()
  const setCompleted = useSetTodoCompleted()
  const remove = useRemoveTodo()
  const error = todos.error ?? create.error ?? setCompleted.error ?? remove.error

  return (
    <section aria-labelledby="todos-heading">
      <h2 id="todos-heading">Todos</h2>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (title.trim().length === 0) return
          create.mutate(title, {
            onSuccess: () => {
              setTitle('')
              inputRef.current?.focus()
            },
          })
        }}
      >
        <label htmlFor="todo-title">New todo</label>
        <input
          id="todo-title"
          data-testid="todo-input"
          ref={inputRef}
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button
          type="submit"
          data-testid="todo-add"
          disabled={create.isPending || title.trim().length === 0}
        >
          Add
        </button>
      </form>

      <div role="group" aria-label="Filter todos">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            data-testid={`filter-${value}`}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" data-testid="error-banner">{error.message}</p>
      ) : null}

      {todos.isPending ? <p>Loading todos…</p> : null}
      {todos.data && todos.data.todos.length === 0 ? <p>No todos yet.</p> : null}

      <ul>
        {todos.data?.todos.map((todo) => (
          <li key={todo.id} data-testid="todo-item">
            <label>
              <input
                type="checkbox"
                data-testid="todo-toggle"
                checked={todo.completed}
                onChange={(event) =>
                  setCompleted.mutate({ id: todo.id, completed: event.target.checked })
                }
              />
              <span>{todo.title}</span>
            </label>
            <button
              type="button"
              data-testid="todo-delete"
              onClick={() => remove.mutate(todo.id)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
