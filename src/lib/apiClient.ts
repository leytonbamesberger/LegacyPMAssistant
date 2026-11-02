import { InteractionRequiredAuthError, type AccountInfo, type IPublicClientApplication } from '@azure/msal-browser'
import { loginRequest } from './msalConfig'

/** Refresh the ID token when it has less than this long left, so the server never sees an expired one. */
const EXPIRY_MARGIN_SECONDS = 5 * 60
/** Pause before retrying a request that failed for a transient reason. */
const RETRY_DELAY_MS = 500
/** Don't bounce the user to Microsoft sign-in more than once in this window (guards against a redirect loop). */
const REAUTH_COOLDOWN_MS = 60_000
const REAUTH_KEY = 'legacy-pm-reauth-at'

function recentlyReauthed(): boolean {
  try {
    const at = Number(sessionStorage.getItem(REAUTH_KEY))
    return at > 0 && Date.now() - at < REAUTH_COOLDOWN_MS
  } catch {
    return false
  }
}

/** The silent refresh needs the user (session ended, consent changed): send them through sign-in once. */
function startReauth(instance: IPublicClientApplication, account: AccountInfo) {
  if (recentlyReauthed()) return
  try {
    sessionStorage.setItem(REAUTH_KEY, String(Date.now()))
  } catch {
    // sessionStorage unavailable — the redirect still happens, just without the loop guard
  }
  instance.acquireTokenRedirect({ ...loginRequest, account }).catch((err) => {
    console.error('[api] could not start sign-in redirect:', err)
  })
}

/**
 * Acquire the current Microsoft ID token for the signed-in account. Used as the
 * bearer token for our own `/api/*` endpoints, which verify it server-side.
 *
 * MSAL decides freshness from the *access* token, which outlives the ID token — so a cached
 * result can carry an expired ID token. We check the ID token's own expiry and force a refresh
 * when it is (nearly) up. `forceRefresh` skips the cache outright (used after a 401).
 *
 * If the refresh needs the user, they're redirected to sign in rather than failing silently.
 */
export async function getIdToken(
  instance: IPublicClientApplication,
  account: AccountInfo,
  forceRefresh = false,
): Promise<string | null> {
  try {
    let result = await instance.acquireTokenSilent({ scopes: loginRequest.scopes, account, forceRefresh })
    const exp = (result.idTokenClaims as { exp?: number } | undefined)?.exp
    if (!forceRefresh && typeof exp === 'number' && exp - Date.now() / 1000 < EXPIRY_MARGIN_SECONDS) {
      result = await instance.acquireTokenSilent({ scopes: loginRequest.scopes, account, forceRefresh: true })
    }
    return result.idToken
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      console.warn('[api] session needs sign-in again:', err.errorCode)
      startReauth(instance, account)
    } else {
      console.error('[api] could not acquire ID token:', err)
    }
    return null
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * fetch() with the ID token attached, plus the retries that make a brief hiccup invisible:
 * - 401 → refresh the token and resend once (a 401 means nothing was processed, so this is safe for any method);
 * - network error or 502/503/504 → resend once, for GET only (never re-run a write that may have landed).
 * Returns null when no token could be had or the request never reached the server.
 */
export async function authedFetch(
  instance: IPublicClientApplication,
  account: AccountInfo,
  path: string,
  init: RequestInit = {},
): Promise<Response | null> {
  let idToken = await getIdToken(instance, account)
  if (!idToken) return null

  const isRead = (init.method ?? 'GET').toUpperCase() === 'GET'
  const send = () => fetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${idToken}` } })

  let res: Response
  try {
    res = await send()
  } catch (err) {
    if (!isRead) {
      console.error(`[api] ${path} request failed:`, err)
      return null
    }
    await sleep(RETRY_DELAY_MS)
    try {
      res = await send()
    } catch (retryErr) {
      console.error(`[api] ${path} request failed:`, retryErr)
      return null
    }
  }

  if (res.status === 401) {
    const fresh = await getIdToken(instance, account, true)
    if (fresh) {
      idToken = fresh
      try {
        res = await send()
      } catch (err) {
        console.error(`[api] ${path} request failed:`, err)
        return null
      }
    }
  } else if (isRead && (res.status === 502 || res.status === 503 || res.status === 504)) {
    await sleep(RETRY_DELAY_MS)
    try {
      res = await send()
    } catch (err) {
      console.error(`[api] ${path} request failed:`, err)
      return null
    }
  }

  return res
}

/**
 * Call one of our `/api/*` endpoints with the Microsoft ID token attached.
 * Returns the parsed JSON body (typed by the caller), or null on any failure
 * (network, auth, non-2xx) — failures are logged.
 */
export async function apiFetch<T>(
  instance: IPublicClientApplication,
  account: AccountInfo,
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const res = await authedFetch(instance, account, path, init)
  if (!res) return null

  if (!res.ok) {
    console.error(
      `[api] ${path} returned ${res.status}:`,
      await res.text().catch(() => '<no body>'),
    )
    return null
  }

  return (await res.json()) as T
}

/** Like apiFetch, but for a binary response (e.g. a generated PDF) — returns a Blob instead of parsed JSON. */
export async function apiFetchBlob(
  instance: IPublicClientApplication,
  account: AccountInfo,
  path: string,
  init: RequestInit = {},
): Promise<Blob | null> {
  const res = await authedFetch(instance, account, path, init)
  if (!res) return null

  if (!res.ok) {
    console.error(
      `[api] ${path} returned ${res.status}:`,
      await res.text().catch(() => '<no body>'),
    )
    return null
  }

  return await res.blob()
}
