import { handleCreateSubmittal, handleGetSubmittal } from '../../server/submittalRoutes.js'
import { authHeader, queryParam, vercelRouteMulti } from '../../server/vercelAdapter.js'

/**
 * POST /api/submittals            — create + get an upload token (body { projectId, filename, csiSection? })
 * GET  /api/submittals?id=X       — fetch one check's current state
 * One file for both verbs — see the Hobby-plan function-count note in vercelAdapter.ts.
 */
export default vercelRouteMulti({
  POST: (req) => handleCreateSubmittal(authHeader(req), req.body),
  GET: (req) => handleGetSubmittal(authHeader(req), { id: queryParam(req, 'id') }),
})
