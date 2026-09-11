import { handleProcoreDisconnect } from '../../server/procoreRoutes'
import { authHeader, vercelRoute } from '../../server/vercelAdapter'

/** POST /api/procore/disconnect — drop the caller's stored Procore tokens. */
export default vercelRoute('POST', (req) => handleProcoreDisconnect(authHeader(req)))
