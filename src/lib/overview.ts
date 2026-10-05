import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch } from './apiClient'
import type { FlowBudgetChecklist } from '../../shared/flowBudget'

export interface OverviewColumn {
  id: string
  name: string
  phase: 'setup' | 'recurring'
}

export interface OverviewRow {
  project_id: string
  /** False: show the merged "Initiate this project" cell instead of checklist cells (FLOW values are still real). */
  initiated: boolean
  /** checklist_item_ids that show a check. */
  done: string[]
  /** checklist_item_ids that don't apply to this project (shown as a disabled box). Everything else applies, not done. */
  na: string[]
  /** Current period's flow report: submitted, and its four budget boxes. */
  flow: { report: boolean } & FlowBudgetChecklist
}

export interface OverviewData {
  columns: OverviewColumn[]
  /** Everything picked for Overview, initiated or not (uninitiated ones get no row yet). */
  selectedProjectIds: string[]
  rows: OverviewRow[]
}

export function fetchOverview(
  instance: IPublicClientApplication,
  account: AccountInfo,
): Promise<OverviewData | null> {
  return apiFetch<OverviewData>(instance, account, '/api/projects?overview=1')
}

/** Edits only the Overview selection — never the user's Added projects. */
export async function setOverviewProject(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  included: boolean,
): Promise<boolean> {
  const body = await apiFetch(instance, account, '/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: included ? 'overview-add' : 'overview-remove', projectId }),
  })
  return body !== null
}
