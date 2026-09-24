import { handleProfileDirectory, handleProfileRequest } from '../server/profileHandler.js'
import { authHeader, vercelRouteMulti } from '../server/vercelAdapter.js'

/**
 * GET /api/profile  — company-wide profile directory
 * POST /api/profile — verify the caller's Microsoft ID token, upsert their
 *                      `profiles` row, and optionally set { title }.
 * In local dev the same handlers are mounted by a Vite middleware (see `vite.config.ts`).
 */
export default vercelRouteMulti({
  GET: (req) => handleProfileDirectory(authHeader(req)),
  POST: (req) => handleProfileRequest(authHeader(req), req.body),
})
