export interface HttpRequestOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export class UpstreamHttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'UpstreamHttpError'
  }
}

const DEFAULT_TIMEOUT_MS = 20_000

export async function fetchText(url: string, options: HttpRequestOptions = {}): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'user-agent': 'OpenScienceScienceConnectors/0.1 (+https://github.com/open-science)',
        ...(options.headers ?? {})
      },
      body: options.body,
      signal: controller.signal
    })
    const text = await response.text()
    if (!response.ok) {
      throw new UpstreamHttpError(url, response.status, `Upstream ${response.status}: ${text.slice(0, 240)}`)
    }
    return text
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchJson<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  const text = await fetchText(url, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.headers ?? {})
    }
  })
  return JSON.parse(text) as T
}

export function withQuery(baseUrl: string, params: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(baseUrl)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}
