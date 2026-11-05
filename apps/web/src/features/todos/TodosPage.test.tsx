import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ListTodosOutputSchema, type Todo } from '@repo/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TodosPage } from './TodosPage.js'

const todo = (id: string, title: string, completed = false): Todo => ({
  id,
  title,
  completed,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const respond = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TodosPage />
    </QueryClientProvider>,
  )
}

describe('TodosPage', () => {
  it('renders todos from the API', async () => {
    const body = ListTodosOutputSchema.parse({ todos: [todo('1', 'Buy milk')] })
    vi.stubGlobal('fetch', vi.fn(async () => respond(body)))

    renderPage()
    expect(await screen.findByText('Buy milk')).toBeInTheDocument()
  })

  it('creates a todo and refetches the list', async () => {
    let todos: Todo[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/todos') && init?.method === 'POST') {
        const created = todo('2', 'Write tests')
        todos = [...todos, created]
        return respond({ todo: created }, 201)
      }
      return respond(ListTodosOutputSchema.parse({ todos }))
    }))

    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByTestId('todo-input'), 'Write tests')
    await user.click(screen.getByTestId('todo-add'))

    expect(await screen.findByText('Write tests')).toBeInTheDocument()
  })

  it('filters via the filter buttons', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const done = todo('1', 'Done task', true)
      const active = todo('2', 'Active task')
      const todos = url.includes('filter=done') ? [done] : url.includes('filter=active') ? [active] : [done, active]
      return respond(ListTodosOutputSchema.parse({ todos }))
    }))

    renderPage()
    expect(await screen.findByText('Done task')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('filter-done'))
    expect(await screen.findByText('Done task')).toBeInTheDocument()
    expect(screen.queryByText('Active task')).not.toBeInTheDocument()
  })

  it('shows the server error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid todo' } }, 400,
    )))

    renderPage()
    expect(await screen.findByTestId('error-banner')).toHaveTextContent('Invalid todo')
  })

  it('shows an inline error when a delete hits an already-deleted todo', async () => {
    const list = ListTodosOutputSchema.parse({ todos: [todo('1', 'Buy milk')] })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return respond({ error: { code: 'NOT_FOUND', message: 'Todo 1 not found' } }, 404)
      }
      return respond(list)
    }))

    renderPage()
    await userEvent.click(await screen.findByTestId('todo-delete'))

    expect(await screen.findByTestId('error-banner')).toHaveTextContent('Todo 1 not found')
  })
})
