import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { ApiResult } from './http'

type Handler = (req: VercelRequest) => Promise<ApiResult>

/**
 * Wrap a framework-agnostic handler as a Vercel function: enforce the HTTP
 * method, run the handler, and serialise the `ApiResult` (JSON or redirect).
 */
export function vercelRoute(method: 'GET' | 'POST', handler: Handler) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    if (req.method !== method) {
      res.setHeader('Allow', method)
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    let result: ApiResult
    try {
      result = await handler(req)
    } catch (err) {
      console.error(`[api] ${req.url} failed:`, err)
      res.status(500).json({ error: 'Internal error' })
      return
    }

    for (const [key, value] of Object.entries(result.headers ?? {})) {
      res.setHeader(key, value)
    }
    if (result.redirect) {
      res.redirect(result.status || 302, result.redirect)
      return
    }
    res.status(result.status).json(result.json ?? {})
  }
}

/** Read a query param that may arrive as `string | string[]`. */
export function queryParam(
  req: VercelRequest,
  name: string,
): string | undefined {
  const value = req.query[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * The origin the client actually reached this function on, e.g.
 * `https://app.example.com`. Behind Vercel's proxy the real host/proto are in
 * the `x-forwarded-*` headers. Used to anchor the Procore OAuth redirect URI.
 */
export function requestOrigin(req: VercelRequest): string | null {
  const host =
    firstHeader(req.headers['x-forwarded-host']) ?? firstHeader(req.headers.host)
  if (!host) return null
  const proto =
    firstHeader(req.headers['x-forwarded-proto']) ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1')
      ? 'http'
      : 'https')
  return `${proto}://${host}`
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value?.split(',')[0]?.trim()
}
