import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch } from './apiClient'

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
 * The browser never writes to Supabase directly. `POST /api/profile` verifies
 * the Microsoft ID token server-side and does the upsert with the service-role
 * key. See `server/profileHandler.ts`.
 */
export async function ensureProfile(
  instance: IPublicClientApplication,
  account: AccountInfo,
): Promise<Profile | null> {
  const body = await apiFetch<{ profile: Profile }>(
    instance,
    account,
    '/api/profile',
    { method: 'POST' },
  )
  return body?.profile ?? null
}
