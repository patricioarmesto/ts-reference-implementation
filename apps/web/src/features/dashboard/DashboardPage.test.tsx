import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DashboardOutputSchema, type DashboardOutput } from '@repo/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage.js'

const respond = (body: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
} as Response)

const fullDashboard: DashboardOutput = DashboardOutputSchema.parse({
  todos: [
    {
      id: 't1', title: 'Buy milk', completed: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 't2', title: 'Ship it', completed: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  stats: { total: 2, active: 1, completed: 1, completionRate: 0.5 },
  activity: [
    {
      id: 'a1', type: 'created', todoId: 't1', title: 'Buy milk',
      at: '2026-01-01T00:00:00.000Z',
    },
  ],
  meta: { partial: false, warnings: [], failedTasks: [] },
})

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  )
}

describe('DashboardPage', () => {
  it('renders stats, todos, and activity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(fullDashboard)))

    renderPage()

    expect(await screen.findByTestId('stats')).toBeInTheDocument()
    expect(screen.getByTestId('stats-total')).toHaveTextContent('2')
    expect(screen.getByTestId('stats-active')).toHaveTextContent('1')
    expect(screen.getByTestId('stats-completed')).toHaveTextContent('1')
    expect(screen.getByTestId('stats-rate')).toHaveTextContent('50%')
    expect(screen.getAllByText('Buy milk').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('dashboard-todo')).toHaveLength(1)
    const activity = screen.getAllByTestId('dashboard-activity')
    expect(activity).toHaveLength(1)
    expect(within(activity[0]!).getByText('Buy milk')).toBeInTheDocument()
    expect(screen.queryByTestId('partial-banner')).not.toBeInTheDocument()
  })

  it('shows a partial banner and hides missing stats', async () => {
    const partial = DashboardOutputSchema.parse({
      ...fullDashboard,
      stats: null,
      meta: {
        partial: true,
        warnings: ['stats unavailable: stats down'],
        failedTasks: ['stats'],
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => respond(partial)))

    renderPage()

    expect(await screen.findByTestId('partial-banner')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-warning')).toHaveTextContent('stats unavailable')
    expect(screen.getByTestId('dashboard-stats-unavailable')).toBeInTheDocument()
    expect(screen.queryAllByText('Buy milk').length).toBeGreaterThan(0)
  })

  it('dismisses the partial banner', async () => {
    const partial = DashboardOutputSchema.parse({
      ...fullDashboard,
      stats: null,
      meta: { partial: true, warnings: ['stats down'], failedTasks: ['stats'] },
    })
    vi.stubGlobal('fetch', vi.fn(async () => respond(partial)))

    renderPage()
    await userEvent.click(await screen.findByTestId('dismiss-partial'))

    expect(screen.queryByTestId('partial-banner')).not.toBeInTheDocument()
  })

  it('shows the API error when the dashboard is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(
      {
        error: {
          code: 'DASHBOARD_UNAVAILABLE',
          message: 'Dashboard is temporarily unavailable',
        },
      },
      503,
    )))

    renderPage()

    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'Dashboard is temporarily unavailable',
    )
  })

  it('shows a generic error for a non-JSON failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('Unexpected token <') },
    } as Response)))

    renderPage()

    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'Request failed with status 502',
    )
  })
})
