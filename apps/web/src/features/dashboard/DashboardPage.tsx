import { useState } from 'react'
import { useDashboard } from './dashboard.query.js'

export function DashboardPage() {
  const [dismissed, setDismissed] = useState(false)
  const dashboard = useDashboard()

  if (dashboard.isPending) {
    return <p>Loading dashboard…</p>
  }

  if (dashboard.error || !dashboard.data) {
    return (
      <section aria-labelledby="dashboard-heading">
        <h2 id="dashboard-heading">Dashboard</h2>
        <p role="alert" data-testid="error-banner">
          {dashboard.error?.message ?? 'Dashboard unavailable'}
        </p>
      </section>
    )
  }

  const { todos, stats, activity, meta } = dashboard.data
  const activePreview = todos.filter((todo) => !todo.completed).slice(0, 5)

  return (
    <section aria-labelledby="dashboard-heading">
      <h2 id="dashboard-heading">Dashboard</h2>

      {meta.partial && !dismissed ? (
        <div role="status" data-testid="partial-banner">
          <p>Some parts of the dashboard are unavailable.</p>
          <ul>
            {meta.warnings.map((warning) => (
              <li key={warning} data-testid="dashboard-warning">{warning}</li>
            ))}
          </ul>
          <button
            type="button"
            data-testid="dismiss-partial"
            onClick={() => setDismissed(true)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <h3>Stats</h3>
      {stats ? (
        <div className="stats" data-testid="stats">
          <p data-testid="stats-total">Total: {stats.total}</p>
          <p data-testid="stats-active">Active: {stats.active}</p>
          <p data-testid="stats-completed">Completed: {stats.completed}</p>
          <p data-testid="stats-rate">Completion: {Math.round(stats.completionRate * 100)}%</p>
        </div>
      ) : (
        <p data-testid="dashboard-stats-unavailable">Stats are unavailable.</p>
      )}

      <h3>Active todos</h3>
      {activePreview.length === 0 ? <p>No active todos.</p> : null}
      <ul>
        {activePreview.map((todo) => (
          <li key={todo.id} data-testid="dashboard-todo">
            <span>{todo.title}</span>
          </li>
        ))}
      </ul>

      <h3>Recent activity</h3>
      {activity === null ? (
        <p data-testid="dashboard-activity-unavailable">Activity is unavailable.</p>
      ) : activity.length === 0 ? (
        <p>No activity yet.</p>
      ) : (
        <ul data-testid="activity-list">
          {activity.map((entry) => (
            <li key={entry.id} data-testid="dashboard-activity">
              <span>{entry.type}</span>
              <span>{entry.title}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
