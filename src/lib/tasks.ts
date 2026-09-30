import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch } from './apiClient'

export interface Task {
  id: string
  type: 'project' | 'person' | 'personal'
  project_id: string | null
  title: string
  description: string | null
  due_date: string | null
  status: 'open' | 'done'
  assigned_to: string
  assigned_by: string | null
  visibility: 'private' | 'public'
  created_at: string
  completed_at: string | null
  is_recurring: boolean
  cadence_days: number | null
  last_completed_at: string | null
}

export interface NewTaskInput {
  type: 'project' | 'person' | 'personal'
  projectId: string | null
  title: string
  description: string | null
  dueDate: string | null
  assignedTo: string
  visibility: 'private' | 'public'
  isRecurring: boolean
  cadenceDays: number | null
}

/** A recurring task's due/overdue state is derived, never persisted in `status`. */
export function isRecurringTaskDue(task: Task): boolean {
  if (!task.is_recurring || task.cadence_days === null) return false
  if (!task.last_completed_at) return true
  const dueAt = new Date(task.last_completed_at).getTime() + task.cadence_days * 24 * 60 * 60 * 1000
  return Date.now() >= dueAt
}

export async function fetchTasks(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId?: string,
): Promise<Task[] | null> {
  const path = projectId ? `/api/tasks?projectId=${encodeURIComponent(projectId)}` : '/api/tasks'
  const body = await apiFetch<{ tasks: Task[] }>(instance, account, path)
  return body?.tasks ?? null
}

function postTaskAction(
  instance: IPublicClientApplication,
  account: AccountInfo,
  body: Record<string, unknown>,
): Promise<unknown | null> {
  return apiFetch(instance, account, '/api/tasks', {
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
  const body = await postTaskAction(instance, account, { action: 'create', ...fields })
  return (body as { task: Task } | null)?.task ?? null
}

/** Non-recurring tasks only — flips `status`. Use completeRecurringTask for recurring ones. */
export async function setTaskStatus(
  instance: IPublicClientApplication,
  account: AccountInfo,
  taskId: string,
  status: 'open' | 'done',
): Promise<boolean> {
  const body = await postTaskAction(instance, account, { action: 'set-status', taskId, status })
  return body !== null
}

/** Recurring tasks only — bumps last_completed_at, leaves status untouched (never reaches 'done'). */
export async function completeRecurringTask(
  instance: IPublicClientApplication,
  account: AccountInfo,
  taskId: string,
): Promise<boolean> {
  const body = await postTaskAction(instance, account, { action: 'complete-recurring', taskId })
  return body !== null
}

export async function deleteTask(
  instance: IPublicClientApplication,
  account: AccountInfo,
  taskId: string,
): Promise<boolean> {
  const body = await postTaskAction(instance, account, { action: 'delete', taskId })
  return body !== null
}
