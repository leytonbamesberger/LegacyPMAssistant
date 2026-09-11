import { ApiResult, redirect } from './http'
import { resolveAppBaseUrl, getProcoreConfig, isProcoreConfigured } from './config'
import { getSupabaseAdmin, upsertProfile, verifyMicrosoftToken } from './auth'
import {
  buildAuthorizeUrl,
  deleteConnection,
  exchangeCodeForTokens,
  getConnection,
  signOAuthState,
  storeConnection,
  verifyOAuthState,
} from './procore'

/**
 * POST /api/procore/authorize  (MSAL-authenticated)
 * Returns { url } — the Procore consent URL the browser should navigate to.
 *
 * `requestOrigin` is the origin the browser reached this endpoint on
 * (e.g. https://app.example.com), supplied by the API adapter. It anchors the
 * OAuth redirect URI so it matches on the deployed domain without needing
 * APP_BASE_URL to be set.
 */
export async function handleProcoreAuthorize(
  authorizationHeader: string | undefined,
  requestOrigin?: string | null,
): Promise<ApiResult> {
  if (!isProcoreConfigured()) {
    return { status: 503, json: { error: 'Procore is not configured' } }
  }

  const verified = await verifyMicrosoftToken(authorizationHeader)
  if ('error' in verified) return verified.error

  // Ensure the profile exists so the callback has a row to attach to.
  const profileResult = await upsertProfile(getSupabaseAdmin(), verified.claims)
  if ('error' in profileResult) return profileResult.error

  const config = getProcoreConfig(requestOrigin)
  const state = await signOAuthState(profileResult.profile.id, config)
  return { status: 200, json: { url: buildAuthorizeUrl(state, config) } }
}

/**
 * GET /api/procore/callback?code=&state=  (redirect from Procore — no auth header)
 * Exchanges the code, stores the tokens, and bounces the user back to /home.
 */
export async function handleProcoreCallback(
  query: {
    code?: string
    state?: string
    error?: string
    error_description?: string
  },
  requestOrigin?: string | null,
): Promise<ApiResult> {
  const home = `${resolveAppBaseUrl(requestOrigin)}/home`

  if (query.error) {
    console.error('[procore] callback error:', query.error, query.error_description)
    return redirect(`${home}?procore=denied`)
  }
  if (!query.code || !query.state) {
    return redirect(`${home}?procore=error`)
  }

  const config = getProcoreConfig(requestOrigin)

  let profileId: string
  try {
    ;({ profileId } = await verifyOAuthState(query.state, config))
  } catch (err) {
    console.error('[procore] bad state:', err)
    return redirect(`${home}?procore=error`)
  }

  try {
    const tokens = await exchangeCodeForTokens(query.code, config)
    await storeConnection(getSupabaseAdmin(), profileId, tokens)
  } catch (err) {
    console.error('[procore] token exchange failed:', err)
    return redirect(`${home}?procore=error`)
  }

  return redirect(`${home}?procore=connected`)
}

/**
 * GET /api/procore/status  (MSAL-authenticated)
 * { configured, connected, connectedAt, expiresAt }
 */
export async function handleProcoreStatus(
  authorizationHeader: string | undefined,
): Promise<ApiResult> {
  const configured = isProcoreConfigured()

  const verified = await verifyMicrosoftToken(authorizationHeader)
  if ('error' in verified) return verified.error

  if (!configured) {
    return {
      status: 200,
      json: { configured: false, connected: false, connectedAt: null, expiresAt: null },
    }
  }

  const admin = getSupabaseAdmin()
  const profileResult = await upsertProfile(admin, verified.claims)
  if ('error' in profileResult) return profileResult.error

  const connection = await getConnection(admin, profileResult.profile.id)

  return {
    status: 200,
    json: {
      configured: true,
      connected: Boolean(connection?.access_token),
      connectedAt: connection?.connected_at ?? null,
      expiresAt: connection?.expires_at ?? null,
    },
  }
}

/**
 * POST /api/procore/disconnect  (MSAL-authenticated)
 */
export async function handleProcoreDisconnect(
  authorizationHeader: string | undefined,
): Promise<ApiResult> {
  const verified = await verifyMicrosoftToken(authorizationHeader)
  if ('error' in verified) return verified.error

  const admin = getSupabaseAdmin()
  const profileResult = await upsertProfile(admin, verified.claims)
  if ('error' in profileResult) return profileResult.error

  await deleteConnection(admin, profileResult.profile.id)
  return { status: 200, json: { connected: false } }
}
