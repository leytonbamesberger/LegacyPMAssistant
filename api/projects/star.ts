import { handleProjectsStar } from '../../server/projectRoutes.js'
import { authHeader, vercelRoute } from '../../server/vercelAdapter.js'

/** POST /api/projects/star — body { projectId, starred }. */
export default vercelRoute('POST', (req) => handleProjectsStar(authHeader(req), req.body))
