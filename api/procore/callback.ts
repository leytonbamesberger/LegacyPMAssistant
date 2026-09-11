import { handleProcoreCallback } from '../../server/procoreRoutes.js'
import { queryParam, requestOrigin, vercelRoute } from '../../server/vercelAdapter.js'

/** GET /api/procore/callback — Procore redirects here with ?code & ?state. */
export default vercelRoute('GET', (req) =>
  handleProcoreCallback(
    {
      code: queryParam(req, 'code'),
      state: queryParam(req, 'state'),
      error: queryParam(req, 'error'),
      error_description: queryParam(req, 'error_description'),
    },
    requestOrigin(req),
  ),
)
