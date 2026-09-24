import { SupabaseClient } from '@supabase/supabase-js'

/** One free-text answer per FLOW-letter question. All optional/partial while in progress. */
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

export interface FlowReportRecord {
  id: string
  project_id: string
  month: string
  status: 'not_started' | 'in_progress' | 'completed'
  answers: FlowReportAnswers | null
  submitted_by: string | null
  submitted_at: string | null
  due_date: string | null
}

/** First-of-month date string (YYYY-MM-DD) for the current month, UTC. */
export function currentMonthStart(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10)
}

/**
 * The current month's flow report for each project. A project with no row
 * yet for this month gets a synthetic `not_started` placeholder (id: '',
 * never persisted) so the cross-project list always has exactly one row per
 * starred project — the real row is created on first save/submit.
 */
export async function getCurrentFlowReportsForProjects(
  admin: SupabaseClient,
  projectIds: string[],
): Promise<FlowReportRecord[]> {
  if (projectIds.length === 0) return []
  const month = currentMonthStart()

  const { data, error } = await admin
    .from('flow_reports')
    .select('*')
    .eq('month', month)
    .in('project_id', projectIds)
  if (error) throw new Error(error.message)

  const byProject = new Map(
    (data ?? []).map((row) => [(row as FlowReportRecord).project_id, row as FlowReportRecord]),
  )

  return projectIds.map(
    (projectId) =>
      byProject.get(projectId) ?? {
        id: '',
        project_id: projectId,
        month,
        status: 'not_started',
        answers: null,
        submitted_by: null,
        submitted_at: null,
        due_date: null,
      },
  )
}

/**
 * Saves a draft: upserts answers/due_date. Only advances status out of
 * `not_started` (into `in_progress`) — never reverts an already-completed
 * report just because it was edited afterward. Use submitFlowReport to mark
 * complete.
 */
export async function saveFlowReportDraft(
  admin: SupabaseClient,
  projectId: string,
  month: string,
  answers: FlowReportAnswers,
  dueDate: string | null,
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
      { project_id: projectId, month, answers, due_date: dueDate, status },
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
  dueDate: string | null,
  submittedBy: string,
): Promise<FlowReportRecord> {
  const { data, error } = await admin
    .from('flow_reports')
    .upsert(
      {
        project_id: projectId,
        month,
        answers,
        due_date: dueDate,
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
