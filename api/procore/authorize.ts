import { handleProcoreAuthorize } from '../../server/procoreRoutes.js'
import { authHeader, requestOrigin, vercelRoute } from '../../server/vercelAdapter.js'

/** POST /api/procore/authorize — returns { url } to send the browser to Procore. */
export default vercelRoute('POST', (req) =>
  handleProcoreAuthorize(authHeader(req), requestOrigin(req)),
)
