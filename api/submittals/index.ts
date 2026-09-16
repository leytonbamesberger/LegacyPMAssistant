import { handleCreateSubmittal } from '../../server/submittalRoutes.js'
import { authHeader, vercelRoute } from '../../server/vercelAdapter.js'

/** POST /api/submittals — body { projectId, filename, csiSection? }. */
export default vercelRoute('POST', (req) => handleCreateSubmittal(authHeader(req), req.body))
