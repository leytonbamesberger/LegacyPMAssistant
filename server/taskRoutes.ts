import { ApiResult } from './http.js'
import { resolveProfile } from './auth.js'
import {
  createTask,
  DEFAULT_PAGE_SIZE,
  deleteTask,
  getMeetingDatedTasks,
  getTasksForProfile,
  setMeetingDate,
  setTaskNotes,
  setTaskStatus,
  TaskRuleError,
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
  /** Comma-separated source categories: setup,recurring,flow. */
  categories?: string
  page?: string
  pageSize?: string
}

const SOURCE_CATEGORIES = ['setup', 'recurring', 'flow'] as const

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

/** The 'create' action of POST /api/tasks. */
async function handleTasksCreate(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

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

  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    return { status: 400, json: { error: '"title" (non-empty string) is required' } }
  }
  if (
    !Array.isArray(raw.assigneeIds) ||
    raw.assigneeIds.length === 0 ||
    raw.assigneeIds.some((id) => typeof id !== 'string')
  ) {
    return { status: 400, json: { error: '"assigneeIds" (non-empty string array) is required' } }
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
  if (raw.notes !== undefined && raw.notes !== null && typeof raw.notes !== 'string') {
    return { status: 400, json: { error: '"notes" must be a string or null' } }
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

  const isRecurring = raw.isRecurring === true
  if (isRecurring) {
    if (
      typeof raw.cadenceValue !== 'number' ||
      !Number.isInteger(raw.cadenceValue) ||
      raw.cadenceValue <= 0 ||
      !CADENCE_UNITS.includes(raw.cadenceUnit as (typeof CADENCE_UNITS)[number])
    ) {
      return {
        status: 400,
        json: {
          error: '"cadenceValue" (positive whole number) and "cadenceUnit" (day, week, or month) are required when isRecurring is true',
        },
      }
    }
    // The next cycle's due date is computed from this one, so a recurring task needs a date.
    if (typeof raw.dueDate !== 'string' || !raw.dueDate) {
      return { status: 400, json: { error: 'A recurring task needs a "dueDate"' } }
    }
  }

  try {
    const task = await createTask(resolved.admin, resolved.profileId, {
      projectId: (raw.projectId ?? null) as string | null,
      title: raw.title.trim(),
      description: (raw.description ?? null) as string | null,
      notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes : null,
      dueDate: (raw.dueDate ?? null) as string | null,
      assigneeIds: raw.assigneeIds as string[],
      visibility: (raw.visibility ?? 'private') as 'private' | 'public',
      isRecurring,
      cadenceValue: isRecurring ? (raw.cadenceValue as number) : null,
      cadenceUnit: isRecurring ? (raw.cadenceUnit as CadenceUnit) : null,
    })
    return { status: 200, json: { task } }
  } catch (err) {
    return ruleOrServerError(err, 'Could not create task')
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
 * POST /api/tasks — action dispatch: { action: 'create' | 'set-status' | 'set-notes' | 'set-meeting-date' | 'delete', ... }.
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
    case 'set-notes':
      return handleTasksSetNotes(authorizationHeader, body)
    case 'set-meeting-date':
      return handleTasksSetMeetingDate(authorizationHeader, body)
    case 'delete':
      return handleTasksDelete(authorizationHeader, body)
    default:
      return {
        status: 400,
        json: { error: '"action" must be "create", "set-status", "set-notes", "set-meeting-date", or "delete"' },
      }
  }
}
