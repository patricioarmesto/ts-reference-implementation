import {
  Err,
  Ok,
  type CreateTodoInput,
  type Result,
  type Todo,
  type TodoFilter,
} from '@repo/shared'
import { notFoundError } from '../../shared/errors.js'
import { currentE2EContext } from '../../shared/e2e.js'
import { makeTodo, SEED_TITLES } from './domain.js'

export interface TodosRepo {
  list(filter: TodoFilter): Promise<Result<Todo[]>>
  findById(id: string): Promise<Result<Todo>>
  create(input: CreateTodoInput): Promise<Result<Todo>>
  setCompleted(id: string, completed: boolean): Promise<Result<Todo>>
  remove(id: string): Promise<Result<string>>
}

export function createMemoryTodosRepo(seedTitles: readonly string[] = SEED_TITLES): TodosRepo {
  const defaultStore = new Map<string, Todo>()
  for (const title of seedTitles) {
    const todo = makeTodo(title)
    defaultStore.set(todo.id, todo)
  }

  const store = (): Map<string, Todo> => currentE2EContext()?.todos ?? defaultStore

  return {
    async list(filter) {
      const todos = [...store().values()]
      if (filter === 'active') return Ok(todos.filter((todo) => !todo.completed))
      if (filter === 'done') return Ok(todos.filter((todo) => todo.completed))
      return Ok(todos)
    },

    async findById(id) {
      const todo = store().get(id)
      return todo ? Ok(todo) : Err(notFoundError(`Todo ${id} not found`))
    },

    async create(input) {
      const todo = makeTodo(input.title)
      store().set(todo.id, todo)
      return Ok(todo)
    },

    async setCompleted(id, completed) {
      const todo = store().get(id)
      if (!todo) return Err(notFoundError(`Todo ${id} not found`))
      const updated: Todo = { ...todo, completed, updatedAt: new Date().toISOString() }
      store().set(id, updated)
      return Ok(updated)
    },

    async remove(id) {
      return store().delete(id) ? Ok(id) : Err(notFoundError(`Todo ${id} not found`))
    },
  }
}
