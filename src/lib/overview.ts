import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch } from './apiClient'
import type { FlowBudgetChecklist } from '../../shared/flowBudget'
import type { OverviewView } from '../../shared/overviewView'

export interface OverviewColumn {
  id: string
  name: string
  phase: 'setup' | 'recurring' | 'closeout'
}

export interface OverviewRow {
  project_id: string
  /** The project's PM right now (rows are grouped under it). */
  pm_id: string | null
  /** False: show the merged "Initiate this project" cell instead of checklist cells (FLOW values are still real). */
  initiated: boolean
  /** checklist_item_ids that show a check. */
  done: string[]
  /** checklist_item_ids that don't apply to this project (shown as a disabled box; for closeout: it has no task for the item). Everything else applies, not done. */
  na: string[]
  /** Current period's flow report: submitted, and its four budget boxes. */
  flow: { report: boolean } & FlowBudgetChecklist
}

export interface OverviewData {
  /** The saved "Choose a View" selection. */
  view: OverviewView
  columns: OverviewColumn[]
  /** One per project in the view (Added, the picked PMs' projects, individual picks), initiated or not. */
  rows: OverviewRow[]
}

export function fetchOverview(
  instance: IPublicClientApplication,
  account: AccountInfo,
): Promise<OverviewData | null> {
  return apiFetch<OverviewData>(instance, account, '/api/projects?overview=1')
}

/** Saves the "Choose a View" selection (never touches the user's Added projects). Returns the stored view, or null on failure. */
export async function saveOverviewView(
  instance: IPublicClientApplication,
  account: AccountInfo,
  view: OverviewView,
): Promise<OverviewView | null> {
  const body = await apiFetch<{ view: OverviewView }>(instance, account, '/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'overview-view', view }),
  })
  return body?.view ?? null
}
