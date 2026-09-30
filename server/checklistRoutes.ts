import { ApiResult } from './http.js'
import { resolveProfile } from './auth.js'
import {
  addCustomChecklistItem,
  clearChecklistItemScheduledDate,
  getChecklistStatusForProjects,
  logChecklistItem,
  removeChecklistItem,
  setChecklistItemDone,
  setChecklistItemScheduledDate,
  setSetupItemDate,
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

/** The 'log' action of POST /api/checklist — recurring items only, always inserts a new row. */
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
    await logChecklistItem(resolved.admin, projectId, checklistItemId, resolved.profileId)
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

/** The 'set-setup-date' action of POST /api/checklist — setup items only, completes the item. */
async function handleChecklistSetSetupDate(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { projectId, checklistItemId, date } = (body ?? {}) as {
    projectId?: unknown
    checklistItemId?: unknown
    date?: unknown
  }
  if (
    typeof projectId !== 'string' ||
    typeof checklistItemId !== 'string' ||
    typeof date !== 'string'
  ) {
    return {
      status: 400,
      json: {
        error: '"projectId" (string), "checklistItemId" (string), and "date" (string) are required',
      },
    }
  }

  try {
    await setSetupItemDate(resolved.admin, projectId, checklistItemId, resolved.profileId, date)
    return { status: 200, json: { ok: true } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not set date',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/**
 * The 'set-schedule' action of POST /api/checklist — recurring items only, a
 * schedule marker that doesn't complete the item. `date: null` clears it.
 */
async function handleChecklistSetSchedule(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { projectId, checklistItemId, date } = (body ?? {}) as {
    projectId?: unknown
    checklistItemId?: unknown
    date?: unknown
  }
  if (typeof projectId !== 'string' || typeof checklistItemId !== 'string') {
    return {
      status: 400,
      json: { error: '"projectId" (string) and "checklistItemId" (string) are required' },
    }
  }
  if (date !== null && typeof date !== 'string') {
    return { status: 400, json: { error: '"date" must be a string or null' } }
  }

  try {
    if (date === null) {
      await clearChecklistItemScheduledDate(resolved.admin, projectId, checklistItemId)
    } else {
      await setChecklistItemScheduledDate(resolved.admin, projectId, checklistItemId, date)
    }
    return { status: 200, json: { ok: true } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not set schedule',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

const CADENCE_TYPES = ['rolling', 'calendar_month'] as const

/** The 'add-custom' action of POST /api/checklist — a project's own recurring item. */
async function handleChecklistAddCustom(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { projectId, name, cadenceType, cadenceDays } = (body ?? {}) as {
    projectId?: unknown
    name?: unknown
    cadenceType?: unknown
    cadenceDays?: unknown
  }
  if (typeof projectId !== 'string' || typeof name !== 'string' || !name.trim()) {
    return {
      status: 400,
      json: { error: '"projectId" (string) and "name" (non-empty string) are required' },
    }
  }
  if (!CADENCE_TYPES.includes(cadenceType as (typeof CADENCE_TYPES)[number])) {
    return {
      status: 400,
      json: { error: `"cadenceType" must be one of: ${CADENCE_TYPES.join(', ')}` },
    }
  }
  if (
    cadenceType === 'rolling' &&
    (typeof cadenceDays !== 'number' || !Number.isFinite(cadenceDays) || cadenceDays <= 0)
  ) {
    return {
      status: 400,
      json: { error: '"cadenceDays" must be a positive number when cadenceType is "rolling"' },
    }
  }

  try {
    const item = await addCustomChecklistItem(
      resolved.admin,
      projectId,
      name.trim(),
      cadenceType as 'rolling' | 'calendar_month',
      cadenceType === 'rolling' ? (cadenceDays as number) : null,
    )
    return { status: 200, json: { item } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not add custom checklist item',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/** The 'remove' action of POST /api/checklist — excludes a default item, or deletes a custom one. */
async function handleChecklistRemove(
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
    await removeChecklistItem(resolved.admin, projectId, checklistItemId)
    return { status: 200, json: { ok: true } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not remove checklist item',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/**
 * POST /api/checklist — action dispatch:
 * { action: 'toggle' | 'log' | 'add-custom' | 'remove' | 'set-setup-date' | 'set-schedule', ... }.
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
    case 'add-custom':
      return handleChecklistAddCustom(authorizationHeader, body)
    case 'remove':
      return handleChecklistRemove(authorizationHeader, body)
    case 'set-setup-date':
      return handleChecklistSetSetupDate(authorizationHeader, body)
    case 'set-schedule':
      return handleChecklistSetSchedule(authorizationHeader, body)
    default:
      return {
        status: 400,
        json: {
          error:
            '"action" must be "toggle", "log", "add-custom", "remove", "set-setup-date", or "set-schedule"',
        },
      }
  }
}
