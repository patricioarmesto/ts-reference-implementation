import type { DashboardOutput } from '@repo/shared'
import { apiFetch } from '../../lib/api.js'

export const dashboardApi = {
  get: () => apiFetch<DashboardOutput>('/dashboard'),
}
