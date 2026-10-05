import { SupabaseClient } from '@supabase/supabase-js'
import { defaultFlowReportMonth } from '../shared/period.js'
import type { FlowBudgetChecklist } from '../shared/flowBudget.js'
import { getFlowReportsForMonth } from './flowReports.js'
import { selectAll } from './selectAll.js'

export interface OverviewColumn {
  id: string
  name: string
  phase: 'setup' | 'recurring'
}

/** The current period's flow report for one project: submitted, plus its four budget boxes. */
export type OverviewFlow = { report: boolean } & FlowBudgetChecklist

export interface OverviewData {
  columns: OverviewColumn[]
  /** Everything the user picked for Overview, initiated or not (uninitiated ones get no row). */
  selectedProjectIds: string[]
  /**
   * One per selected *initiated* project. `done` = checklist_item_ids shown checked;
   * `na` = ids that don't apply to this project (excluded default, or another project's
   * custom item) — shown as a disabled box. Every other column is "applies, not done".
   */
  rows: { project_id: string; initiated: boolean; done: string[]; na: string[]; flow: OverviewFlow }[]
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

/** First open: seed the selection from the user's Added projects, once (the flag stops a later "remove everything" re-seeding). */
async function ensureSeeded(admin: SupabaseClient, profileId: string): Promise<void> {
  const { data: profile, error } = await admin
    .from('profiles')
    .select('overview_seeded')
    .eq('id', profileId)
    .single()
  if (error) throw new Error(error.message)
  if (profile.overview_seeded) return

  const { data: starred, error: starredError } = await admin
    .from('user_starred_projects')
    .select('project_id')
    .eq('profile_id', profileId)
  if (starredError) throw new Error(starredError.message)

  if ((starred ?? []).length > 0) {
    // ignoreDuplicates: two tabs opening Overview at once must not trip over each other.
    const { error: seedError } = await admin.from('user_overview_projects').upsert(
      (starred ?? []).map((r) => ({ user_id: profileId, project_id: r.project_id })),
      { onConflict: 'user_id,project_id', ignoreDuplicates: true },
    )
    if (seedError) throw new Error(seedError.message)
  }
  const { error: flagError } = await admin
    .from('profiles')
    .update({ overview_seeded: true })
    .eq('id', profileId)
  if (flagError) throw new Error(flagError.message)
}

export async function addOverviewProject(
  admin: SupabaseClient,
  profileId: string,
  projectId: string,
): Promise<void> {
  const { error } = await admin
    .from('user_overview_projects')
    .upsert([{ user_id: profileId, project_id: projectId }], {
      onConflict: 'user_id,project_id',
      ignoreDuplicates: true,
    })
  if (error) throw new Error(error.message)
}

export async function removeOverviewProject(
  admin: SupabaseClient,
  profileId: string,
  projectId: string,
): Promise<void> {
  const { error } = await admin
    .from('user_overview_projects')
    .delete()
    .eq('user_id', profileId)
    .eq('project_id', projectId)
  if (error) throw new Error(error.message)
}

const PROJECT_CHUNK = 20

export async function getOverview(admin: SupabaseClient, profileId: string): Promise<OverviewData> {
  await ensureSeeded(admin, profileId)

  const { data: selected, error: selectedError } = await admin
    .from('user_overview_projects')
    .select('project_id')
    .eq('user_id', profileId)
  if (selectedError) throw new Error(selectedError.message)
  const selectedProjectIds = (selected ?? []).map((r) => r.project_id as string)
  if (selectedProjectIds.length === 0) return { columns: [], selectedProjectIds, rows: [] }

  const { data: projects, error: projectsError } = await admin
    .from('projects')
    .select('id, initiated')
    .in('id', selectedProjectIds)
  if (projectsError) throw new Error(projectsError.message)
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
            .or(`source_category.eq.setup,status.neq.complete,due_date.gte.${today}`)
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
    .in('phase', ['setup', 'recurring'])
    .order('phase', { ascending: false }) // 'setup' before 'recurring'
    .order('sort_order')
  if (itemsError) throw new Error(itemsError.message)

  const phaseByItem = new Map<string, 'setup' | 'recurring'>()
  for (const item of items ?? []) phaseByItem.set(item.id as string, item.phase as 'setup' | 'recurring')

  const byChain = new Map<string, InstanceRow[]>()
  const applicable = new Set<string>()
  for (const row of instances) {
    if (!phaseByItem.has(row.checklist_item_id)) continue
    const key = `${row.project_id}|${row.checklist_item_id}`
    byChain.set(key, [...(byChain.get(key) ?? []), row])
    applicable.add(row.checklist_item_id)
  }

  // A column exists only if some shown project actually has that item — so an item every
  // shown project excluded, and other projects' custom items, add no empty columns.
  const columns: OverviewColumn[] = (items ?? [])
    .filter((item) => applicable.has(item.id as string))
    .map((item) => ({
      id: item.id as string,
      name: item.name as string,
      phase: item.phase as 'setup' | 'recurring',
    }))

  const flowReports = await getFlowReportsForMonth(admin, shownIds, defaultFlowReportMonth())
  const flowByProject = new Map(flowReports.map((r) => [r.project_id, r]))

  const ownerByItem = new Map((items ?? []).map((i) => [i.id as string, i.project_id as string | null]))

  const rows = shownIds.map((projectId) => ({
    project_id: projectId,
    initiated: !uninitiatedIds.includes(projectId),
    na: (uninitiatedIds.includes(projectId) ? [] : columns)
      .filter((col) => {
        const owner = ownerByItem.get(col.id)
        // A custom item belongs to one project; a shared default can be excluded per project.
        return owner ? owner !== projectId : excluded.has(`${projectId}|${col.id}`)
      })
      .map((col) => col.id),
    done: columns
      .filter((col) => {
        const chain = byChain.get(`${projectId}|${col.id}`)
        if (!chain) return false // no task: not applicable to this project
        return col.phase === 'setup'
          ? chain.some((t) => t.status === 'complete')
          : currentCycleComplete(chain, today)
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

  return { columns, selectedProjectIds, rows }
}
