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

/**
 * Where the browser app is served — used to build the Procore OAuth
 * redirect/return URLs. Resolution order:
 *   1. `APP_BASE_URL` env var (set this on Vercel to your stable domain), then
 *   2. the origin of the incoming request (`https://<host>`), which the API
 *      adapters derive from `x-forwarded-proto` / `host`, then
 *   3. localhost, for safety.
 *
 * (2) means it usually works on Vercel even if you forget `APP_BASE_URL` —
 * but you still must register the exact callback URL with Procore.
 */
export function resolveAppBaseUrl(requestOrigin?: string | null): string {
  const fromEnv = process.env.APP_BASE_URL
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  if (requestOrigin) return requestOrigin.replace(/\/$/, '')
  return 'http://localhost:5173'
}

const PROCORE_REQUIRED_VARS = [
  'PROCORE_CLIENT_ID',
  'PROCORE_CLIENT_SECRET',
  'PROCORE_OAUTH_STATE_SECRET',
] as const

/** Which required Procore vars are missing/empty in `process.env` right now. */
export function missingProcoreVars(): string[] {
  return PROCORE_REQUIRED_VARS.filter((name) => !process.env[name])
}

/**
 * True if all Procore OAuth vars are present. The "Connect Procore" button is
 * shown as unavailable (not just broken) when this is false.
 */
export function isProcoreConfigured(): boolean {
  return missingProcoreVars().length === 0
}

export function getProcoreConfig(requestOrigin?: string | null) {
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
    // Sent to Procore in BOTH the authorize step and the token exchange — the
    // two must be byte-identical, and this exact string must be registered on
    // the Procore app. `PROCORE_REDIRECT_URI` overrides; otherwise it's derived
    // from the request origin (or APP_BASE_URL).
    redirectUri: optional(
      'PROCORE_REDIRECT_URI',
      `${resolveAppBaseUrl(requestOrigin)}/api/procore/callback`,
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
