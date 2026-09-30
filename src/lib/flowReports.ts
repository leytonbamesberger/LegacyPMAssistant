import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch, apiFetchBlob } from './apiClient'
import { FLOW_REPORT_QUESTIONS, type FlowReportAnswers } from '../../shared/flowReportQuestions'

export { FLOW_REPORT_QUESTIONS }
export type { FlowReportAnswers }

export interface FlowReport {
  id: string
  project_id: string
  month: string
  status: 'not_started' | 'in_progress' | 'completed'
  answers: FlowReportAnswers | null
  submitted_by: string | null
  submitted_at: string | null
  margin_fade_notes: string | null
  underbilled_notes: string | null
  attn: string | null
  company: string | null
}

/** Last calendar day of `month` (YYYY-MM-DD) — mirrors server/flowReports.ts's lastDayOfMonth(). */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/**
 * Client-side mirror of server/flowReports.ts's defaultFlowReportMonth(), for
 * the rare case a report modal opens before the dashboard's own default-period
 * fetch has resolved. The server's value (from the loaded `flowReports` list)
 * is always preferred when available.
 */
export function defaultFlowReportMonth(): string {
  const now = new Date()
  const target =
    now.getUTCDate() <= 14
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return target.toISOString().slice(0, 10)
}

/** Default-period report for each project — day-of-month <=14 means last month, >=15 means this month. */
export async function fetchDefaultPeriodFlowReports(
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

/** One project's report for one specific month — used by the form's month selector. */
export async function fetchFlowReportForMonth(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  month: string,
): Promise<FlowReport | null> {
  const body = await apiFetch<{ report: FlowReport }>(
    instance,
    account,
    `/api/flow-reports?projectId=${encodeURIComponent(projectId)}&month=${encodeURIComponent(month)}`,
  )
  return body?.report ?? null
}

/** Every month with data for these projects, newest first (plus the current default period). */
export async function fetchAvailableFlowReportMonths(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectIds: string[],
): Promise<string[] | null> {
  if (projectIds.length === 0) return [defaultFlowReportMonth()]
  const body = await apiFetch<{ months: string[] }>(
    instance,
    account,
    `/api/flow-reports?projectIds=${projectIds.map(encodeURIComponent).join(',')}&availableMonths=1`,
  )
  return body?.months ?? null
}

/** Each project's report for one specific month — used by the export tool's selection screen. */
export async function fetchFlowReportsForMonth(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectIds: string[],
  month: string,
): Promise<FlowReport[] | null> {
  if (projectIds.length === 0) return []
  const body = await apiFetch<{ reports: FlowReport[] }>(
    instance,
    account,
    `/api/flow-reports?projectIds=${projectIds.map(encodeURIComponent).join(',')}&month=${encodeURIComponent(month)}`,
  )
  return body?.reports ?? null
}

/** Generates the cover-page + per-project-letter PDF and returns it as a downloadable Blob. */
export async function exportFlowReportsPdf(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectIds: string[],
  month: string,
): Promise<Blob | null> {
  return apiFetchBlob(instance, account, '/api/flow-reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'export-pdf', projectIds, month }),
  })
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
  marginFadeNotes: string | null,
  underbilledNotes: string | null,
  attn: string | null,
  company: string | null,
): Promise<FlowReport | null> {
  const body = await postFlowReportAction(instance, account, {
    action: 'save',
    projectId,
    month,
    answers,
    marginFadeNotes,
    underbilledNotes,
    attn,
    company,
  })
  return body?.report ?? null
}

export async function submitFlowReport(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  month: string,
  answers: FlowReportAnswers,
  marginFadeNotes: string | null,
  underbilledNotes: string | null,
  attn: string | null,
  company: string | null,
): Promise<FlowReport | null> {
  const body = await postFlowReportAction(instance, account, {
    action: 'submit',
    projectId,
    month,
    answers,
    marginFadeNotes,
    underbilledNotes,
    attn,
    company,
  })
  return body?.report ?? null
}
