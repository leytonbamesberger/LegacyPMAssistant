import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch } from './apiClient'
import type { CadenceUnit } from '../../shared/period'

export type { CadenceUnit }
export type TaskStatus = 'not_started' | 'in_progress' | 'complete'
export type TaskSourceCategory = 'setup' | 'recurring' | 'closeout' | 'flow'

export interface Task {
  id: string
  type: 'project' | 'person' | 'personal'
  project_id: string | null
  title: string
  description: string | null
  due_date: string | null
  due_time: string | null
  /** due_date is null because the date is "to be decided" (the 4 meeting Setup items). */
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
  /** Null for manual / person / personal tasks. */
  source_category: TaskSourceCategory | null
  /** One of the four meeting Setup items: its row shows a date input instead of a status control. */
  is_meeting: boolean
  /** Meeting tasks: the date the meeting is/was held. Entering one completes the task and puts it on the calendar. */
  meeting_date: string | null
  assignee_ids: string[]
}

/** `type` isn't sent — the server infers it (person / project / personal) from the assignees and project. */
export interface NewTaskInput {
  projectId: string | null
  title: string
  description: string | null
  notes: string | null
  /** Required (YYYY-MM-DD). */
  dueDate: string
  assigneeIds: string[]
  visibility: 'private' | 'public'
  isRecurring: boolean
  cadenceValue: number | null
  cadenceUnit: CadenceUnit | null
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  complete: 'Complete',
}

export interface TaskQuery {
  /** 'open' (default) = not started + in progress; 'complete' = the Archive. */
  /** 'meeting' = every task with a meeting date, any status (the calendar's source). */
  status?: 'open' | 'complete' | 'meeting'
  projectId?: string | null
  assigneeId?: string | null
  /** Empty/omitted = no category filter (manual tasks included). */
  categories?: TaskSourceCategory[]
  /** Archive only. */
  page?: number
  pageSize?: number
}

export interface TaskPage {
  tasks: Task[]
  /** Everything matching the filters, across all pages. */
  total: number
}

export async function fetchTasks(
  instance: IPublicClientApplication,
  account: AccountInfo,
  query: TaskQuery = {},
): Promise<TaskPage | null> {
  const params = new URLSearchParams()
  params.set('status', query.status ?? 'open')
  if (query.projectId) params.set('projectId', query.projectId)
  if (query.assigneeId) params.set('assigneeId', query.assigneeId)
  if (query.categories?.length) params.set('categories', query.categories.join(','))
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))
  const body = await apiFetch<TaskPage>(instance, account, `/api/tasks?${params}`)
  return body ? { tasks: body.tasks, total: body.total } : null
}

function postTaskAction<T>(
  instance: IPublicClientApplication,
  account: AccountInfo,
  body: Record<string, unknown>,
): Promise<T | null> {
  return apiFetch<T>(instance, account, '/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function createTask(
  instance: IPublicClientApplication,
  account: AccountInfo,
  fields: NewTaskInput,
): Promise<Task | null> {
  const body = await postTaskAction<{ task: Task }>(instance, account, { action: 'create', ...fields })
  return body?.task ?? null
}

/** Edits a manual task in place with the Add Task form's fields. Null when the server refused or failed. */
export async function updateTask(
  instance: IPublicClientApplication,
  account: AccountInfo,
  taskId: string,
  fields: NewTaskInput,
): Promise<Task | null> {
  const body = await postTaskAction<{ task: Task }>(instance, account, { action: 'update', taskId, ...fields })
  return body?.task ?? null
}

/**
 * Sets the task's shared status. Completing a recurring task also creates the
 * next cycle's row, returned as `next`. Flow tasks are rejected (their status
 * mirrors the flow report) — null comes back like any other failure.
 */
export function setTaskStatus(
  instance: IPublicClientApplication,
  account: AccountInfo,
  taskId: string,
  status: TaskStatus,
): Promise<{ task: Task; next: Task | null } | null> {
  return postTaskAction(instance, account, { action: 'set-status', taskId, status })
}

/**
 * Sets a meeting task's date: a date completes it, null clears it and reopens it. Any real date is
 * accepted, including past ones. Returns the updated task, or null on failure.
 */
export async function setMeetingDate(
  instance: IPublicClientApplication,
  account: AccountInfo,
  taskId: string,
  meetingDate: string | null,
): Promise<Task | null> {
  const body = await postTaskAction<{ task: Task }>(instance, account, {
    action: 'set-meeting-date',
    taskId,
    meetingDate,
  })
  return body?.task ?? null
}

/** Saves a task's notes (blank clears them). Allowed on every task the caller can see, generated ones included. */
export async function setTaskNotes(
  instance: IPublicClientApplication,
  account: AccountInfo,
  taskId: string,
  notes: string | null,
): Promise<Task | null> {
  const body = await postTaskAction<{ task: Task }>(instance, account, { action: 'set-notes', taskId, notes })
  return body?.task ?? null
}

export async function deleteTask(
  instance: IPublicClientApplication,
  account: AccountInfo,
  taskId: string,
): Promise<boolean> {
  const body = await postTaskAction(instance, account, { action: 'delete', taskId })
  return body !== null
}
