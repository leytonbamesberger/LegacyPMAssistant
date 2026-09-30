import { SupabaseClient } from '@supabase/supabase-js'
import { FlowReportAnswers } from '../shared/flowReportQuestions.js'

export type { FlowReportAnswers }

export interface FlowReportRecord {
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

function monthStartFor(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10)
}

/** First-of-month date string (YYYY-MM-DD) for the current calendar month, UTC. */
export function currentMonthStart(): string {
  return monthStartFor(new Date())
}

/**
 * Default period for the flow report tool: day-of-month <= 14 defaults to
 * last month (still time to finish it), >= 15 defaults to this month. This
 * only decides which month pre-selects when the tool opens — the month
 * selector on the form can always reach any other month.
 */
export function defaultFlowReportMonth(): string {
  const now = new Date()
  if (now.getUTCDate() <= 14) {
    return monthStartFor(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))
  }
  return monthStartFor(now)
}

/** Last calendar day of `month` (YYYY-MM-DD in, YYYY-MM-DD out) — the computed, non-editable due date. */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

function placeholderReport(projectId: string, month: string): FlowReportRecord {
  return {
    id: '',
    project_id: projectId,
    month,
    status: 'not_started',
    answers: null,
    submitted_by: null,
    submitted_at: null,
    margin_fade_notes: null,
    underbilled_notes: null,
    attn: null,
    company: null,
  }
}

/**
 * Each project's report for one specific month. A project with no row yet
 * gets a synthetic `not_started` placeholder (id: '', never persisted) so the
 * list always has exactly one row per requested project — the real row is
 * created on first save/submit.
 */
export async function getFlowReportsForMonth(
  admin: SupabaseClient,
  projectIds: string[],
  month: string,
): Promise<FlowReportRecord[]> {
  if (projectIds.length === 0) return []

  const { data, error } = await admin
    .from('flow_reports')
    .select('*')
    .eq('month', month)
    .in('project_id', projectIds)
  if (error) throw new Error(error.message)

  const byProject = new Map(
    (data ?? []).map((row) => [(row as FlowReportRecord).project_id, row as FlowReportRecord]),
  )

  return projectIds.map((projectId) => byProject.get(projectId) ?? placeholderReport(projectId, month))
}

/** The default-period report for each project (see defaultFlowReportMonth) — the dashboard summary. */
export function getDefaultPeriodFlowReportsForProjects(
  admin: SupabaseClient,
  projectIds: string[],
): Promise<FlowReportRecord[]> {
  return getFlowReportsForMonth(admin, projectIds, defaultFlowReportMonth())
}

/**
 * Every month that has at least one flow_reports row for these projects,
 * newest first, plus the current default period even if it has no data yet
 * — so the export tool's month selector is never empty on first use.
 */
export async function getAvailableFlowReportMonths(
  admin: SupabaseClient,
  projectIds: string[],
): Promise<string[]> {
  const months = new Set<string>([defaultFlowReportMonth()])
  if (projectIds.length > 0) {
    const { data, error } = await admin
      .from('flow_reports')
      .select('month')
      .in('project_id', projectIds)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) months.add(row.month as string)
  }
  return [...months].sort().reverse()
}

/**
 * One project's report for one specific month — used by the flow report
 * form's month selector, which can reach any past (or future) month, not
 * just the default period.
 */
export async function getFlowReportForMonth(
  admin: SupabaseClient,
  projectId: string,
  month: string,
): Promise<FlowReportRecord> {
  const { data, error } = await admin
    .from('flow_reports')
    .select('*')
    .eq('project_id', projectId)
    .eq('month', month)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as FlowReportRecord | null) ?? placeholderReport(projectId, month)
}

/**
 * Saves a draft: upserts answers/notes. Only advances status out of
 * `not_started` (into `in_progress`) — never reverts an already-completed
 * report just because it was edited afterward. Use submitFlowReport to mark
 * complete.
 */
export async function saveFlowReportDraft(
  admin: SupabaseClient,
  projectId: string,
  month: string,
  answers: FlowReportAnswers,
  marginFadeNotes: string | null,
  underbilledNotes: string | null,
  attn: string | null,
  company: string | null,
): Promise<FlowReportRecord> {
  const { data: existing, error: selectError } = await admin
    .from('flow_reports')
    .select('status')
    .eq('project_id', projectId)
    .eq('month', month)
    .maybeSingle()
  if (selectError) throw new Error(selectError.message)

  const status = !existing || existing.status === 'not_started' ? 'in_progress' : existing.status

  const { data, error } = await admin
    .from('flow_reports')
    .upsert(
      {
        project_id: projectId,
        month,
        answers,
        margin_fade_notes: marginFadeNotes,
        underbilled_notes: underbilledNotes,
        attn,
        company,
        status,
      },
      { onConflict: 'project_id,month' },
    )
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as FlowReportRecord
}

export async function submitFlowReport(
  admin: SupabaseClient,
  projectId: string,
  month: string,
  answers: FlowReportAnswers,
  marginFadeNotes: string | null,
  underbilledNotes: string | null,
  attn: string | null,
  company: string | null,
  submittedBy: string,
): Promise<FlowReportRecord> {
  const { data, error } = await admin
    .from('flow_reports')
    .upsert(
      {
        project_id: projectId,
        month,
        answers,
        margin_fade_notes: marginFadeNotes,
        underbilled_notes: underbilledNotes,
        attn,
        company,
        status: 'completed',
        submitted_by: submittedBy,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,month' },
    )
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as FlowReportRecord
}
