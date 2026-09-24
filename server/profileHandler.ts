import { ApiResult } from './http.js'
import { getSupabaseAdmin, upsertProfile, verifyMicrosoftToken } from './auth.js'

export interface ProfileDirectoryEntry {
  id: string
  display_name: string | null
  title: 'pm' | 'apm' | null
}

/**
 * GET /api/profile — the company-wide profile directory (id/display_name/title
 * only, no email/azure_oid), used to render PM/APM names, checklist
 * "completed by", and assignment pickers. Any authenticated user can read the
 * whole directory — same company-trusted model as `projects`.
 */
export async function handleProfileDirectory(
  authorizationHeader: string | undefined,
): Promise<ApiResult> {
  const verified = await verifyMicrosoftToken(authorizationHeader)
  if ('error' in verified) return verified.error

  const { data, error } = await getSupabaseAdmin()
    .from('profiles')
    .select('id, display_name, title')
    .order('display_name')

  if (error) {
    return {
      status: 500,
      json: { error: 'Could not load profiles', detail: error.message },
    }
  }

  return { status: 200, json: { profiles: data as ProfileDirectoryEntry[] } }
}

/**
 * POST /api/profile
 *
 * Verify the caller's Microsoft ID token and provision their `profiles` row.
 * All identity comes from the *verified* token — the client sends nothing but
 * the `Authorization: Bearer <idToken>` header, plus an optional JSON body
 * `{ title: 'pm' | 'apm' }` to set/change the caller's own title (self-editable
 * at any time, e.g. from ProfileMenu — not a permission tier, see schema.sql).
 *
 * The write uses the Supabase service-role key, which bypasses RLS. The
 * `profiles` / `procore_connections` tables have no anon policies, so the
 * public anon key cannot touch them.
 */
export async function handleProfileRequest(
  authorizationHeader: string | undefined,
  body?: unknown,
): Promise<ApiResult> {
  const verified = await verifyMicrosoftToken(authorizationHeader)
  if ('error' in verified) return verified.error

  const admin = getSupabaseAdmin()
  const result = await upsertProfile(admin, verified.claims)
  if ('error' in result) return result.error

  const { title } = (body ?? {}) as { title?: unknown }
  if (title === undefined) {
    return { status: 200, json: { profile: result.profile } }
  }
  if (title !== 'pm' && title !== 'apm') {
    return { status: 400, json: { error: '"title" must be "pm" or "apm"' } }
  }

  const { data, error } = await admin
    .from('profiles')
    .update({ title })
    .eq('id', result.profile.id)
    .select()
    .single()

  if (error) {
    return {
      status: 500,
      json: { error: 'Could not update title', detail: error.message },
    }
  }

  return { status: 200, json: { profile: data } }
}
