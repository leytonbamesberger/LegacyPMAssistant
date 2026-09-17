import { handleSpecsList, handleSpecsSync } from '../../server/specRoutes.js'
import { authHeader, queryParam, vercelRouteMulti } from '../../server/vercelAdapter.js'

/**
 * GET /api/specs?projectId=X   — cached spec sections
 * POST /api/specs              — sync from Procore (body { projectId })
 * One file for both verbs — see the Hobby-plan function-count note in vercelAdapter.ts.
 */
export default vercelRouteMulti({
  GET: (req) => handleSpecsList(authHeader(req), { projectId: queryParam(req, 'projectId') }),
  POST: (req) => handleSpecsSync(authHeader(req), req.body),
})
