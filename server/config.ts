/**
 * Server-only configuration. These values are read from `process.env` and must
 * NOT be prefixed `VITE_` — they must never reach the browser bundle.
 *
 * - Local dev: loaded from `.env.local` by Vite (see `vite.config.ts`).
 * - Vercel: set in Project Settings → Environment Variables.
 *
 * The Azure/Supabase URL values are not secret, so we fall back to the
 * `VITE_`-prefixed copies to avoid duplicating them. Only true secrets
 * (`SUPABASE_SERVICE_ROLE_KEY`, `PROCORE_CLIENT_SECRET`, ...) have no fallback.
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

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback
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

/** Where the browser app is served — used to build post-OAuth redirect URLs. */
export function getAppBaseUrl(): string {
  return optional('APP_BASE_URL', 'http://localhost:5173').replace(/\/$/, '')
}

/**
 * True if all Procore OAuth vars are present. The "Connect Procore" button is
 * shown as unavailable (not just broken) when this is false.
 */
export function isProcoreConfigured(): boolean {
  return Boolean(
    process.env.PROCORE_CLIENT_ID &&
      process.env.PROCORE_CLIENT_SECRET &&
      process.env.PROCORE_OAUTH_STATE_SECRET,
  )
}

export function getProcoreConfig() {
  const authBase = optional(
    'PROCORE_AUTH_BASE_URL',
    'https://login.procore.com',
  ).replace(/\/$/, '')
  const apiBase = optional(
    'PROCORE_API_BASE_URL',
    'https://api.procore.com',
  ).replace(/\/$/, '')

  return {
    clientId: required('PROCORE_CLIENT_ID'),
    clientSecret: required('PROCORE_CLIENT_SECRET'),
    redirectUri: optional(
      'PROCORE_REDIRECT_URI',
      `${getAppBaseUrl()}/api/procore/callback`,
    ),
    /** Signs the short-lived OAuth `state` (CSRF + carries the profile id). */
    stateSecret: required('PROCORE_OAUTH_STATE_SECRET'),
    authBase,
    apiBase,
    authorizeUrl: `${authBase}/oauth/authorize`,
    tokenUrl: `${authBase}/oauth/token`,
  }
}

export type ProcoreConfig = ReturnType<typeof getProcoreConfig>
