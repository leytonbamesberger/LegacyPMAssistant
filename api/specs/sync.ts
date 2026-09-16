import { handleSpecsSync } from '../../server/specRoutes.js'
import { authHeader, vercelRoute } from '../../server/vercelAdapter.js'

/** POST /api/specs/sync — body { projectId }. */
export default vercelRoute('POST', (req) => handleSpecsSync(authHeader(req), req.body))
