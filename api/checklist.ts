import { handleChecklistPost, handleChecklistStatus } from '../server/checklistRoutes.js'
import { authHeader, queryParam, vercelRouteMulti } from '../server/vercelAdapter.js'

/**
 * GET /api/checklist?projectIds=a,b,c — status of every phase for each project
 * POST /api/checklist                 — action dispatch: { action: 'toggle' | 'log', ... }
 * One file for every verb/action — see the Hobby-plan function-count note in vercelAdapter.ts.
 */
export default vercelRouteMulti({
  GET: (req) =>
    handleChecklistStatus(authHeader(req), { projectIds: queryParam(req, 'projectIds') }),
  POST: (req) => handleChecklistPost(authHeader(req), req.body),
})
