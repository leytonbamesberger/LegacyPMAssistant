import { handleProcoreStatus } from '../../server/procoreRoutes'
import { vercelRoute } from '../../server/vercelAdapter'

/** GET /api/procore/status — { configured, connected, connectedAt, expiresAt }. */
export default vercelRoute('GET', (req) =>
  handleProcoreStatus(req.headers.authorization),
)
