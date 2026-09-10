import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { loginRequest } from './msalConfig'

/**
 * Acquire the current Microsoft ID token for the signed-in account. Used as the
 * bearer token for our own `/api/*` endpoints, which verify it server-side.
 */
export async function getIdToken(
  instance: IPublicClientApplication,
  account: AccountInfo,
): Promise<string | null> {
  try {
    const result = await instance.acquireTokenSilent({
      scopes: loginRequest.scopes,
      account,
    })
    return result.idToken
  } catch (err) {
    console.error('[api] could not acquire ID token:', err)
    return null
  }
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
  const idToken = await getIdToken(instance, account)
  if (!idToken) return null

  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${idToken}` },
    })
  } catch (err) {
    console.error(`[api] ${path} request failed:`, err)
    return null
  }

  if (!res.ok) {
    console.error(
      `[api] ${path} returned ${res.status}:`,
      await res.text().catch(() => '<no body>'),
    )
    return null
  }

  return (await res.json()) as T
}
