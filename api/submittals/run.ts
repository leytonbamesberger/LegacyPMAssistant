import { handleRunSubmittal } from '../../server/submittalRoutes.js'
import { authHeader, vercelRoute } from '../../server/vercelAdapter.js'

/**
 * POST /api/submittals/run — body { submittalCheckId, csiSectionOverride?, treatAsSingleSubmittal? }.
 * Runs up to 3 sequential AI calls (incl. a PDF to Sonnet 5) — see the
 * extended `maxDuration` for this route in vercel.json.
 */
export default vercelRoute('POST', (req) => handleRunSubmittal(authHeader(req), req.body))
