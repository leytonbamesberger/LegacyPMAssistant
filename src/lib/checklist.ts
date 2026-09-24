import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch } from './apiClient'

export interface ChecklistItem {
  id: string
  phase: 'setup' | 'weekly' | 'closeout'
  name: string
  sort_order: number
  cadence_days: number | null
}

export interface ChecklistItemStatus {
  item: ChecklistItem
  completedAt: string | null
  completedBy: string | null
  done: boolean
  stale: boolean
  daysUntilDue: number | null
}

export interface ProjectChecklistStatus {
  projectId: string
  setup: ChecklistItemStatus[]
  weekly: ChecklistItemStatus[]
  closeout: ChecklistItemStatus[]
}

export async function fetchChecklistStatus(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectIds: string[],
): Promise<ProjectChecklistStatus[] | null> {
  if (projectIds.length === 0) return []
  const body = await apiFetch<{ statuses: ProjectChecklistStatus[] }>(
    instance,
    account,
    `/api/checklist?projectIds=${projectIds.map(encodeURIComponent).join(',')}`,
  )
  return body?.statuses ?? null
}

function postChecklistAction(
  instance: IPublicClientApplication,
  account: AccountInfo,
  body: Record<string, unknown>,
): Promise<unknown | null> {
  return apiFetch(instance, account, '/api/checklist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Setup/closeout items only — checking marks done, unchecking removes the log row(s). */
export async function setChecklistItemDone(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  checklistItemId: string,
  done: boolean,
): Promise<boolean> {
  const result = await postChecklistAction(instance, account, {
    action: 'toggle',
    projectId,
    checklistItemId,
    done,
  })
  return result !== null
}

/** Weekly items only — always inserts a new completion row (no undo). */
export async function logWeeklyChecklistItem(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  checklistItemId: string,
): Promise<boolean> {
  const result = await postChecklistAction(instance, account, {
    action: 'log',
    projectId,
    checklistItemId,
  })
  return result !== null
}
