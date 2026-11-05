import { Err, Ok, type Result } from '@repo/shared'

export async function httpGetJson<T>(
  url: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Result<T>> {
  const timeoutMs = opts.timeoutMs ?? 2000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onAbort)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      return Err({
        code: 'UPSTREAM_ERROR',
        message: `GET ${url} returned ${response.status}`,
        status: 502,
      })
    }
    return Ok((await response.json()) as T)
  } catch (error) {
    return Err({
      code: 'UPSTREAM_UNAVAILABLE',
      message: error instanceof Error ? error.message : `GET ${url} failed`,
      status: 503,
    })
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}
