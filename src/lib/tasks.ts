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
}

export interface NewTaskInput {
  type: 'project' | 'person' | 'personal'
  projectId: string | null
  title: string
  description: string | null
  dueDate: string | null
  assignedTo: string
  visibility: 'private' | 'public'
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

export async function setTaskStatus(
  instance: IPublicClientApplication,
  account: AccountInfo,
  taskId: string,
  status: 'open' | 'done',
): Promise<boolean> {
  const body = await postTaskAction(instance, account, { action: 'set-status', taskId, status })
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
