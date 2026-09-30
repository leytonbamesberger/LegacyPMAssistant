/**
 * Shared shape for every `/api` handler. Handlers stay framework-agnostic —
 * they return one of these and the Vercel adapter (`api/*`) or the Vite dev
 * middleware (`vite.config.ts`) turns it into an actual HTTP response.
 */
export interface ApiResult {
  status: number
  /** JSON body. Ignored when `redirect` or `buffer` is set. */
  json?: unknown
  /** When set, respond with a 3xx `Location` redirect instead of a body. */
  redirect?: string
  /** Binary body (e.g. a generated PDF). Takes priority over `json`/`redirect` when set. */
  buffer?: Buffer
  /** Content-Type for `buffer` — required when `buffer` is set. */
  contentType?: string
  /** Filename hint for `buffer` — sets Content-Disposition: attachment. */
  filename?: string
  /** Extra response headers. */
  headers?: Record<string, string>
}

export function json(status: number, body: unknown): ApiResult {
  return { status, json: body }
}

export function redirect(location: string, status = 302): ApiResult {
  return { status, redirect: location }
}

export function binary(buffer: Buffer, contentType: string, filename: string): ApiResult {
  return { status: 200, buffer, contentType, filename }
}

/** Parse `Authorization: Bearer <token>`. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}
