import type { AccountInfo } from '@azure/msal-browser'
import { supabase, isSupabaseConfigured } from './supabaseClient'

export interface Profile {
  id: string
  azure_oid: string
  email: string
  display_name: string | null
  created_at: string
}

/**
 * Pull the stable identifiers out of an MSAL account.
 * `localAccountId` is the Azure AD object ID (oid claim) — stable per user
 * per tenant, so it's our key into the `profiles` table.
 */
function identityFromAccount(account: AccountInfo) {
  const claims = (account.idTokenClaims ?? {}) as Record<string, unknown>
  return {
    azureOid: account.localAccountId,
    email:
      account.username ||
      (typeof claims.email === 'string' ? claims.email : '') ||
      (typeof claims.preferred_username === 'string'
        ? claims.preferred_username
        : ''),
    displayName:
      account.name ??
      (typeof claims.name === 'string' ? claims.name : null),
  }
}

/**
 * Ensure a `profiles` row exists for the signed-in Microsoft account.
 * Called once after login. Returns the profile, or null if Supabase isn't
 * reachable / configured (the app still works as a shell without it).
 */
export async function ensureProfile(
  account: AccountInfo,
): Promise<Profile | null> {
  if (!isSupabaseConfigured) {
    console.warn('[profiles] Supabase not configured — skipping profile sync.')
    return null
  }

  const { azureOid, email, displayName } = identityFromAccount(account)

  const { data: existing, error: selectError } = await supabase
    .from('profiles')
    .select('*')
    .eq('azure_oid', azureOid)
    .maybeSingle()

  if (selectError) {
    console.error('[profiles] lookup failed:', selectError.message)
    return null
  }

  if (existing) return existing as Profile

  const { data: created, error: insertError } = await supabase
    .from('profiles')
    .insert({ azure_oid: azureOid, email, display_name: displayName })
    .select()
    .single()

  if (insertError) {
    console.error('[profiles] create failed:', insertError.message)
    return null
  }

  return created as Profile
}
