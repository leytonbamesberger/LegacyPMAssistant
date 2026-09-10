import { handleProcoreDisconnect } from '../../server/procoreRoutes'
import { vercelRoute } from '../../server/vercelAdapter'

/** POST /api/procore/disconnect — drop the caller's stored Procore tokens. */
export default vercelRoute('POST', (req) =>
  handleProcoreDisconnect(req.headers.authorization),
)
