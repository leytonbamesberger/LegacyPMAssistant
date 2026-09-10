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
