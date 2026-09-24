import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch } from './apiClient'

export interface Profile {
  id: string
  azure_oid: string
  email: string
  display_name: string | null
  title: 'pm' | 'apm' | null
  created_at: string
}

export interface ProfileDirectoryEntry {
  id: string
  display_name: string | null
  title: 'pm' | 'apm' | null
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

/** Self-editable at any time — not a permission tier, see supabase/schema.sql. */
export async function updateProfileTitle(
  instance: IPublicClientApplication,
  account: AccountInfo,
  title: 'pm' | 'apm',
): Promise<Profile | null> {
  const body = await apiFetch<{ profile: Profile }>(
    instance,
    account,
    '/api/profile',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    },
  )
  return body?.profile ?? null
}

/** Company-wide directory (id/display_name/title) for names + assignment pickers. */
export async function fetchProfileDirectory(
  instance: IPublicClientApplication,
  account: AccountInfo,
): Promise<ProfileDirectoryEntry[] | null> {
  const body = await apiFetch<{ profiles: ProfileDirectoryEntry[] }>(
    instance,
    account,
    '/api/profile',
  )
  return body?.profiles ?? null
}
