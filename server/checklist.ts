import { SupabaseClient } from '@supabase/supabase-js'

export interface ChecklistItemRecord {
  id: string
  phase: 'setup' | 'weekly' | 'closeout'
  name: string
  sort_order: number
  cadence_days: number | null
}

export interface ChecklistItemStatus {
  item: ChecklistItemRecord
  /** Most recent project_checklist_log row's completed_at for this item, if any. */
  completedAt: string | null
  /** ...and who logged it. */
  completedBy: string | null
  /** setup/closeout: any log row exists. weekly: always true once ever logged. */
  done: boolean
  /** weekly only: never completed, or completedAt older than cadence_days. Always false for setup/closeout. */
  stale: boolean
  /**
   * weekly only: cadence_days minus days since completedAt — negative means
   * overdue. `null` if never completed (always due) or not a weekly item.
   * Drives the badge's "approaching or past cadence" filter.
   */
  daysUntilDue: number | null
}

export interface ProjectChecklistStatus {
  projectId: string
  setup: ChecklistItemStatus[]
  weekly: ChecklistItemStatus[]
  closeout: ChecklistItemStatus[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Status of every checklist item (all three phases) for a set of projects, in
 * one pair of queries regardless of how many projects are requested.
 */
export async function getChecklistStatusForProjects(
  admin: SupabaseClient,
  projectIds: string[],
): Promise<ProjectChecklistStatus[]> {
  if (projectIds.length === 0) return []

  const [itemsResult, logsResult] = await Promise.all([
    admin.from('checklist_items').select('*').order('phase').order('sort_order'),
    admin
      .from('project_checklist_log')
      .select('project_id, checklist_item_id, completed_at, completed_by')
      .in('project_id', projectIds)
      .order('completed_at', { ascending: false }),
  ])
  if (itemsResult.error) throw new Error(itemsResult.error.message)
  if (logsResult.error) throw new Error(logsResult.error.message)

  const items = (itemsResult.data ?? []) as ChecklistItemRecord[]
  const logs = (logsResult.data ?? []) as {
    project_id: string
    checklist_item_id: string
    completed_at: string
    completed_by: string
  }[]

  // logs is ordered completed_at desc, so the first row seen per
  // (project_id, checklist_item_id) pair is the most recent one.
  const latestByKey = new Map<string, (typeof logs)[number]>()
  for (const log of logs) {
    const key = `${log.project_id}:${log.checklist_item_id}`
    if (!latestByKey.has(key)) latestByKey.set(key, log)
  }

  const now = Date.now()

  return projectIds.map((projectId) => {
    const byPhase: Pick<ProjectChecklistStatus, 'setup' | 'weekly' | 'closeout'> = {
      setup: [],
      weekly: [],
      closeout: [],
    }
    for (const item of items) {
      const latest = latestByKey.get(`${projectId}:${item.id}`) ?? null
      const completedAt = latest?.completed_at ?? null
      const completedBy = latest?.completed_by ?? null
      const done = completedAt !== null
      const daysUntilDue =
        item.phase === 'weekly' && item.cadence_days !== null && completedAt !== null
          ? item.cadence_days - (now - new Date(completedAt).getTime()) / DAY_MS
          : null
      const stale =
        item.phase === 'weekly' && (completedAt === null || (daysUntilDue ?? 0) < 0)
      byPhase[item.phase].push({ item, completedAt, completedBy, done, stale, daysUntilDue })
    }
    return { projectId, ...byPhase }
  })
}

/**
 * Setup/closeout items are boolean: `done` means "presence of any log row".
 * Checking marks done (inserts one row, if not already present); unchecking
 * removes any existing rows for that (project, item) pair.
 */
export async function setChecklistItemDone(
  admin: SupabaseClient,
  projectId: string,
  checklistItemId: string,
  profileId: string,
  done: boolean,
): Promise<void> {
  if (done) {
    const { data: existing, error: selectError } = await admin
      .from('project_checklist_log')
      .select('id')
      .eq('project_id', projectId)
      .eq('checklist_item_id', checklistItemId)
      .limit(1)
    if (selectError) throw new Error(selectError.message)
    if (existing && existing.length > 0) return

    const { error } = await admin.from('project_checklist_log').insert({
      project_id: projectId,
      checklist_item_id: checklistItemId,
      completed_by: profileId,
    })
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await admin
    .from('project_checklist_log')
    .delete()
    .eq('project_id', projectId)
    .eq('checklist_item_id', checklistItemId)
  if (error) throw new Error(error.message)
}

/**
 * Weekly items are a running history — checking one off always inserts a new
 * row, never updates the existing one (see supabase/schema.sql).
 */
export async function logWeeklyChecklistItem(
  admin: SupabaseClient,
  projectId: string,
  checklistItemId: string,
  profileId: string,
): Promise<void> {
  const { error } = await admin.from('project_checklist_log').insert({
    project_id: projectId,
    checklist_item_id: checklistItemId,
    completed_by: profileId,
  })
  if (error) throw new Error(error.message)
}
