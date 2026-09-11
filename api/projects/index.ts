import { handleProjectsList } from '../../server/projectRoutes.js'
import { authHeader, vercelRoute } from '../../server/vercelAdapter.js'

/** GET /api/projects — cached project list (never itself calls Procore). */
export default vercelRoute('GET', (req) => handleProjectsList(authHeader(req)))
