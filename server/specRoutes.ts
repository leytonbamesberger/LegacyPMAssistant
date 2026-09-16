import { ApiResult } from './http.js'
import { resolveProfile } from './auth.js'
import { getSpecSectionsForProject, syncProjectSpecs } from './specs.js'

/** GET /api/specs?projectId=X — cached spec sections for the picker + staleness checks. */
export async function handleSpecsList(
  authorizationHeader: string | undefined,
  query: { projectId?: string },
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  if (!query.projectId) {
    return { status: 400, json: { error: '"projectId" query param is required' } }
  }

  try {
    const sections = await getSpecSectionsForProject(resolved.admin, query.projectId)
    return { status: 200, json: { sections } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not load spec sections',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/** POST /api/specs/sync — body { projectId }. Pulls specs from Procore via the caller's own token. */
export async function handleSpecsSync(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { projectId } = (body ?? {}) as { projectId?: unknown }
  if (typeof projectId !== 'string') {
    return { status: 400, json: { error: '"projectId" (string) is required' } }
  }

  const sync = await syncProjectSpecs(resolved.admin, resolved.profileId, projectId)
  if (!sync.ok) console.warn('[specs] sync failed:', sync.error)

  try {
    const sections = await getSpecSectionsForProject(resolved.admin, projectId)
    return {
      status: 200,
      json: {
        sections,
        syncOk: sync.ok,
        syncError: sync.ok ? null : (sync.error ?? 'Sync failed'),
        syncedAt: new Date().toISOString(),
      },
    }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not load spec sections',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}
