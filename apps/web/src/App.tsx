import { Navigate, Route, Routes } from 'react-router-dom'
import { TodosPage } from './features/todos/TodosPage.js'

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Todo reference</h1>
        <nav aria-label="Main navigation" />
      </header>
      <main>
        <Routes>
          <Route path="/todos" element={<TodosPage />} />
          <Route path="*" element={<Navigate to="/todos" replace />} />
        </Routes>
      </main>
    </div>
  )
}
