import { handleProcoreStatus } from '../../server/procoreRoutes'
import { authHeader, vercelRoute } from '../../server/vercelAdapter'

/** GET /api/procore/status — { configured, connected, connectedAt, expiresAt }. */
export default vercelRoute('GET', (req) => handleProcoreStatus(authHeader(req)))
