import { handleProcoreStatus } from '../../server/procoreRoutes.js'
import { authHeader, vercelRoute } from '../../server/vercelAdapter.js'

/** GET /api/procore/status — { configured, connected, connectedAt, expiresAt }. */
export default vercelRoute('GET', (req) => handleProcoreStatus(authHeader(req)))
