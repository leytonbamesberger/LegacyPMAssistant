import { handleProcoreDisconnect } from '../../server/procoreRoutes.js'
import { authHeader, vercelRoute } from '../../server/vercelAdapter.js'

/** POST /api/procore/disconnect — drop the caller's stored Procore tokens. */
export default vercelRoute('POST', (req) => handleProcoreDisconnect(authHeader(req)))
