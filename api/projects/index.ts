import { handleProjectsList, handleProjectsPost } from '../../server/projectRoutes.js'
import { authHeader, vercelRouteMulti } from '../../server/vercelAdapter.js'

/**
 * GET /api/projects  — cached project list
 * POST /api/projects — action dispatch: { action: 'sync' | 'star' | 'update', ... }
 * One file for every verb/action — see the Hobby-plan function-count note in vercelAdapter.ts.
 */
export default vercelRouteMulti({
  GET: (req) => handleProjectsList(authHeader(req)),
  POST: (req) => handleProjectsPost(authHeader(req), req.body),
})
