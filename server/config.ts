/**
 * Server-only configuration. These values are read from `process.env` and must
 * NOT be prefixed `VITE_` — they must never reach the browser bundle.
 *
 * - Local dev: loaded from `.env.local` by Vite (see `vite.config.ts`).
 * - Vercel: set in Project Settings → Environment Variables.
 *
 * The Azure/Supabase URL values are not secret, so we fall back to the
 * `VITE_`-prefixed copies to avoid duplicating them. Only
 * `SUPABASE_SERVICE_ROLE_KEY` is a true secret and has no fallback.
 */

function required(name: string, ...fallbackNames: string[]): string {
  for (const key of [name, ...fallbackNames]) {
    const value = process.env[key]
    if (value) return value
  }
  throw new Error(
    `Missing required server env var: ${name}` +
      (fallbackNames.length ? ` (or ${fallbackNames.join(' / ')})` : ''),
  )
}

export function getServerConfig() {
  const tenantId = required('AZURE_TENANT_ID', 'VITE_AZURE_TENANT_ID')
  return {
    azure: {
      tenantId,
      clientId: required('AZURE_CLIENT_ID', 'VITE_AZURE_CLIENT_ID'),
      /** v2.0 issuer for a single-tenant app. */
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
    },
    supabase: {
      url: required('SUPABASE_URL', 'VITE_SUPABASE_URL'),
      serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    },
  }
}

export type ServerConfig = ReturnType<typeof getServerConfig>
