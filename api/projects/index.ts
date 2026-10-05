import { handleProjectsList, handleProjectsPost } from '../../server/projectRoutes.js'
import { authHeader, queryParam, vercelRouteMulti } from '../../server/vercelAdapter.js'

/**
 * GET /api/projects  — cached project list (or ?initiationCatalogFor=<id>: one project's initiation checklist; ?overview=1: the Overview grid)
 * POST /api/projects — action dispatch: { action: 'sync' | 'star' | 'update' | 'initiate' | 'overview-add' | 'overview-remove', ... }
 * One file for every verb/action — see the Hobby-plan function-count note in vercelAdapter.ts.
 */
export default vercelRouteMulti({
  GET: (req) =>
    handleProjectsList(authHeader(req), {
      initiationCatalogFor: queryParam(req, 'initiationCatalogFor'),
      overview: queryParam(req, 'overview'),
    }),
  POST: (req) => handleProjectsPost(authHeader(req), req.body),
})
