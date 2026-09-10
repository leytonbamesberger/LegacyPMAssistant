import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleProfileRequest } from '../server/profileHandler'

/**
 * POST /api/profile
 *
 * Verifies the caller's Microsoft ID token (Authorization: Bearer <idToken>)
 * and upserts their `profiles` row using the Supabase service-role key.
 * Runs on Vercel in production; in local dev the same handler is mounted by a
 * Vite middleware (see `vite.config.ts`).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const result = await handleProfileRequest(req.headers.authorization)
    res.status(result.status).json(result.body)
  } catch (err) {
    console.error('[api/profile] unhandled error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
}
