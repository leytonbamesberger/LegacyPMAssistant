import { SupabaseClient } from '@supabase/supabase-js'

const SUBMITTALS_BUCKET = 'submittals'

export function submittalStoragePath(projectId: string, submittalCheckId: string): string {
  return `${projectId}/${submittalCheckId}.pdf`
}

/**
 * A one-time, scoped permission to upload exactly this path — the browser
 * fulfills it with the (public) anon client, but the token itself is what
 * authorizes the write, not the anon key's own (nonexistent) storage access.
 */
export async function createSubmittalUploadUrl(
  admin: SupabaseClient,
  path: string,
): Promise<{ token: string; path: string }> {
  const { data, error } = await admin.storage
    .from(SUBMITTALS_BUCKET)
    .createSignedUploadUrl(path)
  if (error) throw new Error(`createSignedUploadUrl failed: ${error.message}`)
  return { token: data.token, path: data.path }
}

export async function downloadSubmittalFile(
  admin: SupabaseClient,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(SUBMITTALS_BUCKET).download(path)
  if (error) throw new Error(`download failed: ${error.message}`)
  return new Uint8Array(await data.arrayBuffer())
}
