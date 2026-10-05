import { handleTasksList, handleTasksPost } from '../server/taskRoutes.js'
import { authHeader, queryParam, vercelRouteMulti } from '../server/vercelAdapter.js'

/**
 * GET /api/tasks  — tasks visible to the caller (filters: projectId, assigneeId, status, categories, page, pageSize)
 * POST /api/tasks             — action dispatch: { action: 'create' | 'set-status' | 'set-notes' | 'set-meeting-date' | 'delete', ... }
 * One file for every verb/action — see the Hobby-plan function-count note in vercelAdapter.ts.
 */
export default vercelRouteMulti({
  GET: (req) =>
    handleTasksList(authHeader(req), {
      projectId: queryParam(req, 'projectId'),
      assigneeId: queryParam(req, 'assigneeId'),
      status: queryParam(req, 'status'),
      categories: queryParam(req, 'categories'),
      page: queryParam(req, 'page'),
      pageSize: queryParam(req, 'pageSize'),
    }),
  POST: (req) => handleTasksPost(authHeader(req), req.body),
})
