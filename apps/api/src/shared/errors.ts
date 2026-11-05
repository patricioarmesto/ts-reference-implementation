import type { DomainError } from '@repo/shared'

export const validationError = (message: string, details?: unknown): DomainError => ({
  code: 'VALIDATION_ERROR', message, status: 400, details,
})

export const notFoundError = (message: string): DomainError => ({
  code: 'NOT_FOUND', message, status: 404,
})

export const dashboardUnavailable = (): DomainError => ({
  code: 'DASHBOARD_UNAVAILABLE', message: 'Dashboard is temporarily unavailable', status: 503,
})

export const internalError = (message = 'Internal server error'): DomainError => ({
  code: 'INTERNAL', message, status: 500,
})
