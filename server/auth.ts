import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getServerConfig } from './config.js'
import { ApiResult, bearerToken } from './http.js'

export interface AzureIdTokenClaims extends JWTPayload {
  oid?: string
  tid?: string
  email?: string
  preferred_username?: string
  name?: string
}

export interface ProfileRecord {
  id: string
  azure_oid: string
  email: string
  display_name: string | null
  created_at: string
}

// Reused across warm invocations; `jose` caches the fetched signing keys.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJwks(jwksUri: string) {
  if (!jwks) jwks = createRemoteJWKSet(new URL(jwksUri))
  return jwks
}

export function getSupabaseAdmin(): SupabaseClient {
  const { supabase } = getServerConfig()
  return createClient(supabase.url, supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Verify the caller's Microsoft (Entra ID) ID token from the `Authorization`
 * header. Returns the verified claims, or an `ApiResult` to return as-is.
 */
export async function verifyMicrosoftToken(
  authorizationHeader: string | undefined,
): Promise<{ claims: AzureIdTokenClaims } | { error: ApiResult }> {
  const token = bearerToken(authorizationHeader)
  if (!token) {
    return { error: { status: 401, json: { error: 'Missing bearer token' } } }
  }

  const { azure } = getServerConfig()

  let claims: AzureIdTokenClaims
  try {
    const { payload } = await jwtVerify(token, getJwks(azure.jwksUri), {
      issuer: azure.issuer,
      audience: azure.clientId,
    })
    claims = payload
  } catch (err) {
    return {
      error: {
        status: 401,
        json: {
          error: 'Invalid token',
          detail: err instanceof Error ? err.message : String(err),
        },
      },
    }
  }

  // Defense in depth: the single-tenant issuer already pins the tenant.
  if (claims.tid && claims.tid !== azure.tenantId) {
    return {
      error: { status: 403, json: { error: 'Token from unexpected tenant' } },
    }
  }

  if (!claims.oid && !claims.sub) {
    return {
      error: { status: 400, json: { error: 'Token has no oid/sub claim' } },
    }
  }

  return { claims }
}

export function azureOidFromClaims(claims: AzureIdTokenClaims): string {
  // `oid` is the stable per-tenant object ID; `sub` is the per-app fallback.
  return (claims.oid ?? claims.sub) as string
}

/**
 * Upsert and return the `profiles` row for a set of verified token claims.
 * This is the single place a profile is created.
 */
export async function upsertProfile(
  admin: SupabaseClient,
  claims: AzureIdTokenClaims,
): Promise<
  { profile: ProfileRecord } | { error: ApiResult }
> {
  const azure_oid = azureOidFromClaims(claims)
  const email = claims.email ?? claims.preferred_username ?? ''
  const display_name = claims.name ?? null

  const { data, error } = await admin
    .from('profiles')
    .upsert({ azure_oid, email, display_name }, { onConflict: 'azure_oid' })
    .select()
    .single()

  if (error) {
    return {
      error: {
        status: 500,
        json: {
          error: 'Could not provision profile',
          detail: error.message,
          code: error.code,
          hint: error.hint,
        },
      },
    }
  }

  return { profile: data as ProfileRecord }
}

/**
 * The common first step of every authenticated `/api` handler: verify the
 * Microsoft token and ensure a `profiles` row exists for it. Returns the
 * profile id and a ready-to-use Supabase admin client, or an `ApiResult` to
 * return as-is.
 */
export async function resolveProfile(
  authorizationHeader: string | undefined,
): Promise<
  { admin: SupabaseClient; profileId: string } | { error: ApiResult }
> {
  const verified = await verifyMicrosoftToken(authorizationHeader)
  if ('error' in verified) return verified

  const admin = getSupabaseAdmin()
  const result = await upsertProfile(admin, verified.claims)
  if ('error' in result) return result

  return { admin, profileId: result.profile.id }
}
