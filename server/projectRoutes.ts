import { ApiResult } from './http.js'
import { resolveProfile } from './auth.js'
import { getProjectsForProfile, setProjectStarred, syncProjects } from './projects.js'

async function loadProjectsResult(
  admin: Parameters<typeof getProjectsForProfile>[0],
  profileId: string,
): Promise<ApiResult> {
  try {
    const projects = await getProjectsForProfile(admin, profileId)
    return { status: 200, json: { projects } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not load projects',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/**
 * GET /api/projects  (MSAL-authenticated)
 * Returns the cached project list immediately — never triggers a Procore
 * call itself, so the UI can render cached data with zero latency. The
 * client separately (and non-blockingly) calls /api/projects/sync.
 */
export async function handleProjectsList(
  authorizationHeader: string | undefined,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error
  return loadProjectsResult(resolved.admin, resolved.profileId)
}

/**
 * POST /api/projects/sync  (MSAL-authenticated)
 * Pulls the caller's Procore projects (via their own OAuth token) into the
 * shared cache, then returns the refreshed list either way — sync failure
 * (Procore not connected, token dead, Procore unreachable) is reported in
 * `syncOk`/`syncError` alongside the still-valid cached `projects`, never as
 * an HTTP error, so the UI can show a subtle warning instead of breaking.
 */
export async function handleProjectsSync(
  authorizationHeader: string | undefined,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const sync = await syncProjects(resolved.admin, resolved.profileId)
  if (!sync.ok) {
    console.warn('[projects] sync failed:', sync.error)
  }

  const listResult = await loadProjectsResult(resolved.admin, resolved.profileId)
  if (listResult.status !== 200) return listResult

  return {
    status: 200,
    json: {
      ...(listResult.json as object),
      syncOk: sync.ok,
      syncError: sync.ok ? null : (sync.error ?? 'Sync failed'),
      syncedAt: new Date().toISOString(),
    },
  }
}

/**
 * POST /api/projects/star  (MSAL-authenticated)
 * Body: { projectId: string, starred: boolean }
 */
export async function handleProjectsStar(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { projectId, starred } = (body ?? {}) as {
    projectId?: unknown
    starred?: unknown
  }
  if (typeof projectId !== 'string' || typeof starred !== 'boolean') {
    return {
      status: 400,
      json: { error: '"projectId" (string) and "starred" (boolean) are required' },
    }
  }

  try {
    await setProjectStarred(resolved.admin, resolved.profileId, projectId, starred)
    return { status: 200, json: { starred } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not update star',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}
