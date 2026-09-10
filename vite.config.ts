import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Runs the `/api/*` serverless handlers during `vite dev`, so local development
 * matches the deployed Vercel behaviour without needing the Vercel CLI. In
 * production Vercel serves `api/profile.ts` directly and this plugin is absent.
 */
function devApiPlugin(env: Record<string, string>): Plugin {
  // Make server-only vars from .env.local visible to the handler via process.env.
  const SERVER_ENV_KEYS = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'AZURE_TENANT_ID',
    'AZURE_CLIENT_ID',
    'VITE_SUPABASE_URL',
    'VITE_AZURE_TENANT_ID',
    'VITE_AZURE_CLIENT_ID',
  ]

  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      for (const key of SERVER_ENV_KEYS) {
        if (env[key] && !process.env[key]) process.env[key] = env[key]
      }

      server.middlewares.use('/api/profile', (req, res, next) => {
        if (req.method !== 'POST') return next()
        void (async () => {
          try {
            const mod = await server.ssrLoadModule('/server/profileHandler.ts')
            const result = await mod.handleProfileRequest(req.headers.authorization)
            res.statusCode = result.status
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(result.body))
          } catch (err) {
            server.config.logger.error(`[dev-api] /api/profile: ${String(err)}`)
            res.statusCode = 500
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ error: 'Internal error (dev)' }))
          }
        })()
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), devApiPlugin(env)],
  }
})
