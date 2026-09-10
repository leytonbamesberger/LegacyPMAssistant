import { createClient } from '@supabase/supabase-js'

/**
 * Browser Supabase client (anon key).
 *
 * NOT used for profiles or any sensitive table — those go through
 * `POST /api/profile`, which uses the service-role key server-side. The
 * `profiles` / `procore_connections` tables have RLS on with no anon policies,
 * so this client cannot read or write them.
 *
 * Kept for future *public*, RLS-protected read-only data (e.g. a shared
 * reference list). Safe to delete if that never materialises.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env.local and fill in the values. ' +
      'The app shell still runs; profile sync is skipped until these are set.',
  )
}

// Fall back to a syntactically valid placeholder so `createClient` doesn't throw
// during the POC when env vars aren't set. Callers should gate real queries on
// `isSupabaseConfigured`.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      // Auth is handled by MSAL (Microsoft), not Supabase Auth. Don't let the
      // client try to manage its own session.
      persistSession: false,
      autoRefreshToken: false,
    },
  },
)
