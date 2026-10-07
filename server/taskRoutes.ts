import { ApiResult } from './http.js'
import { resolveProfile } from './auth.js'
import {
  createTask,
  DEFAULT_PAGE_SIZE,
  deleteTask,
  getMeetingDatedTasks,
  getTasksForProfile,
  isRealDate,
  setMeetingDate,
  setTaskNotes,
  setTaskStatus,
  TaskRuleError,
  updateTask,
  type NewTaskFields,
  type TaskSourceCategory,
} from './tasks.js'
import type { CadenceUnit } from '../shared/period.js'

function ruleOrServerError(err: unknown, serverMessage: string): ApiResult {
  if (err instanceof TaskRuleError) return { status: err.status, json: { error: err.message } }
  return {
    status: 500,
    json: { error: serverMessage, detail: err instanceof Error ? err.message : String(err) },
  }
}

export interface TasksListQuery {
  projectId?: string
  assigneeId?: string
  /** 'open' (default), 'complete', or 'meeting' (every task with a meeting date, for the calendar). */
  status?: string
  /** Comma-separated source categories: setup,recurring,closeout,flow. */
  categories?: string
  page?: string
  pageSize?: string
}

const SOURCE_CATEGORIES = ['setup', 'recurring', 'closeout', 'flow'] as const

function positiveInt(raw: string | undefined): number | undefined {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/**
 * GET /api/tasks — tasks visible to the caller, filtered by projectId / assigneeId /
 * categories and by status ('open' by default, 'complete' for the Archive, which
 * also takes page + pageSize and returns { tasks, total, page, pageSize }).
 */
export async function handleTasksList(
  authorizationHeader: string | undefined,
  query: TasksListQuery,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  if (
    query.status !== undefined &&
    query.status !== 'open' &&
    query.status !== 'complete' &&
    query.status !== 'meeting'
  ) {
    return { status: 400, json: { error: '"status" must be "open", "complete", or "meeting"' } }
  }
  if (query.status === 'meeting') {
    try {
      const tasks = await getMeetingDatedTasks(resolved.admin, resolved.profileId)
      return { status: 200, json: { tasks, total: tasks.length } }
    } catch (err) {
      return ruleOrServerError(err, 'Could not load meetings')
    }
  }
  const status = query.status === 'complete' ? 'complete' : 'open'

  const categories = (query.categories ?? '').split(',').filter(Boolean)
  if (categories.some((c) => !SOURCE_CATEGORIES.includes(c as (typeof SOURCE_CATEGORIES)[number]))) {
    return { status: 400, json: { error: `"categories" must be a comma-separated list of: ${SOURCE_CATEGORIES.join(', ')}` } }
  }

  const page = status === 'complete' ? (positiveInt(query.page) ?? 1) : undefined
  const pageSize = status === 'complete' ? (positiveInt(query.pageSize) ?? DEFAULT_PAGE_SIZE) : undefined
  try {
    const { tasks, total } = await getTasksForProfile(resolved.admin, resolved.profileId, {
      status,
      projectId: query.projectId || undefined,
      assigneeId: query.assigneeId || undefined,
      categories: categories as TaskSourceCategory[],
      page,
      pageSize,
    })
    return { status: 200, json: { tasks, total, page, pageSize: pageSize && Math.min(pageSize, 100) } }
  } catch (err) {
    return ruleOrServerError(err, 'Could not load tasks')
  }
}

const MAX_NOTES_LENGTH = 10_000
const TASK_VISIBILITIES = ['private', 'public'] as const
const CADENCE_UNITS = ['day', 'week', 'month'] as const
const TASK_STATUSES = ['not_started', 'in_progress', 'complete'] as const

/**
 * Validates the Add / Edit Task form body into NewTaskFields (or the 400 to return). The two actions
 * share every rule: a title, at least one assignee, a real due date (always required), and for a
 * recurring task a positive whole-number cadence.
 */
function parseTaskFields(body: unknown): { fields: NewTaskFields } | { error: ApiResult } {
  const raw = (body ?? {}) as {
    projectId?: unknown
    title?: unknown
    description?: unknown
    notes?: unknown
    dueDate?: unknown
    assigneeIds?: unknown
    visibility?: unknown
    isRecurring?: unknown
    cadenceValue?: unknown
    cadenceUnit?: unknown
  }
  const bad = (error: string) => ({ error: { status: 400, json: { error } } as ApiResult })

  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    return bad('"title" (non-empty string) is required')
  }
  if (
    !Array.isArray(raw.assigneeIds) ||
    raw.assigneeIds.length === 0 ||
    raw.assigneeIds.some((id) => typeof id !== 'string')
  ) {
    return bad('"assigneeIds" (non-empty string array) is required')
  }
  if (raw.projectId !== undefined && raw.projectId !== null && typeof raw.projectId !== 'string') {
    return bad('"projectId" must be a string or null')
  }
  if (raw.description !== undefined && raw.description !== null && typeof raw.description !== 'string') {
    return bad('"description" must be a string or null')
  }
  if (raw.notes !== undefined && raw.notes !== null && typeof raw.notes !== 'string') {
    return bad('"notes" must be a string or null')
  }
  if (typeof raw.dueDate !== 'string' || !isRealDate(raw.dueDate)) {
    return bad('A task needs a "dueDate" (YYYY-MM-DD)')
  }
  if (
    raw.visibility !== undefined &&
    !TASK_VISIBILITIES.includes(raw.visibility as (typeof TASK_VISIBILITIES)[number])
  ) {
    return bad(`"visibility" must be one of: ${TASK_VISIBILITIES.join(', ')}`)
  }

  const isRecurring = raw.isRecurring === true
  if (
    isRecurring &&
    (typeof raw.cadenceValue !== 'number' ||
      !Number.isInteger(raw.cadenceValue) ||
      raw.cadenceValue <= 0 ||
      !CADENCE_UNITS.includes(raw.cadenceUnit as (typeof CADENCE_UNITS)[number]))
  ) {
    return bad(
      '"cadenceValue" (positive whole number) and "cadenceUnit" (day, week, or month) are required when isRecurring is true',
    )
  }

  return {
    fields: {
      projectId: (raw.projectId ?? null) as string | null,
      title: raw.title.trim(),
      description: (raw.description ?? null) as string | null,
      notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes : null,
      dueDate: raw.dueDate,
      assigneeIds: raw.assigneeIds as string[],
      visibility: (raw.visibility ?? 'private') as 'private' | 'public',
      isRecurring,
      cadenceValue: isRecurring ? (raw.cadenceValue as number) : null,
      cadenceUnit: isRecurring ? (raw.cadenceUnit as CadenceUnit) : null,
    },
  }
}

/** The 'create' action of POST /api/tasks. */
async function handleTasksCreate(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const parsed = parseTaskFields(body)
  if ('error' in parsed) return parsed.error

  try {
    const task = await createTask(resolved.admin, resolved.profileId, parsed.fields)
    return { status: 200, json: { task } }
  } catch (err) {
    return ruleOrServerError(err, 'Could not create task')
  }
}

/** The 'update' action of POST /api/tasks — body is { taskId, ...the Add Task fields }. Manual tasks only. */
async function handleTasksUpdate(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { taskId } = (body ?? {}) as { taskId?: unknown }
  if (typeof taskId !== 'string') {
    return { status: 400, json: { error: '"taskId" (string) is required' } }
  }
  const parsed = parseTaskFields(body)
  if ('error' in parsed) return parsed.error

  try {
    const task = await updateTask(resolved.admin, taskId, resolved.profileId, parsed.fields)
    return { status: 200, json: { task } }
  } catch (err) {
    return ruleOrServerError(err, 'Could not update task')
  }
}

/**
 * The 'set-status' action of POST /api/tasks — body { taskId, status }.
 * Returns the updated task, plus `next` (the new row) when completing a recurring task.
 */
async function handleTasksSetStatus(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { taskId, status } = (body ?? {}) as { taskId?: unknown; status?: unknown }
  if (typeof taskId !== 'string' || !TASK_STATUSES.includes(status as (typeof TASK_STATUSES)[number])) {
    return {
      status: 400,
      json: { error: `"taskId" (string) and "status" (${TASK_STATUSES.join(', ')}) are required` },
    }
  }

  try {
    const result = await setTaskStatus(
      resolved.admin,
      taskId,
      resolved.profileId,
      status as (typeof TASK_STATUSES)[number],
    )
    return { status: 200, json: result }
  } catch (err) {
    return ruleOrServerError(err, 'Could not update task')
  }
}

/** The 'set-notes' action of POST /api/tasks — body { taskId, notes } (blank/null clears). */
async function handleTasksSetNotes(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { taskId, notes } = (body ?? {}) as { taskId?: unknown; notes?: unknown }
  if (typeof taskId !== 'string' || (notes !== null && typeof notes !== 'string')) {
    return { status: 400, json: { error: '"taskId" (string) and "notes" (string or null) are required' } }
  }
  if (notes && notes.length > MAX_NOTES_LENGTH) {
    return { status: 400, json: { error: `Notes can be at most ${MAX_NOTES_LENGTH} characters` } }
  }

  try {
    const task = await setTaskNotes(resolved.admin, taskId, resolved.profileId, notes)
    return { status: 200, json: { task } }
  } catch (err) {
    return ruleOrServerError(err, 'Could not save notes')
  }
}

/** The 'set-meeting-date' action of POST /api/tasks — body { taskId, meetingDate } (null clears it and reopens). */
async function handleTasksSetMeetingDate(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { taskId, meetingDate } = (body ?? {}) as { taskId?: unknown; meetingDate?: unknown }
  if (typeof taskId !== 'string' || (meetingDate !== null && typeof meetingDate !== 'string')) {
    return {
      status: 400,
      json: { error: '"taskId" (string) and "meetingDate" (YYYY-MM-DD or null) are required' },
    }
  }

  try {
    const task = await setMeetingDate(resolved.admin, taskId, resolved.profileId, meetingDate)
    return { status: 200, json: { task } }
  } catch (err) {
    return ruleOrServerError(err, 'Could not save the meeting date')
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
    return ruleOrServerError(err, 'Could not delete task')
  }
}

/**
 * POST /api/tasks — action dispatch: { action: 'create' | 'update' | 'set-status' | 'set-notes' | 'set-meeting-date' | 'delete', ... }.
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
    case 'update':
      return handleTasksUpdate(authorizationHeader, body)
    case 'set-status':
      return handleTasksSetStatus(authorizationHeader, body)
    case 'set-notes':
      return handleTasksSetNotes(authorizationHeader, body)
    case 'set-meeting-date':
      return handleTasksSetMeetingDate(authorizationHeader, body)
    case 'delete':
      return handleTasksDelete(authorizationHeader, body)
    default:
      return {
        status: 400,
        json: { error: '"action" must be "create", "update", "set-status", "set-notes", "set-meeting-date", or "delete"' },
      }
  }
}
