import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from './dashboard.api.js'

export const dashboardKeys = {
  all: ['dashboard'] as const,
}

export function useDashboard() {
  return useQuery({ queryKey: dashboardKeys.all, queryFn: dashboardApi.get })
}
