import { handleTasksList, handleTasksPost } from '../server/taskRoutes.js'
import { authHeader, queryParam, vercelRouteMulti } from '../server/vercelAdapter.js'

/**
 * GET /api/tasks?projectId=X — tasks visible to the caller, optionally scoped to one project
 * POST /api/tasks             — action dispatch: { action: 'create' | 'set-status' | 'delete', ... }
 * One file for every verb/action — see the Hobby-plan function-count note in vercelAdapter.ts.
 * This is the 12th and last file under the Hobby-plan cap — see README.md.
 */
export default vercelRouteMulti({
  GET: (req) => handleTasksList(authHeader(req), { projectId: queryParam(req, 'projectId') }),
  POST: (req) => handleTasksPost(authHeader(req), req.body),
})
