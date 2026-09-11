import { ApiResult } from './http.js'

/**
 * Minimal structural shapes for the request/response objects Vercel's Node.js
 * runtime passes to a function — not imported from `@vercel/node` on purpose,
 * to avoid `import type` syntax here (see the note on module resolution below).
 *
 * Two real deployment bugs were found and fixed in this file and its siblings:
 *
 * 1. This project's `package.json` has `"type": "module"`, so Vercel runs
 *    these functions as native ES modules — and Node's native ESM loader
 *    requires an explicit file extension on every relative import (unlike
 *    CommonJS or a bundler). `server/` and `api/` are compiled under
 *    `moduleResolution: "NodeNext"` specifically so TypeScript *enforces*
 *    this and errors immediately if an extension is missing — every relative
 *    import must end in `.js` (yes, `.js`, even though the source is `.ts`;
 *    that's the extension the compiled output will actually have). Omitting
 *    this produced `ERR_MODULE_NOT_FOUND` at runtime — a crash before any of
 *    our own error handling could run.
 *
 * 2. Separately, Vercel's build uses `@vercel/nft` to statically scan each
 *    `api/*.ts` file to decide which `node_modules` files to include in the
 *    deployed function. That scanner fails to parse `import type { ... }` /
 *    inline `{ type X }` imports and silently stops tracing a file when it
 *    does, which can leave real dependencies out of the deployment. Fixed by
 *    using only plain `import { X } from 'y'` everywhere in `server/`/`api/`,
 *    plus a `vercel.json` `includeFiles` safety net.
 */
interface MinimalRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  query: Record<string, string | string[] | undefined>
}

interface MinimalResponse {
  headersSent: boolean
  setHeader(name: string, value: string): unknown
  status(code: number): MinimalResponse
  json(body: unknown): unknown
  redirect(status: number, url: string): unknown
}

type Handler = (req: MinimalRequest) => Promise<ApiResult>

/**
 * Wrap a framework-agnostic handler as a Vercel function: enforce the HTTP
 * method, run the handler, and serialise the `ApiResult` (JSON or redirect).
 * `MinimalRequest`/`MinimalResponse` are structural subsets of Vercel's real
 * request/response objects, so this type-checks against whatever Vercel
 * actually passes at runtime without importing `@vercel/node` (see above).
 */
export function vercelRoute(method: 'GET' | 'POST', handler: Handler) {
  return async (req: MinimalRequest, res: MinimalResponse): Promise<void> => {
    try {
      if (req.method !== method) {
        res.setHeader('Allow', method)
        res.status(405).json({ error: 'Method not allowed' })
        return
      }

      const result = await handler(req)

      for (const [key, value] of Object.entries(result.headers ?? {})) {
        res.setHeader(key, value)
      }
      if (result.redirect) {
        res.redirect(result.status || 302, result.redirect)
        return
      }
      res.status(result.status).json(result.json ?? {})
    } catch (err) {
      // Catches errors from the handler AND from writing the response itself,
      // so a bug here surfaces as clean JSON instead of Vercel's raw crash page.
      console.error(`[api] ${req.url} failed:`, err)
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal error',
          detail: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
}

/** Read a query param that may arrive as `string | string[]`. */
export function queryParam(
  req: MinimalRequest,
  name: string,
): string | undefined {
  const value = req.query[name]
  return Array.isArray(value) ? value[0] : value
}

/** Read the `Authorization` header, collapsing `string[]` to its first value. */
export function authHeader(req: MinimalRequest): string | undefined {
  const value = req.headers.authorization
  return Array.isArray(value) ? value[0] : value
}

/**
 * The origin the client actually reached this function on, e.g.
 * `https://app.example.com`. Behind Vercel's proxy the real host/proto are in
 * the `x-forwarded-*` headers. Used to anchor the Procore OAuth redirect URI.
 */
export function requestOrigin(req: MinimalRequest): string | null {
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
