import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch } from './apiClient'

export interface FlowReportAnswers {
  changeProposals?: string
  rfis?: string
  submittals?: string
  applicationsForPayment?: string
  fieldOrdersTAndM?: string
  itemsDueFromLegacy?: string
  scheduleAcknowledgment?: string
  other?: string
}

export const FLOW_REPORT_QUESTIONS: { key: keyof FlowReportAnswers; label: string }[] = [
  { key: 'changeProposals', label: 'Change Proposals' },
  { key: 'rfis', label: 'RFIs' },
  { key: 'submittals', label: 'Submittals' },
  { key: 'applicationsForPayment', label: 'Applications for Payment' },
  { key: 'fieldOrdersTAndM', label: 'Field Orders/T&M' },
  { key: 'itemsDueFromLegacy', label: 'Items Due to You From Legacy' },
  { key: 'scheduleAcknowledgment', label: 'Schedule Acknowledgment' },
  { key: 'other', label: 'Other' },
]

export interface FlowReport {
  id: string
  project_id: string
  month: string
  status: 'not_started' | 'in_progress' | 'completed'
  answers: FlowReportAnswers | null
  submitted_by: string | null
  submitted_at: string | null
  due_date: string | null
}

export async function fetchCurrentFlowReports(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectIds: string[],
): Promise<FlowReport[] | null> {
  if (projectIds.length === 0) return []
  const body = await apiFetch<{ reports: FlowReport[] }>(
    instance,
    account,
    `/api/flow-reports?projectIds=${projectIds.map(encodeURIComponent).join(',')}`,
  )
  return body?.reports ?? null
}

function postFlowReportAction(
  instance: IPublicClientApplication,
  account: AccountInfo,
  body: Record<string, unknown>,
): Promise<{ report: FlowReport } | null> {
  return apiFetch<{ report: FlowReport }>(instance, account, '/api/flow-reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function saveFlowReportDraft(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  month: string,
  answers: FlowReportAnswers,
  dueDate: string | null,
): Promise<FlowReport | null> {
  const body = await postFlowReportAction(instance, account, {
    action: 'save',
    projectId,
    month,
    answers,
    dueDate,
  })
  return body?.report ?? null
}

export async function submitFlowReport(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  month: string,
  answers: FlowReportAnswers,
  dueDate: string | null,
): Promise<FlowReport | null> {
  const body = await postFlowReportAction(instance, account, {
    action: 'submit',
    projectId,
    month,
    answers,
    dueDate,
  })
  return body?.report ?? null
}
