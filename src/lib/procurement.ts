import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch } from './apiClient'
import type { NavigateFunction } from 'react-router-dom'
import { addDaysISO } from './dates'
import type { Task } from './tasks'
import type { OverviewView } from '../../shared/overviewView'

export type LeadTimeUnit = 'days' | 'weeks'

export interface ProcurementItem {
  id: string
  project_id: string
  spec_number: string | null
  description: string
  tag: string | null
  submitted_date: string | null
  approved_date: string | null
  ordered_date: string | null
  delivered_date: string | null
  required_on_site: string | null
  lead_time_value: number | null
  lead_time_unit: LeadTimeUnit
  vendor: string | null
  vendor_rep: string | null
  delivery_location: string | null
  po_number: string | null
  notes: string | null
  sort_order: number
  created_at: string
}

/** The stored, editable fields of an item (everything a cell can change). */
export type ProcurementItemFields = Partial<
  Omit<ProcurementItem, 'id' | 'project_id' | 'created_at' | 'sort_order'>
>

/** One row of an import: a Description plus whichever fields the sheet had. */
export type ImportItemInput = Pick<ProcurementItem, 'description'> & ProcurementItemFields

export interface LinkedTask {
  id: string
  title: string
  due_date: string | null
  assignee_ids: string[]
}

export interface ProcurementData {
  view: OverviewView
  collapsed: string[]
  projectIds: string[]
  items: ProcurementItem[]
  taskLinks: Record<string, LinkedTask[]>
}

/** Router state a task's procurement chip passes to the Procurement tab: the item to scroll to and highlight. */
export interface ProcurementJumpState {
  procurementItemId: string
  procurementProjectId: string
}

/** The chip on a Tasks / Archive row: open the Procurement tab on the task's item. */
export function openProcurementItem(navigate: NavigateFunction, task: Task): void {
  if (!task.procurement_item_id || !task.procurement_item) return
  const state: ProcurementJumpState = {
    procurementItemId: task.procurement_item_id,
    procurementProjectId: task.procurement_item.project_id,
  }
  navigate('/organization/procurement', { state })
}

// ---------------------------------------------------------------------------------------------
// Computed values — never stored
// ---------------------------------------------------------------------------------------------

export type ProcurementStatus = 'Not Submitted' | 'Submitted' | 'Approved' | 'Ordered' | 'Delivered'

export const PROCUREMENT_STATUSES: ProcurementStatus[] = ['Not Submitted', 'Submitted', 'Approved', 'Ordered', 'Delivered']

export function itemStatus(item: ProcurementItem): ProcurementStatus {
  if (item.delivered_date) return 'Delivered'
  if (item.ordered_date) return 'Ordered'
  if (item.approved_date) return 'Approved'
  if (item.submitted_date) return 'Submitted'
  return 'Not Submitted'
}

/** Ordered date + lead time (weeks x 7), or null when either is missing. */
export function estDelivery(item: ProcurementItem): string | null {
  if (!item.ordered_date || item.lead_time_value === null) return null
  const days = item.lead_time_unit === 'weeks' ? item.lead_time_value * 7 : item.lead_time_value
  return addDaysISO(item.ordered_date, days)
}

/**
 * Why an undelivered item needs attention (empty = it doesn't): the estimate or the required-on-site
 * date has passed, or the estimate lands after the required-on-site date. `today` is the browser's local date.
 */
export function attentionReasons(item: ProcurementItem, today: string): string[] {
  if (item.delivered_date) return []
  const est = estDelivery(item)
  const reasons: string[] = []
  if (est && est < today) reasons.push('Estimated delivery has passed')
  if (item.required_on_site && item.required_on_site < today) reasons.push('Required on-site date has passed')
  if (est && item.required_on_site && est > item.required_on_site) reasons.push('Estimated delivery is after the required on-site date')
  return reasons
}

export const needsAttention = (item: ProcurementItem, today: string) => attentionReasons(item, today).length > 0

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------

export function fetchProcurement(
  instance: IPublicClientApplication,
  account: AccountInfo,
): Promise<ProcurementData | null> {
  return apiFetch<ProcurementData>(instance, account, '/api/projects?procurement=1')
}

function post<T>(
  instance: IPublicClientApplication,
  account: AccountInfo,
  body: Record<string, unknown>,
): Promise<T | null> {
  return apiFetch<T>(instance, account, '/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function saveProcurementView(
  instance: IPublicClientApplication,
  account: AccountInfo,
  view: OverviewView,
): Promise<OverviewView | null> {
  const body = await post<{ view: OverviewView }>(instance, account, { action: 'procurement-view', view })
  return body?.view ?? null
}

export async function saveProcurementCollapsed(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectIds: string[],
): Promise<boolean> {
  return (await post(instance, account, { action: 'procurement-collapsed', projectIds })) !== null
}

export async function createProcurementItem(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  description: string,
): Promise<ProcurementItem | null> {
  const body = await post<{ item: ProcurementItem }>(instance, account, {
    action: 'procurement-create',
    projectId,
    description,
  })
  return body?.item ?? null
}

/** One project's current items (it may not be in the user's view) — for the import's duplicate check. Null on failure. */
export async function fetchProjectProcurementItems(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
): Promise<ProcurementItem[] | null> {
  const body = await apiFetch<{ items: ProcurementItem[] }>(
    instance,
    account,
    `/api/projects?procurementItemsFor=${encodeURIComponent(projectId)}`,
  )
  return body?.items ?? null
}

/** Adds many items to a project at once (an Excel import the user confirmed). Null when nothing was saved. */
export async function importProcurementItems(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  items: ImportItemInput[],
): Promise<ProcurementItem[] | null> {
  const body = await post<{ items: ProcurementItem[] }>(instance, account, {
    action: 'procurement-import',
    projectId,
    items,
  })
  return body?.items ?? null
}

/** Saves the changed fields of one item; returns the stored row, or null when the save failed. */
export async function updateProcurementItem(
  instance: IPublicClientApplication,
  account: AccountInfo,
  itemId: string,
  fields: ProcurementItemFields,
): Promise<ProcurementItem | null> {
  const body = await post<{ item: ProcurementItem }>(instance, account, { action: 'procurement-update', itemId, fields })
  return body?.item ?? null
}

export async function deleteProcurementItem(
  instance: IPublicClientApplication,
  account: AccountInfo,
  itemId: string,
): Promise<boolean> {
  return (await post(instance, account, { action: 'procurement-delete', itemId })) !== null
}
