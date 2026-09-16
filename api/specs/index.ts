import { handleSpecsList } from '../../server/specRoutes.js'
import { authHeader, queryParam, vercelRoute } from '../../server/vercelAdapter.js'

/** GET /api/specs?projectId=X */
export default vercelRoute('GET', (req) =>
  handleSpecsList(authHeader(req), { projectId: queryParam(req, 'projectId') }),
)
