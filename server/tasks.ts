import { SupabaseClient } from '@supabase/supabase-js'
import { addCadence, type CadenceUnit } from '../shared/period.js'
import { selectAll } from './selectAll.js'

export type TaskStatus = 'not_started' | 'in_progress' | 'complete'
/** 'flow' is kept only so the list filter still accepts it; flow reports are no longer task rows. */
export type TaskSourceCategory = 'setup' | 'recurring' | 'flow'

export interface TaskRecord {
  id: string
  type: 'project' | 'person' | 'personal'
  project_id: string | null
  title: string
  description: string | null
  due_date: string | null
  due_time: string | null
  is_tbd: boolean
  status: TaskStatus
  notes: string | null
  assigned_by: string | null
  visibility: 'private' | 'public'
  created_at: string
  completed_at: string | null
  is_recurring: boolean
  cadence_value: number | null
  cadence_unit: CadenceUnit | null
  checklist_item_id: string | null
  source_category: TaskSourceCategory | null
  /**
   * Meeting tasks only: the date the meeting is (or was) held. Entering one completes the task; it is
   * what the calendar shows, while due_date stays the project's "Setup complete by" date.
   */
  meeting_date: string | null
  /**
   * This task is one of the four meeting Setup items (checklist_items.is_meeting). Set on listings by
   * withMeetingFlags — the Tasks page keeps meetings out of the Setup bundle.
   */
  is_meeting: boolean
  assignee_ids: string[]
}

/** Fields for inserting any task row — user-created or generated (initiation / recurrence). */
export interface InsertTaskInput {
  type: TaskRecord['type']
  projectId: string | null
  title: string
  description?: string | null
  dueDate: string | null
  dueTime?: string | null
  isTbd?: boolean
  status?: TaskStatus
  notes?: string | null
  assignedBy: string | null
  assigneeIds: string[]
  visibility?: 'private' | 'public'
  isRecurring?: boolean
  cadenceValue?: number | null
  cadenceUnit?: CadenceUnit | null
  checklistItemId?: string | null
  sourceCategory?: TaskSourceCategory | null
  meetingDate?: string | null
}

/** A business-rule rejection (not a server fault) — routes map this to a 4xx. */
export class TaskRuleError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message)
  }
}

const TASK_SELECT = '*, task_assignees(user_id)'
const ID_CHUNK = 100

type TaskRow = Omit<TaskRecord, 'assignee_ids' | 'is_meeting'> & { task_assignees: { user_id: string }[] }

function toRecord(row: TaskRow): TaskRecord {
  const { task_assignees, ...rest } = row
  return { ...rest, is_meeting: false, assignee_ids: (task_assignees ?? []).map((a) => a.user_id) }
}

/** Marks tasks generated from a meeting checklist item. One small query (the flag is set on a handful of catalog rows). */
export async function withMeetingFlags(admin: SupabaseClient, tasks: TaskRecord[]): Promise<TaskRecord[]> {
  if (!tasks.some((t) => t.checklist_item_id)) return tasks
  const { data, error } = await admin.from('checklist_items').select('id').eq('is_meeting', true)
  if (error) throw new Error(error.message)
  const meetingIds = new Set((data ?? []).map((r) => r.id as string))
  return tasks.map((t) => ({ ...t, is_meeting: !!t.checklist_item_id && meetingIds.has(t.checklist_item_id) }))
}

function compareByDueDate(a: TaskRecord, b: TaskRecord): number {
  if (!a.due_date && !b.due_date) return 0
  if (!a.due_date) return 1
  if (!b.due_date) return -1
  return a.due_date.localeCompare(b.due_date)
}

export interface TaskListOptions {
  /** 'open' = not_started + in_progress (the Tasks page); 'complete' = the Archive. */
  status: 'open' | 'complete'
  projectId?: string
  /** Only tasks this profile is one of the assignees of. */
  assigneeId?: string
  /** Only these source categories. Omitted/empty = no category filter (manual tasks included). */
  categories?: TaskSourceCategory[]
  /** 1-based. Omit to return every match (the Tasks page); the Archive pages. */
  page?: number
  pageSize?: number
}

export const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

function sortOpen(a: TaskRecord, b: TaskRecord): number {
  return compareByDueDate(a, b) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
}

/** Runs `fn` over `ids` in URL-safe chunks, a few at a time. */
async function inChunks<T>(ids: string[], fn: (chunk: string[]) => PromiseLike<T[]>): Promise<T[]> {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK))
  const out: T[] = []
  for (let i = 0; i < chunks.length; i += 5) {
    const results = await Promise.all(chunks.slice(i, i + 5).map(fn))
    for (const rows of results) out.push(...rows)
  }
  return out
}

/**
 * Tasks visible to a caller: assigned to them (via task_assignees), or
 * assigned by them. See the per-row visibility note on `tasks` in
 * supabase/schema.sql — there is no Postgres RLS backstop here, this function
 * IS the access boundary.
 *
 * Open tasks are bounded (a recurring item only ever has one open row), so the
 * whole company's open set is read and narrowed in memory. Completed tasks
 * grow forever, so those go through id lists, are sorted on light columns, and
 * only the requested page's full rows are fetched.
 */
export async function getTasksForProfile(
  admin: SupabaseClient,
  profileId: string,
  options: TaskListOptions,
): Promise<{ tasks: TaskRecord[]; total: number }> {
  return options.status === 'open'
    ? listOpenTasks(admin, profileId, options)
    : listCompletedTasks(admin, profileId, options)
}

async function listOpenTasks(
  admin: SupabaseClient,
  profileId: string,
  { projectId, assigneeId, categories }: TaskListOptions,
): Promise<{ tasks: TaskRecord[]; total: number }> {
  const rows = await selectAll<TaskRow>(() => {
    let query = admin.from('tasks').select(TASK_SELECT).neq('status', 'complete')
    if (projectId) query = query.eq('project_id', projectId)
    if (categories?.length) query = query.in('source_category', categories)
    return query.order('id') as never
  })

  const tasks = rows
    .map(toRecord)
    .filter((t) => t.assigned_by === profileId || t.assignee_ids.includes(profileId))
    .filter((t) => !assigneeId || t.assignee_ids.includes(assigneeId))
    .sort(sortOpen)
  return { tasks: await withMeetingFlags(admin, tasks), total: tasks.length }
}

async function listCompletedTasks(
  admin: SupabaseClient,
  profileId: string,
  { projectId, assigneeId, categories, page = 1, pageSize = DEFAULT_PAGE_SIZE }: TaskListOptions,
): Promise<{ tasks: TaskRecord[]; total: number }> {
  type Light = { id: string; completed_at: string | null }
  const cats = categories?.length ? categories : null

  const mine = await selectAll<{ task_id: string }>(
    () => admin.from('task_assignees').select('task_id').eq('user_id', profileId).order('task_id') as never,
  )
  const [assignedToMe, assignedByMe] = await Promise.all([
    inChunks(
      mine.map((r) => r.task_id),
      async (chunk) => {
        let query = admin.from('tasks').select('id, completed_at').eq('status', 'complete').in('id', chunk)
        if (projectId) query = query.eq('project_id', projectId)
        if (cats) query = query.in('source_category', cats)
        const { data, error } = await query
        if (error) throw new Error(error.message)
        return (data ?? []) as Light[]
      },
    ),
    selectAll<Light>(() => {
      let query = admin
        .from('tasks')
        .select('id, completed_at')
        .eq('status', 'complete')
        .eq('assigned_by', profileId)
      if (projectId) query = query.eq('project_id', projectId)
      if (cats) query = query.in('source_category', cats)
      return query.order('id') as never
    }),
  ])

  const byId = new Map<string, Light>()
  for (const row of [...assignedToMe, ...assignedByMe]) byId.set(row.id, row)
  let candidates = [...byId.values()]

  if (assigneeId) {
    const hits = await inChunks(
      candidates.map((c) => c.id),
      async (chunk) => {
        const { data, error } = await admin
          .from('task_assignees')
          .select('task_id')
          .eq('user_id', assigneeId)
          .in('task_id', chunk)
        if (error) throw new Error(error.message)
        return (data ?? []) as { task_id: string }[]
      },
    )
    const keep = new Set(hits.map((h) => h.task_id))
    candidates = candidates.filter((c) => keep.has(c.id))
  }

  // Most recently completed first; rows with no completion time sink to the end.
  candidates.sort(
    (a, b) =>
      (b.completed_at ?? '').localeCompare(a.completed_at ?? '') || a.id.localeCompare(b.id),
  )

  const size = Math.min(Math.max(1, Math.floor(pageSize)), MAX_PAGE_SIZE)
  const start = (Math.max(1, Math.floor(page)) - 1) * size
  const pageIds = candidates.slice(start, start + size).map((c) => c.id)

  const full = await inChunks(pageIds, async (chunk) => {
    const { data, error } = await admin.from('tasks').select(TASK_SELECT).in('id', chunk)
    if (error) throw new Error(error.message)
    return ((data ?? []) as unknown as TaskRow[]).map(toRecord)
  })
  const order = new Map(pageIds.map((id, i) => [id, i]))
  full.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  return { tasks: await withMeetingFlags(admin, full), total: candidates.length }
}

/**
 * Every task visible to the caller that has a meeting date (any status) — what the calendar
 * shows for meetings. Small (a handful per project), so not paginated.
 */
export async function getMeetingDatedTasks(admin: SupabaseClient, profileId: string): Promise<TaskRecord[]> {
  const mine = await selectAll<{ task_id: string }>(
    () => admin.from('task_assignees').select('task_id').eq('user_id', profileId).order('task_id') as never,
  )
  const [assignedToMe, assignedByMe] = await Promise.all([
    inChunks(
      mine.map((r) => r.task_id),
      async (chunk) => {
        const { data, error } = await admin
          .from('tasks')
          .select('id')
          .not('meeting_date', 'is', null)
          .in('id', chunk)
        if (error) throw new Error(error.message)
        return (data ?? []) as { id: string }[]
      },
    ),
    selectAll<{ id: string }>(
      () =>
        admin
          .from('tasks')
          .select('id')
          .not('meeting_date', 'is', null)
          .eq('assigned_by', profileId)
          .order('id') as never,
    ),
  ])
  const ids = [...new Set([...assignedToMe, ...assignedByMe].map((r) => r.id))]
  const rows = await inChunks(ids, async (chunk) => {
    const { data, error } = await admin.from('tasks').select(TASK_SELECT).in('id', chunk)
    if (error) throw new Error(error.message)
    return ((data ?? []) as unknown as TaskRow[]).map(toRecord)
  })
  return withMeetingFlags(admin, rows)
}

function toInsertRow(input: InsertTaskInput) {
  return {
    type: input.type,
    project_id: input.projectId,
    title: input.title,
    description: input.description ?? null,
    due_date: input.dueDate,
    due_time: input.dueTime ?? null,
    is_tbd: input.isTbd ?? false,
    status: input.status ?? 'not_started',
    completed_at: input.status === 'complete' ? new Date().toISOString() : null,
    notes: input.notes ?? null,
    assigned_by: input.assignedBy,
    visibility: input.visibility ?? 'private',
    is_recurring: input.isRecurring ?? false,
    cadence_value: input.isRecurring ? (input.cadenceValue ?? null) : null,
    cadence_unit: input.isRecurring ? (input.cadenceUnit ?? null) : null,
    checklist_item_id: input.checklistItemId ?? null,
    source_category: input.sourceCategory ?? null,
    meeting_date: input.meetingDate ?? null,
  }
}

/**
 * The one place task rows (+ their assignees) are written — user-created and
 * generated alike, in two queries regardless of how many rows (initiation
 * writes a couple dozen at once).
 */
export async function insertTasks(admin: SupabaseClient, inputs: InsertTaskInput[]): Promise<TaskRecord[]> {
  if (inputs.length === 0) return []

  const { data, error } = await admin.from('tasks').insert(inputs.map(toInsertRow)).select()
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Omit<TaskRecord, 'assignee_ids' | 'is_meeting'>[]

  const assigneeRows = rows.flatMap((row, i) =>
    [...new Set(inputs[i].assigneeIds)].map((user_id) => ({ task_id: row.id, user_id })),
  )
  if (assigneeRows.length > 0) {
    const { error: assigneeError } = await admin.from('task_assignees').insert(assigneeRows)
    if (assigneeError) {
      // Don't leave assignee-less orphan rows behind.
      await admin.from('tasks').delete().in('id', rows.map((r) => r.id))
      throw new Error(assigneeError.message)
    }
  }
  return rows.map((row, i) => ({ ...row, is_meeting: false, assignee_ids: [...new Set(inputs[i].assigneeIds)] }))
}

export async function insertTask(admin: SupabaseClient, input: InsertTaskInput): Promise<TaskRecord> {
  const [task] = await insertTasks(admin, [input])
  return task
}

export interface NewTaskFields {
  projectId: string | null
  title: string
  description: string | null
  notes: string | null
  dueDate: string | null
  assigneeIds: string[]
  visibility: 'private' | 'public'
  isRecurring: boolean
  cadenceValue: number | null
  cadenceUnit: CadenceUnit | null
}

/**
 * `tasks.type` isn't asked for — it follows from who and what the task is for:
 * anyone besides the creator assigned -> person; else a project attached ->
 * project; else personal.
 */
export function inferTaskType(
  creatorProfileId: string,
  assigneeIds: string[],
  projectId: string | null,
): TaskRecord['type'] {
  if (assigneeIds.some((id) => id !== creatorProfileId)) return 'person'
  return projectId ? 'project' : 'personal'
}

export function createTask(
  admin: SupabaseClient,
  creatorProfileId: string,
  fields: NewTaskFields,
): Promise<TaskRecord> {
  return insertTask(admin, {
    ...fields,
    type: inferTaskType(creatorProfileId, fields.assigneeIds, fields.projectId),
    assignedBy: creatorProfileId,
  })
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/**
 * A meeting task is finished by entering the date it happens: that sets meeting_date and completes
 * the task. Clearing the date (null) reopens it. Any real date is accepted, including past ones.
 * due_date is left alone — it stays the project's "Setup complete by" date.
 */
export async function setMeetingDate(
  admin: SupabaseClient,
  taskId: string,
  callerProfileId: string,
  meetingDate: string | null,
): Promise<TaskRecord> {
  const found = await getTaskIfAccessible(admin, taskId, callerProfileId)
  const [task] = await withMeetingFlags(admin, [found])
  if (!task.is_meeting) throw new TaskRuleError('Only meeting tasks have a meeting date')
  if (meetingDate !== null && !isRealDate(meetingDate)) {
    throw new TaskRuleError('"meetingDate" must be a real date (YYYY-MM-DD) or null')
  }

  const fields =
    meetingDate !== null
      ? {
          meeting_date: meetingDate,
          status: 'complete' as const,
          completed_at: task.completed_at ?? new Date().toISOString(),
        }
      : { meeting_date: null, status: 'not_started' as const, completed_at: null }
  const { error } = await admin.from('tasks').update(fields).eq('id', taskId)
  if (error) throw new Error(error.message)
  return { ...task, ...fields }
}

/** Notes are editable on every task the caller can see — manual, generated, completed. Blank clears them. */
export async function setTaskNotes(
  admin: SupabaseClient,
  taskId: string,
  callerProfileId: string,
  notes: string | null,
): Promise<TaskRecord> {
  const task = await getTaskIfAccessible(admin, taskId, callerProfileId)
  const cleaned = notes && notes.trim() ? notes : null
  const { error } = await admin.from('tasks').update({ notes: cleaned }).eq('id', taskId)
  if (error) throw new Error(error.message)
  return { ...task, notes: cleaned }
}

async function getTaskIfAccessible(
  admin: SupabaseClient,
  taskId: string,
  callerProfileId: string,
): Promise<TaskRecord> {
  const { data, error } = await admin.from('tasks').select(TASK_SELECT).eq('id', taskId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new TaskRuleError('Task not found', 404)
  const task = toRecord(data as unknown as TaskRow)
  if (task.assigned_by !== callerProfileId && !task.assignee_ids.includes(callerProfileId)) {
    throw new TaskRuleError('Task not found', 404)
  }
  return task
}

/**
 * Next cycle of a recurring task: a NEW row (never an update of the same one),
 * due = old due + cadence — not completion date + cadence, so the schedule
 * doesn't drift. Copies everything except notes and status (the new row starts
 * not_started with empty notes).
 */
async function spawnNextRecurrence(admin: SupabaseClient, task: TaskRecord): Promise<TaskRecord | null> {
  if (!task.cadence_value || !task.cadence_unit) return null
  const base = task.due_date ?? new Date().toISOString().slice(0, 10)
  return insertTask(admin, {
    type: task.type,
    projectId: task.project_id,
    title: task.title,
    description: task.description,
    dueDate: addCadence(base, task.cadence_value, task.cadence_unit),
    dueTime: task.due_time,
    assignedBy: task.assigned_by,
    assigneeIds: task.assignee_ids,
    visibility: task.visibility,
    isRecurring: true,
    cadenceValue: task.cadence_value,
    cadenceUnit: task.cadence_unit,
    checklistItemId: task.checklist_item_id,
    sourceCategory: task.source_category,
  })
}

/**
 * Any assignee (or the assigner) may change the shared status. Completing a
 * recurring task also creates the next cycle's row (returned as `next`); a
 * completed recurring task can't be reopened once that successor exists.
 */
export async function setTaskStatus(
  admin: SupabaseClient,
  taskId: string,
  callerProfileId: string,
  status: TaskStatus,
): Promise<{ task: TaskRecord; next: TaskRecord | null }> {
  const task = await getTaskIfAccessible(admin, taskId, callerProfileId)

  if (task.status === status) return { task, next: null }
  if (task.is_recurring && task.status === 'complete') {
    throw new TaskRuleError("A completed recurring task can't be reopened — its next cycle already exists")
  }

  const completedAt = status === 'complete' ? new Date().toISOString() : null

  // Conditional on the stored status, so a double-click (or two assignees
  // completing at once) can only create one next-cycle row.
  const { data: updated, error } = await admin
    .from('tasks')
    .update({ status, completed_at: completedAt })
    .eq('id', taskId)
    .eq('status', task.status)
    .select('id')
  if (error) throw new Error(error.message)

  const updatedTask: TaskRecord = { ...task, status, completed_at: completedAt }
  if ((updated ?? []).length === 0) return { task: updatedTask, next: null }

  const next = status === 'complete' && task.is_recurring ? await spawnNextRecurrence(admin, updatedTask) : null
  return { task: updatedTask, next }
}

/** Initiation-generated tasks are managed by those flows, so they aren't deletable by hand. */
export async function deleteTask(
  admin: SupabaseClient,
  taskId: string,
  callerProfileId: string,
): Promise<void> {
  const task = await getTaskIfAccessible(admin, taskId, callerProfileId)
  if (task.source_category) {
    throw new TaskRuleError('Checklist tasks are managed by the project and can’t be deleted')
  }
  const { error } = await admin.from('tasks').delete().eq('id', taskId)
  if (error) throw new Error(error.message)
}
