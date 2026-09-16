import { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_CONFIDENCE_THRESHOLD = 80

/** Read `app_config` at request time — no redeploy needed to retune this. */
export async function getConfidenceThreshold(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin
    .from('app_config')
    .select('value')
    .eq('key', 'confidence_threshold')
    .maybeSingle()
  if (error || !data) return DEFAULT_CONFIDENCE_THRESHOLD
  const parsed = Number(data.value)
  return Number.isFinite(parsed) ? parsed : DEFAULT_CONFIDENCE_THRESHOLD
}
