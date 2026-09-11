import { SignJWT, jwtVerify } from 'jose'
import { SupabaseClient } from '@supabase/supabase-js'
import { getProcoreConfig, ProcoreConfig } from './config'

export interface ProcoreConnectionRow {
  id: string
  profile_id: string
  access_token: string | null
  refresh_token: string | null
  expires_at: string | null
  connected_at: string | null
}

interface ProcoreTokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  created_at: number
}

const STATE_TTL = '10m'
const STATE_AUDIENCE = 'procore-oauth-state'

function stateKey(config: ProcoreConfig): Uint8Array {
  return new TextEncoder().encode(config.stateSecret)
}

/**
 * Sign a short-lived `state` value. It doubles as CSRF protection and carries
 * the profile id so the callback (an unauthenticated redirect from Procore)
 * knows whose connection to store.
 */
export async function signOAuthState(
  profileId: string,
  config = getProcoreConfig(),
): Promise<string> {
  return new SignJWT({ profileId })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(STATE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(STATE_TTL)
    .sign(stateKey(config))
}

export async function verifyOAuthState(
  state: string,
  config = getProcoreConfig(),
): Promise<{ profileId: string }> {
  const { payload } = await jwtVerify(state, stateKey(config), {
    audience: STATE_AUDIENCE,
  })
  if (typeof payload.profileId !== 'string') {
    throw new Error('state missing profileId')
  }
  return { profileId: payload.profileId }
}

export function buildAuthorizeUrl(
  state: string,
  config = getProcoreConfig(),
): string {
  const url = new URL(config.authorizeUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

async function postToken(
  body: Record<string, string>,
  config: ProcoreConfig,
): Promise<ProcoreTokenResponse> {
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `Procore token endpoint returned ${res.status}: ${text.slice(0, 500)}`,
    )
  }
  return JSON.parse(text) as ProcoreTokenResponse
}

export async function exchangeCodeForTokens(
  code: string,
  config = getProcoreConfig(),
): Promise<ProcoreTokenResponse> {
  return postToken(
    {
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    },
    config,
  )
}

export async function refreshTokens(
  refreshToken: string,
  config = getProcoreConfig(),
): Promise<ProcoreTokenResponse> {
  return postToken(
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    },
    config,
  )
}

function expiryFromResponse(token: ProcoreTokenResponse): string {
  // Prefer Procore's own clock (`created_at` is unix seconds).
  const base = token.created_at ? token.created_at * 1000 : Date.now()
  return new Date(base + token.expires_in * 1000).toISOString()
}

export async function storeConnection(
  admin: SupabaseClient,
  profileId: string,
  token: ProcoreTokenResponse,
): Promise<void> {
  const { error } = await admin.from('procore_connections').upsert(
    {
      profile_id: profileId,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: expiryFromResponse(token),
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' },
  )
  if (error) throw new Error(`storeConnection failed: ${error.message}`)
}

export async function getConnection(
  admin: SupabaseClient,
  profileId: string,
): Promise<ProcoreConnectionRow | null> {
  const { data, error } = await admin
    .from('procore_connections')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw new Error(`getConnection failed: ${error.message}`)
  return (data as ProcoreConnectionRow) ?? null
}

export async function deleteConnection(
  admin: SupabaseClient,
  profileId: string,
): Promise<void> {
  const { error } = await admin
    .from('procore_connections')
    .delete()
    .eq('profile_id', profileId)
  if (error) throw new Error(`deleteConnection failed: ${error.message}`)
}

/**
 * Return a valid Procore access token for a profile, refreshing (and
 * persisting the rotated refresh token) if the stored one is expired or close
 * to it. Not used by any tool yet — this is the entry point the Procore-backed
 * tools will call.
 */
export async function getValidAccessToken(
  admin: SupabaseClient,
  profileId: string,
  config = getProcoreConfig(),
): Promise<string | null> {
  const connection = await getConnection(admin, profileId)
  if (!connection?.access_token || !connection.refresh_token) return null

  const expiresAt = connection.expires_at
    ? new Date(connection.expires_at).getTime()
    : 0
  const stillValid = expiresAt - Date.now() > 60_000 // 1 min headroom
  if (stillValid) return connection.access_token

  const refreshed = await refreshTokens(connection.refresh_token, config)
  await storeConnection(admin, profileId, refreshed)
  return refreshed.access_token
}
