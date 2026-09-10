import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { createClient } from '@supabase/supabase-js'
import { getServerConfig } from './config'

export interface ProfileRecord {
  id: string
  azure_oid: string
  email: string
  display_name: string | null
  created_at: string
}

export interface HandlerResult {
  status: number
  body: Record<string, unknown>
}

// Reused across warm invocations; `jose` caches the fetched signing keys.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJwks(jwksUri: string) {
  if (!jwks) jwks = createRemoteJWKSet(new URL(jwksUri))
  return jwks
}

interface AzureIdTokenClaims extends JWTPayload {
  oid?: string
  tid?: string
  email?: string
  preferred_username?: string
  name?: string
}

/**
 * Verify a Microsoft (Entra ID) ID token and provision the caller's `profiles`
 * row. All identity comes from the *verified* token — the client sends nothing
 * but the `Authorization: Bearer <idToken>` header.
 *
 * The write uses the Supabase service-role key, which bypasses RLS. The
 * `profiles` / `procore_connections` tables therefore have no anon policies —
 * the public anon key cannot touch them.
 */
export async function handleProfileRequest(
  authorizationHeader: string | undefined,
): Promise<HandlerResult> {
  const token = extractBearer(authorizationHeader)
  if (!token) {
    return { status: 401, body: { error: 'Missing bearer token' } }
  }

  const config = getServerConfig()

  let claims: AzureIdTokenClaims
  try {
    const { payload } = await jwtVerify(token, getJwks(config.azure.jwksUri), {
      issuer: config.azure.issuer,
      audience: config.azure.clientId,
    })
    claims = payload
  } catch (err) {
    return {
      status: 401,
      body: {
        error: 'Invalid token',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }

  // Defense in depth: the single-tenant issuer already pins the tenant, but
  // assert the tenant claim too.
  if (claims.tid && claims.tid !== config.azure.tenantId) {
    return { status: 403, body: { error: 'Token from unexpected tenant' } }
  }

  const azureOid = claims.oid ?? claims.sub
  if (!azureOid) {
    return { status: 400, body: { error: 'Token has no oid/sub claim' } }
  }

  const email = claims.email ?? claims.preferred_username ?? ''
  const displayName = claims.name ?? null

  const admin = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await admin
    .from('profiles')
    .upsert(
      { azure_oid: azureOid, email, display_name: displayName },
      { onConflict: 'azure_oid' },
    )
    .select()
    .single()

  if (error) {
    return {
      status: 500,
      body: {
        error: 'Could not provision profile',
        detail: error.message,
        code: error.code,
        hint: error.hint,
      },
    }
  }

  return { status: 200, body: { profile: data as ProfileRecord } }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}
