import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch } from './apiClient'

export interface ChecklistItem {
  id: string
  phase: 'setup' | 'recurring' | 'closeout'
  name: string
  sort_order: number
  cadence_days: number | null
  cadence_type: 'rolling' | 'calendar_month' | null
  project_id: string | null
}

export interface ChecklistItemStatus {
  item: ChecklistItem
  completedAt: string | null
  completedBy: string | null
  done: boolean
  stale: boolean
  daysUntilDue: number | null
  due: boolean
  isCustom: boolean
  scheduledDate: string | null
}

export interface ProjectChecklistStatus {
  projectId: string
  setup: ChecklistItemStatus[]
  recurring: ChecklistItemStatus[]
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

/** Recurring items only — always inserts a new completion row (no undo). */
export async function logChecklistItem(
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

/** Adds a project-specific recurring item (not shared with other projects). */
export async function addCustomChecklistItem(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  name: string,
  cadenceType: 'rolling' | 'calendar_month',
  cadenceDays: number | null,
): Promise<boolean> {
  const result = await postChecklistAction(instance, account, {
    action: 'add-custom',
    projectId,
    name,
    cadenceType,
    cadenceDays,
  })
  return result !== null
}

/** Excludes a shared default item from this project, or deletes this project's own custom item. */
export async function removeChecklistItem(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  checklistItemId: string,
): Promise<boolean> {
  const result = await postChecklistAction(instance, account, {
    action: 'remove',
    projectId,
    checklistItemId,
  })
  return result !== null
}

/** Setup items only — setting a date immediately completes the item as of that date. */
export async function setSetupItemDate(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  checklistItemId: string,
  date: string,
): Promise<boolean> {
  const result = await postChecklistAction(instance, account, {
    action: 'set-setup-date',
    projectId,
    checklistItemId,
    date,
  })
  return result !== null
}

/** Recurring items only — a schedule marker, doesn't complete the item. `date: null` clears it. */
export async function setChecklistItemSchedule(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  checklistItemId: string,
  date: string | null,
): Promise<boolean> {
  const result = await postChecklistAction(instance, account, {
    action: 'set-schedule',
    projectId,
    checklistItemId,
    date,
  })
  return result !== null
}
