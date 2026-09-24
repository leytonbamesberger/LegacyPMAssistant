import { ApiResult } from './http.js'
import { resolveProfile } from './auth.js'
import {
  getChecklistStatusForProjects,
  logWeeklyChecklistItem,
  setChecklistItemDone,
} from './checklist.js'

/** GET /api/checklist?projectIds=a,b,c — status of every phase for each project. */
export async function handleChecklistStatus(
  authorizationHeader: string | undefined,
  query: { projectIds?: string },
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const projectIds = (query.projectIds ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  if (projectIds.length === 0) {
    return { status: 400, json: { error: '"projectIds" query param is required' } }
  }

  try {
    const statuses = await getChecklistStatusForProjects(resolved.admin, projectIds)
    return { status: 200, json: { statuses } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not load checklist status',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/** The 'toggle' action of POST /api/checklist — setup/closeout items only. */
async function handleChecklistToggle(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { projectId, checklistItemId, done } = (body ?? {}) as {
    projectId?: unknown
    checklistItemId?: unknown
    done?: unknown
  }
  if (
    typeof projectId !== 'string' ||
    typeof checklistItemId !== 'string' ||
    typeof done !== 'boolean'
  ) {
    return {
      status: 400,
      json: {
        error: '"projectId" (string), "checklistItemId" (string), and "done" (boolean) are required',
      },
    }
  }

  try {
    await setChecklistItemDone(resolved.admin, projectId, checklistItemId, resolved.profileId, done)
    return { status: 200, json: { done } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not update checklist item',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/** The 'log' action of POST /api/checklist — weekly items only, always inserts a new row. */
async function handleChecklistLog(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { projectId, checklistItemId } = (body ?? {}) as {
    projectId?: unknown
    checklistItemId?: unknown
  }
  if (typeof projectId !== 'string' || typeof checklistItemId !== 'string') {
    return {
      status: 400,
      json: { error: '"projectId" (string) and "checklistItemId" (string) are required' },
    }
  }

  try {
    await logWeeklyChecklistItem(resolved.admin, projectId, checklistItemId, resolved.profileId)
    return { status: 200, json: { ok: true } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not log checklist item',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/**
 * POST /api/checklist — action dispatch: { action: 'toggle' | 'log', ... }.
 * See the Hobby-plan function-count note in vercelAdapter.ts.
 */
export async function handleChecklistPost(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const { action } = (body ?? {}) as { action?: unknown }
  switch (action) {
    case 'toggle':
      return handleChecklistToggle(authorizationHeader, body)
    case 'log':
      return handleChecklistLog(authorizationHeader, body)
    default:
      return { status: 400, json: { error: '"action" must be "toggle" or "log"' } }
  }
}
