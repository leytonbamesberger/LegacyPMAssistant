import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Runs the `/api/*` handlers during `vite dev` so local behaviour matches the
 * deployed Vercel functions without needing the Vercel CLI. In production
 * Vercel serves the files in `api/` directly and this plugin is absent.
 *
 * Each route loads its framework-agnostic handler (which returns an `ApiResult`)
 * through Vite's SSR module pipeline, so edits to `server/*` hot-reload.
 */

interface DevRoute {
  path: string
  method: 'GET' | 'POST'
  module: string
  export: string
  /** How to call the handler: bearer token, parsed query object, or (token, JSON body). */
  arg: 'auth' | 'query' | 'authAndBody'
}

const ROUTES: DevRoute[] = [
  { path: '/api/profile', method: 'POST', module: '/server/profileHandler.ts', export: 'handleProfileRequest', arg: 'auth' },
  { path: '/api/procore/authorize', method: 'POST', module: '/server/procoreRoutes.ts', export: 'handleProcoreAuthorize', arg: 'auth' },
  { path: '/api/procore/callback', method: 'GET', module: '/server/procoreRoutes.ts', export: 'handleProcoreCallback', arg: 'query' },
  { path: '/api/procore/status', method: 'GET', module: '/server/procoreRoutes.ts', export: 'handleProcoreStatus', arg: 'auth' },
  { path: '/api/procore/disconnect', method: 'POST', module: '/server/procoreRoutes.ts', export: 'handleProcoreDisconnect', arg: 'auth' },
  { path: '/api/projects/sync', method: 'POST', module: '/server/projectRoutes.ts', export: 'handleProjectsSync', arg: 'auth' },
  { path: '/api/projects/star', method: 'POST', module: '/server/projectRoutes.ts', export: 'handleProjectsStar', arg: 'authAndBody' },
  // connect mounts by path *prefix*, so this one also matches /api/projects/sync
  // and /api/projects/star — harmless, since every route's method check below
  // calls next() on a mismatch, letting the request fall through to the right one.
  { path: '/api/projects', method: 'GET', module: '/server/projectRoutes.ts', export: 'handleProjectsList', arg: 'auth' },
]

// Non-secret URL vars have VITE_ fallbacks; forward both so `server/config.ts`
// can resolve them from process.env in the dev server.
const FORWARD_ENV = [
  'APP_BASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'VITE_SUPABASE_URL',
  'VITE_AZURE_TENANT_ID',
  'VITE_AZURE_CLIENT_ID',
  'PROCORE_CLIENT_ID',
  'PROCORE_CLIENT_SECRET',
  'PROCORE_REDIRECT_URI',
  'PROCORE_OAUTH_STATE_SECRET',
  'PROCORE_AUTH_BASE_URL',
  'PROCORE_API_BASE_URL',
  'ANTHROPIC_API_KEY',
]

interface ApiResult {
  status: number
  json?: unknown
  redirect?: string
  headers?: Record<string, string>
}

function devApiPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      for (const key of FORWARD_ENV) {
        if (env[key] && !process.env[key]) process.env[key] = env[key]
      }

      for (const route of ROUTES) {
        server.middlewares.use(route.path, (req, res, next) => {
          if (req.method !== route.method) return next()
          void handle(route, req, res).catch((err) => {
            server.config.logger.error(`[dev-api] ${route.path}: ${String(err)}`)
            writeResult(res, { status: 500, json: { error: 'Internal error (dev)' } })
          })
        })
      }

      async function handle(
        route: DevRoute,
        req: IncomingMessage,
        res: ServerResponse,
      ) {
        const mod = await server.ssrLoadModule(route.module)
        const fn = mod[route.export] as (...args: unknown[]) => Promise<ApiResult>

        const host = req.headers.host ?? 'localhost:5173'
        const origin = `http://${host}`

        if (route.arg === 'authAndBody') {
          const body = await readJsonBody(req)
          writeResult(res, await fn(req.headers.authorization, body))
          return
        }

        let arg: unknown
        if (route.arg === 'auth') {
          arg = req.headers.authorization
        } else {
          const url = new URL(req.url ?? '/', origin)
          arg = Object.fromEntries(url.searchParams)
        }

        writeResult(res, await fn(arg, origin))
      }
    },
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function writeResult(res: ServerResponse, result: ApiResult) {
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    res.setHeader(key, value)
  }
  if (result.redirect) {
    res.statusCode = result.status || 302
    res.setHeader('location', result.redirect)
    res.end()
    return
  }
  res.statusCode = result.status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(result.json ?? {}))
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), devApiPlugin(env)],
  }
})
