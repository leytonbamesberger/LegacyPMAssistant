import { SupabaseClient } from '@supabase/supabase-js'
import { defaultFlowReportMonth } from '../shared/period.js'
import { normalizeOverviewView, type OverviewView } from '../shared/overviewView.js'
import type { FlowBudgetChecklist } from '../shared/flowBudget.js'
import { getFlowReportsForMonth } from './flowReports.js'
import { selectAll } from './selectAll.js'

export interface OverviewColumn {
  id: string
  name: string
  phase: 'setup' | 'recurring' | 'closeout'
}

/** The current period's flow report for one project: submitted, plus its four budget boxes. */
export type OverviewFlow = { report: boolean } & FlowBudgetChecklist

export interface OverviewData {
  /** The caller's saved "Choose a View" selection. */
  view: OverviewView
  columns: OverviewColumn[]
  /**
   * One per project in the view (the union of Added / the picked PMs' projects / picked projects),
   * initiated or not. `done` = checklist_item_ids shown checked; `na` = ids that don't apply to this
   * project (excluded default, another project's custom item, or a closeout item it has no task for) —
   * shown as a disabled box. Every other column is "applies, not done". An uninitiated project has
   * empty done/na (the page shows one merged "Initiate this project" cell) but real `flow` values.
   */
  rows: {
    project_id: string
    pm_id: string | null
    initiated: boolean
    done: string[]
    na: string[]
    flow: OverviewFlow
  }[]
}

interface InstanceRow {
  project_id: string
  checklist_item_id: string
  status: string
  due_date: string | null
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
            .select('project_id, checklist_item_id, status, due_date')
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
    .select('id, name, phase, sort_order, project_id')
    .in('phase', ['setup', 'recurring', 'closeout'])
    .order('sort_order')
  if (itemsError) throw new Error(itemsError.message)

  const phaseByItem = new Map<string, 'setup' | 'recurring' | 'closeout'>()
  for (const item of items ?? []) phaseByItem.set(item.id as string, item.phase as 'setup' | 'recurring' | 'closeout')

  const byChain = new Map<string, InstanceRow[]>()
  const applicable = new Set<string>()
  for (const row of instances) {
    if (!phaseByItem.has(row.checklist_item_id)) continue
    const key = `${row.project_id}|${row.checklist_item_id}`
    byChain.set(key, [...(byChain.get(key) ?? []), row])
    applicable.add(row.checklist_item_id)
  }

  // A Setup / Recurring column exists only if some shown project actually has that item — so an item
  // every shown project excluded, and other projects' custom items, add no empty columns. The shared
  // closeout items are always columns once any initiated project is shown (a project with no closeout
  // task for one just gets the not-applicable box).
  const PHASE_ORDER = { setup: 0, recurring: 1, closeout: 2 } as const
  const columns: OverviewColumn[] = (items ?? [])
    .filter((item) => {
      if (item.phase === 'closeout') return item.project_id === null && initiatedIds.length > 0
      return applicable.has(item.id as string)
    })
    .sort(
      (a, b) =>
        PHASE_ORDER[a.phase as keyof typeof PHASE_ORDER] - PHASE_ORDER[b.phase as keyof typeof PHASE_ORDER] ||
        (a.sort_order as number) - (b.sort_order as number),
    )
    .map((item) => ({
      id: item.id as string,
      name: item.name as string,
      phase: item.phase as OverviewColumn['phase'],
    }))

  const flowReports = await getFlowReportsForMonth(admin, shownIds, defaultFlowReportMonth())
  const flowByProject = new Map(flowReports.map((r) => [r.project_id, r]))

  const ownerByItem = new Map((items ?? []).map((i) => [i.id as string, i.project_id as string | null]))

  const rows = shownIds.map((projectId) => ({
    project_id: projectId,
    pm_id: pmByProject.get(projectId) ?? null,
    initiated: !uninitiatedIds.includes(projectId),
    na: (uninitiatedIds.includes(projectId) ? [] : columns)
      .filter((col) => {
        if (col.phase === 'closeout') return !byChain.has(`${projectId}|${col.id}`) // no closeout task for it
        const owner = ownerByItem.get(col.id)
        // A custom item belongs to one project (and can be dropped from it); a shared default can be excluded per project.
        return owner
          ? owner !== projectId || excluded.has(`${projectId}|${col.id}`)
          : excluded.has(`${projectId}|${col.id}`)
      })
      .map((col) => col.id),
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
  }))

  return { view, columns, rows }
}
