import { handleProjectsSync } from '../../server/projectRoutes.js'
import { authHeader, vercelRoute } from '../../server/vercelAdapter.js'

/** POST /api/projects/sync — pulls fresh projects from Procore, returns the list either way. */
export default vercelRoute('POST', (req) => handleProjectsSync(authHeader(req)))
