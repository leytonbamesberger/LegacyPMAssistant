import { handleFlowReportsList, handleFlowReportsPost } from '../server/flowReportRoutes.js'
import { authHeader, queryParam, vercelRouteMulti } from '../server/vercelAdapter.js'

/**
 * GET /api/flow-reports?projectIds=a,b,c — this month's report status per project
 * POST /api/flow-reports                 — action dispatch: { action: 'save' | 'submit', ... }
 * One file for every verb/action — see the Hobby-plan function-count note in vercelAdapter.ts.
 */
export default vercelRouteMulti({
  GET: (req) =>
    handleFlowReportsList(authHeader(req), { projectIds: queryParam(req, 'projectIds') }),
  POST: (req) => handleFlowReportsPost(authHeader(req), req.body),
})
