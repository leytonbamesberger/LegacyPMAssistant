import { ApiResult } from './http.js'
import { resolveProfile } from './auth.js'
import { createTask, deleteTask, getTasksForProfile, setTaskStatus } from './tasks.js'

/** GET /api/tasks?projectId=X — every task visible to the caller, optionally scoped to one project. */
export async function handleTasksList(
  authorizationHeader: string | undefined,
  query: { projectId?: string },
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  try {
    const tasks = await getTasksForProfile(resolved.admin, resolved.profileId, query.projectId)
    return { status: 200, json: { tasks } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not load tasks',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

const TASK_TYPES = ['project', 'person', 'personal'] as const
const TASK_VISIBILITIES = ['private', 'public'] as const

/** The 'create' action of POST /api/tasks. */
async function handleTasksCreate(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const raw = (body ?? {}) as {
    type?: unknown
    projectId?: unknown
    title?: unknown
    description?: unknown
    dueDate?: unknown
    assignedTo?: unknown
    visibility?: unknown
  }

  if (!TASK_TYPES.includes(raw.type as (typeof TASK_TYPES)[number])) {
    return { status: 400, json: { error: `"type" must be one of: ${TASK_TYPES.join(', ')}` } }
  }
  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    return { status: 400, json: { error: '"title" (non-empty string) is required' } }
  }
  if (typeof raw.assignedTo !== 'string') {
    return { status: 400, json: { error: '"assignedTo" (string) is required' } }
  }
  if (raw.projectId !== undefined && raw.projectId !== null && typeof raw.projectId !== 'string') {
    return { status: 400, json: { error: '"projectId" must be a string or null' } }
  }
  if (
    raw.description !== undefined &&
    raw.description !== null &&
    typeof raw.description !== 'string'
  ) {
    return { status: 400, json: { error: '"description" must be a string or null' } }
  }
  if (raw.dueDate !== undefined && raw.dueDate !== null && typeof raw.dueDate !== 'string') {
    return { status: 400, json: { error: '"dueDate" must be a string or null' } }
  }
  if (
    raw.visibility !== undefined &&
    !TASK_VISIBILITIES.includes(raw.visibility as (typeof TASK_VISIBILITIES)[number])
  ) {
    return {
      status: 400,
      json: { error: `"visibility" must be one of: ${TASK_VISIBILITIES.join(', ')}` },
    }
  }

  try {
    const task = await createTask(resolved.admin, resolved.profileId, {
      type: raw.type as 'project' | 'person' | 'personal',
      projectId: (raw.projectId ?? null) as string | null,
      title: raw.title.trim(),
      description: (raw.description ?? null) as string | null,
      dueDate: (raw.dueDate ?? null) as string | null,
      assignedTo: raw.assignedTo,
      visibility: (raw.visibility ?? 'private') as 'private' | 'public',
    })
    return { status: 200, json: { task } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not create task',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/** The 'set-status' action of POST /api/tasks — body { taskId, status }. */
async function handleTasksSetStatus(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { taskId, status } = (body ?? {}) as { taskId?: unknown; status?: unknown }
  if (typeof taskId !== 'string' || (status !== 'open' && status !== 'done')) {
    return {
      status: 400,
      json: { error: '"taskId" (string) and "status" ("open" or "done") are required' },
    }
  }

  try {
    await setTaskStatus(resolved.admin, taskId, resolved.profileId, status)
    return { status: 200, json: { ok: true } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not update task',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/** The 'delete' action of POST /api/tasks — body { taskId }. */
async function handleTasksDelete(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { taskId } = (body ?? {}) as { taskId?: unknown }
  if (typeof taskId !== 'string') {
    return { status: 400, json: { error: '"taskId" (string) is required' } }
  }

  try {
    await deleteTask(resolved.admin, taskId, resolved.profileId)
    return { status: 200, json: { ok: true } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not delete task',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/**
 * POST /api/tasks — action dispatch: { action: 'create' | 'set-status' | 'delete', ... }.
 * See the Hobby-plan function-count note in vercelAdapter.ts.
 */
export async function handleTasksPost(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const { action } = (body ?? {}) as { action?: unknown }
  switch (action) {
    case 'create':
      return handleTasksCreate(authorizationHeader, body)
    case 'set-status':
      return handleTasksSetStatus(authorizationHeader, body)
    case 'delete':
      return handleTasksDelete(authorizationHeader, body)
    default:
      return { status: 400, json: { error: '"action" must be "create", "set-status", or "delete"' } }
  }
}
