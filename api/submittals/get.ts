import { handleGetSubmittal } from '../../server/submittalRoutes.js'
import { authHeader, queryParam, vercelRoute } from '../../server/vercelAdapter.js'

/** GET /api/submittals/get?id=X */
export default vercelRoute('GET', (req) =>
  handleGetSubmittal(authHeader(req), { id: queryParam(req, 'id') }),
)
