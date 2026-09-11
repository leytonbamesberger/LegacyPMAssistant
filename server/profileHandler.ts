import { ApiResult } from './http.js'
import { getSupabaseAdmin, upsertProfile, verifyMicrosoftToken } from './auth.js'

/**
 * POST /api/profile
 *
 * Verify the caller's Microsoft ID token and provision their `profiles` row.
 * All identity comes from the *verified* token — the client sends nothing but
 * the `Authorization: Bearer <idToken>` header.
 *
 * The write uses the Supabase service-role key, which bypasses RLS. The
 * `profiles` / `procore_connections` tables have no anon policies, so the
 * public anon key cannot touch them.
 */
export async function handleProfileRequest(
  authorizationHeader: string | undefined,
): Promise<ApiResult> {
  const verified = await verifyMicrosoftToken(authorizationHeader)
  if ('error' in verified) return verified.error

  const result = await upsertProfile(getSupabaseAdmin(), verified.claims)
  if ('error' in result) return result.error

  return { status: 200, json: { profile: result.profile } }
}
