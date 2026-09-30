import { handleFlowReportsList, handleFlowReportsPost } from '../server/flowReportRoutes.js'
import { authHeader, queryParam, vercelRouteMulti } from '../server/vercelAdapter.js'

/**
 * GET /api/flow-reports?projectIds=a,b,c          — default-period report status per project
 * GET /api/flow-reports?projectId=x&month=YYYY-MM-DD — one project's report for one month
 * POST /api/flow-reports                          — action dispatch: { action: 'save' | 'submit', ... }
 * One file for every verb/action — see the Hobby-plan function-count note in vercelAdapter.ts.
 */
export default vercelRouteMulti({
  GET: (req) =>
    handleFlowReportsList(authHeader(req), {
      projectIds: queryParam(req, 'projectIds'),
      projectId: queryParam(req, 'projectId'),
      month: queryParam(req, 'month'),
      availableMonths: queryParam(req, 'availableMonths'),
    }),
  POST: (req) => handleFlowReportsPost(authHeader(req), req.body),
})
