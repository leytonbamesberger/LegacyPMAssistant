import { handleProfileRequest } from '../server/profileHandler'
import { authHeader, vercelRoute } from '../server/vercelAdapter'

/**
 * POST /api/profile — verify the caller's Microsoft ID token and upsert their
 * `profiles` row using the Supabase service-role key. In local dev the same
 * handler is mounted by a Vite middleware (see `vite.config.ts`).
 */
export default vercelRoute('POST', (req) => handleProfileRequest(authHeader(req)))
