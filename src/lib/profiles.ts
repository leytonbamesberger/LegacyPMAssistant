import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { loginRequest } from './msalConfig'

export interface Profile {
  id: string
  azure_oid: string
  email: string
  display_name: string | null
  created_at: string
}

/**
 * Ensure a `profiles` row exists for the signed-in Microsoft account.
 *
 * The browser never writes to Supabase directly. It sends its Microsoft ID
 * token to `POST /api/profile`, which verifies the token server-side and does
 * the upsert with the Supabase service-role key. See `server/profileHandler.ts`.
 *
 * Returns the profile, or null if the token couldn't be acquired or the API
 * call failed (the app shell still works without it).
 */
export async function ensureProfile(
  instance: IPublicClientApplication,
  account: AccountInfo,
): Promise<Profile | null> {
  let idToken: string
  try {
    const result = await instance.acquireTokenSilent({
      scopes: loginRequest.scopes,
      account,
    })
    idToken = result.idToken
  } catch (err) {
    console.error('[profiles] could not acquire ID token:', err)
    return null
  }

  let res: Response
  try {
    res = await fetch('/api/profile', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    })
  } catch (err) {
    console.error('[profiles] /api/profile request failed:', err)
    return null
  }

  if (!res.ok) {
    console.error(
      `[profiles] /api/profile returned ${res.status}:`,
      await res.text().catch(() => '<no body>'),
    )
    return null
  }

  const { profile } = (await res.json()) as { profile: Profile }
  return profile
}
