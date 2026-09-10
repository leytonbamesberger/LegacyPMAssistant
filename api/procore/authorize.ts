import { handleProcoreAuthorize } from '../../server/procoreRoutes'
import { vercelRoute } from '../../server/vercelAdapter'

/** POST /api/procore/authorize — returns { url } to send the browser to Procore. */
export default vercelRoute('POST', (req) =>
  handleProcoreAuthorize(req.headers.authorization),
)
