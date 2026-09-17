import { handleProjectsList, handleProjectsSync } from '../../server/projectRoutes.js'
import { authHeader, vercelRouteMulti } from '../../server/vercelAdapter.js'

/**
 * GET /api/projects   — cached project list
 * POST /api/projects  — sync from Procore
 * One file for both verbs — see the Hobby-plan function-count note in vercelAdapter.ts.
 */
export default vercelRouteMulti({
  GET: (req) => handleProjectsList(authHeader(req)),
  POST: (req) => handleProjectsSync(authHeader(req)),
})
