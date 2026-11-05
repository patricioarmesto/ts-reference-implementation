import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { DashboardPage } from './features/dashboard/DashboardPage.js'
import { TodosPage } from './features/todos/TodosPage.js'

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Todo reference</h1>
        <nav aria-label="Main navigation">
          <NavLink to="/todos" data-testid="nav-todos">Todos</NavLink>
          <NavLink to="/dashboard" data-testid="nav-dashboard">Dashboard</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/todos" element={<TodosPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="*" element={<Navigate to="/todos" replace />} />
        </Routes>
      </main>
    </div>
  )
}
