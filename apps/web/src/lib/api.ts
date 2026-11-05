import { ApiErrorSchema } from '@repo/shared'

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const parsed = ApiErrorSchema.safeParse(body)
    if (parsed.success) {
      throw new ApiRequestError(response.status, parsed.data.error.code, parsed.data.error.message)
    }
    throw new ApiRequestError(response.status, 'INTERNAL', `Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}
