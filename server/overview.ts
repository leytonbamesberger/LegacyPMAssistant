import { SupabaseClient } from '@supabase/supabase-js'
import { defaultFlowReportMonth } from '../shared/period.js'
import { normalizeOverviewView, type OverviewView } from '../shared/overviewView.js'
import type { FlowBudgetChecklist } from '../shared/flowBudget.js'
import { getFlowReportsForMonth } from './flowReports.js'
import { selectAll } from './selectAll.js'

/** Column groups, left to right. `meetings` = the checklist_items.is_meeting items, split out of Setup. */
export type OverviewGroup = 'setup' | 'meetings' | 'recurring' | 'closeout'

export interface OverviewColumn {
  id: string
  name: string
  phase: OverviewGroup
}

/** What a Meetings cell needs from the project's meeting task. */
export interface OverviewMeeting {
  status: string
  due_date: string | null
  meeting_date: string | null
}

/** The current period's flow report for one project: submitted, plus its four budget boxes. */
export type OverviewFlow = { report: boolean } & FlowBudgetChecklist

export interface OverviewData {
  /** The caller's saved "Choose a View" selection. */
  view: OverviewView
  columns: OverviewColumn[]
  /**
   * One per project in the view (the union of Added / the picked PMs' projects / picked projects),
   * initiated or not. `done` = checklist_item_ids shown checked; `na` = ids the project has no task for
   * (excluded, never created, another project's custom item, closeout not started) — shown as a
   * disabled box. Every other column is "applies, not done". `meetings` = the meeting task behind each
   * Meetings column the project has one for (keyed by checklist_item_id). An uninitiated project has
   * empty done/na/meetings (the page shows one merged "Initiate this project" cell) but real `flow` values.
   */
  rows: {
    project_id: string
    pm_id: string | null
    initiated: boolean
    done: string[]
    na: string[]
    meetings: Record<string, OverviewMeeting>
    flow: OverviewFlow
  }[]
}

interface InstanceRow {
  project_id: string
  checklist_item_id: string
  status: string
  due_date: string | null
  meeting_date: string | null
}

/**
 * Whether a recurring item shows a check: is "the most recent cycle's" task
 * instance complete?
 *
 * Completing an instance immediately spawns the next one (due = old due +
 * cadence), so the newest row is almost always an open one. Taken literally
 * the grid would never show a check for a recurring item. A cycle only counts
 * once it has started, i.e. once the previous instance's due date is behind us:
 * done early for a cycle that is still running (Mar 10, March's Budget items
 * complete, April's spawned) -> check; the day after March's due date -> April's
 * instance is the current cycle, and it's open -> blank.
 */
export function currentCycleComplete(
  instances: { due_date: string | null; status: string }[],
  today: string,
): boolean {
  const dated = instances
    .filter((i): i is { due_date: string; status: string } => i.due_date !== null)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
  if (dated.length === 0) return false
  let i = dated.length - 1
  while (i > 0 && dated[i - 1].due_date >= today) i--
  return dated[i].status === 'complete'
}

/** The caller's saved view (the column defaults to Added-only, so a missing/odd value is treated the same). */
export async function getOverviewView(admin: SupabaseClient, profileId: string): Promise<OverviewView> {
  const { data, error } = await admin.from('profiles').select('overview_view').eq('id', profileId).single()
  if (error) throw new Error(error.message)
  return normalizeOverviewView(data?.overview_view)
}

export async function saveOverviewView(admin: SupabaseClient, profileId: string, raw: unknown): Promise<OverviewView> {
  const view = normalizeOverviewView(raw)
  const { error } = await admin.from('profiles').update({ overview_view: view }).eq('id', profileId)
  if (error) throw new Error(error.message)
  return view
}

/** Project ids in a view: union of Added (live), the picked PMs' projects (live), and individual picks — active projects only. */
export async function resolveViewProjects(
  admin: SupabaseClient,
  profileId: string,
  view: OverviewView,
): Promise<{ id: string; initiated: boolean; pm_id: string | null }[]> {
  const ids = new Set<string>(view.project_ids)
  if (view.mine) {
    const { data, error } = await admin.from('user_starred_projects').select('project_id').eq('profile_id', profileId)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) ids.add(r.project_id as string)
  }
  if (view.pm_ids.length > 0) {
    const { data, error } = await admin.from('projects').select('id').in('pm_id', view.pm_ids).eq('is_active', true)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) ids.add(r.id as string)
  }

  const all = [...ids]
  const out: { id: string; initiated: boolean; pm_id: string | null }[] = []
  for (let i = 0; i < all.length; i += 100) {
    const { data, error } = await admin
      .from('projects')
      .select('id, initiated, pm_id')
      .in('id', all.slice(i, i + 100))
      .eq('is_active', true)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as { id: string; initiated: boolean; pm_id: string | null }[]))
  }
  return out
}

const PROJECT_CHUNK = 20

export async function getOverview(admin: SupabaseClient, profileId: string): Promise<OverviewData> {
  const view = await getOverviewView(admin, profileId)
  const projects = await resolveViewProjects(admin, profileId, view)
  if (projects.length === 0) return { view, columns: [], rows: [] }
  const pmByProject = new Map(projects.map((p) => [p.id, p.pm_id]))

  const initiatedIds = (projects ?? []).filter((p) => p.initiated).map((p) => p.id as string)
  const uninitiatedIds = (projects ?? []).filter((p) => !p.initiated).map((p) => p.id as string)
  const shownIds = [...initiatedIds, ...uninitiatedIds]

  const today = new Date().toISOString().slice(0, 10)
  // Setup is one-time, so every Setup row matters. A recurring chain only needs its open
  // instance plus any completed-ahead-of-schedule one; older history can't change the
  // answer (see currentCycleComplete) and would grow without bound.
  const instances: InstanceRow[] = []
  for (let i = 0; i < initiatedIds.length; i += PROJECT_CHUNK) {
    const chunk = initiatedIds.slice(i, i + PROJECT_CHUNK)
    instances.push(
      ...(await selectAll<InstanceRow>(
        () =>
          admin
            .from('tasks')
            .select('project_id, checklist_item_id, status, due_date, meeting_date')
            .in('project_id', chunk)
            .not('checklist_item_id', 'is', null)
            .or(`source_category.eq.setup,source_category.eq.closeout,status.neq.complete,due_date.gte.${today}`)
            .order('id') as never,
      )),
    )
  }

  const exclusions: { project_id: string; checklist_item_id: string }[] = []
  for (let i = 0; i < initiatedIds.length; i += PROJECT_CHUNK) {
    const chunk = initiatedIds.slice(i, i + PROJECT_CHUNK)
    exclusions.push(
      ...(await selectAll<{ project_id: string; checklist_item_id: string }>(
        () =>
          admin
            .from('project_checklist_item_exclusions')
            .select('project_id, checklist_item_id')
            .in('project_id', chunk)
            .order('project_id')
            .order('checklist_item_id') as never,
      )),
    )
  }
  const excluded = new Set(exclusions.map((e) => `${e.project_id}|${e.checklist_item_id}`))

  const { data: items, error: itemsError } = await admin
    .from('checklist_items')
    .select('id, name, phase, sort_order, project_id, is_meeting')
    .in('phase', ['setup', 'recurring', 'closeout'])
    .order('sort_order')
  if (itemsError) throw new Error(itemsError.message)

  const groupOf = (item: { phase: unknown; is_meeting: unknown }): OverviewGroup =>
    item.phase === 'setup' && item.is_meeting === true ? 'meetings' : (item.phase as OverviewGroup)
  const phaseByItem = new Map<string, 'setup' | 'recurring' | 'closeout'>()
  for (const item of items ?? []) phaseByItem.set(item.id as string, item.phase as 'setup' | 'recurring' | 'closeout')

  const byChain = new Map<string, InstanceRow[]>()
  const hasTask = new Set<string>() // checklist_item_ids some shown project has a task for
  for (const row of instances) {
    if (!phaseByItem.has(row.checklist_item_id)) continue
    const key = `${row.project_id}|${row.checklist_item_id}`
    byChain.set(key, [...(byChain.get(key) ?? []), row])
    hasTask.add(row.checklist_item_id)
  }

  // The columns are the whole shared catalog, whatever the view's projects use. The one exception is a
  // project's own custom item (checklist_items.project_id set): its column shows only while a shown
  // project has it, at the end of its group.
  const GROUP_ORDER = { setup: 0, meetings: 1, recurring: 2, closeout: 3 } as const
  const columns: OverviewColumn[] = (items ?? [])
    .filter((item) => item.project_id === null || hasTask.has(item.id as string))
    .sort(
      (a, b) =>
        GROUP_ORDER[groupOf(a)] - GROUP_ORDER[groupOf(b)] ||
        Number(a.project_id !== null) - Number(b.project_id !== null) ||
        (a.sort_order as number) - (b.sort_order as number),
    )
    .map((item) => ({ id: item.id as string, name: item.name as string, phase: groupOf(item) }))

  const flowReports = await getFlowReportsForMonth(admin, shownIds, defaultFlowReportMonth())
  const flowByProject = new Map(flowReports.map((r) => [r.project_id, r]))

  const rows = shownIds.map((projectId) => {
    const initiated = !uninitiatedIds.includes(projectId)
    const chainOf = (itemId: string) => byChain.get(`${projectId}|${itemId}`)
    const meetings: Record<string, OverviewMeeting> = {}
    if (initiated) {
      for (const col of columns) {
        if (col.phase !== 'meetings') continue
        const chain = chainOf(col.id)
        const task = chain?.find((t) => t.status === 'complete') ?? chain?.[0]
        if (task) meetings[col.id] = { status: task.status, due_date: task.due_date, meeting_date: task.meeting_date }
      }
    }
    return {
      project_id: projectId,
      pm_id: pmByProject.get(projectId) ?? null,
      initiated,
      // No task (or the item was excluded for this project) = doesn't apply.
      na: (initiated ? columns : [])
        .filter((col) => !chainOf(col.id) || excluded.has(`${projectId}|${col.id}`))
        .map((col) => col.id),
      meetings,
      done: columns
        .filter((col) => {
          const chain = byChain.get(`${projectId}|${col.id}`)
          if (!chain) return false // no task: not applicable to this project
          return col.phase === 'recurring'
            ? currentCycleComplete(chain, today)
            : chain.some((t) => t.status === 'complete') // Setup and Closeout are one-time
        })
        .map((col) => col.id),
      flow: ((report) => ({
        report: report?.status === 'completed',
        budget_forecasted: report?.budget_forecasted === true,
        budget_projections_updated: report?.budget_projections_updated === true,
        budget_snapshots_taken: report?.budget_snapshots_taken === true,
        budget_sent_to_erp: report?.budget_sent_to_erp === true,
      }))(flowByProject.get(projectId)),
    }
  })

  return { view, columns, rows }
}
