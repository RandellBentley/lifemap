// Thin fetch wrapper. Auth is a Django session cookie (HttpOnly), so the browser
// sends it automatically; we only need to echo the CSRF token on unsafe methods.

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API request failed with status ${status}`)
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function getCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.split('=')[1]
}

type ApiInit = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit }

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, ...rest } = init
  const headers = new Headers(rest.headers)
  headers.set('Accept', 'application/json')

  let body = rest.body
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(json)
  }

  const method = (rest.method ?? 'GET').toUpperCase()
  if (!SAFE_METHODS.has(method)) {
    const token = getCookie('csrftoken')
    if (token) headers.set('X-CSRFToken', token)
  }

  const res = await fetch(`/api${path}`, { ...rest, method, headers, body, credentials: 'same-origin' })
  if (res.status === 204) return undefined as T

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json() : await res.text()
  if (!res.ok) throw new ApiError(res.status, data)
  return data as T
}

/** DRF cursor pagination returns absolute URLs; we only need the query string. */
export function cursorQuery(url: string | null): string | undefined {
  return url ? new URL(url, window.location.origin).search.slice(1) : undefined
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    return Object.entries(err.body as Record<string, unknown>)
      .map(([field, msg]) => `${field}: ${Array.isArray(msg) ? msg.join(' ') : String(msg)}`)
      .join('\n')
  }
  return err instanceof Error ? err.message : 'Something went wrong'
}
