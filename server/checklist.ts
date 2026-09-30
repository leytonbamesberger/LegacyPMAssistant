import { SupabaseClient } from '@supabase/supabase-js'
import { currentMonthStart } from './flowReports.js'

export interface ChecklistItemRecord {
  id: string
  phase: 'setup' | 'recurring' | 'closeout'
  name: string
  sort_order: number
  cadence_days: number | null
  cadence_type: 'rolling' | 'calendar_month' | null
  /** null = shared default (every project starts with it); set = one project's own custom item. */
  project_id: string | null
}

export interface ChecklistItemStatus {
  item: ChecklistItemRecord
  /** Most recent project_checklist_log row's completed_at for this item, if any. */
  completedAt: string | null
  /** ...and who logged it. */
  completedBy: string | null
  /** setup/closeout: any log row exists. recurring: true once ever logged (informational only — see `due`). */
  done: boolean
  /** recurring only: true when overdue (rolling) or not logged since month start (calendar_month). */
  stale: boolean
  /** recurring, cadence_type = 'rolling' only: cadence_days minus days since completedAt — negative means overdue, null if never completed or not rolling. */
  daysUntilDue: number | null
  /** recurring only: unified "needs attention now" flag across both cadence types — drives the badge count and default expanded view. */
  due: boolean
  /** item.project_id !== null — a project's own custom item vs a shared default. */
  isCustom: boolean
  /**
   * recurring only: this project's project_checklist_schedule row for this
   * item, if any — a future-dated marker shown on the calendar panel. Doesn't
   * affect `due`/`stale`/`done`; completing the item separately doesn't clear it.
   */
  scheduledDate: string | null
}

export interface ProjectChecklistStatus {
  projectId: string
  setup: ChecklistItemStatus[]
  recurring: ChecklistItemStatus[]
  closeout: ChecklistItemStatus[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Status of every checklist item (all three phases) for a set of projects, in
 * a fixed number of queries regardless of how many projects are requested.
 * A project's recurring list = shared defaults (project_id is null) minus
 * that project's exclusions, plus that project's own custom items
 * (project_id = that project).
 */
export async function getChecklistStatusForProjects(
  admin: SupabaseClient,
  projectIds: string[],
): Promise<ProjectChecklistStatus[]> {
  if (projectIds.length === 0) return []

  const [itemsResult, logsResult, exclusionsResult, scheduleResult] = await Promise.all([
    admin
      .from('checklist_items')
      .select('*')
      .or(`project_id.is.null,project_id.in.(${projectIds.join(',')})`)
      .order('phase')
      .order('sort_order'),
    admin
      .from('project_checklist_log')
      .select('project_id, checklist_item_id, completed_at, completed_by')
      .in('project_id', projectIds)
      .order('completed_at', { ascending: false }),
    admin
      .from('project_checklist_item_exclusions')
      .select('project_id, checklist_item_id')
      .in('project_id', projectIds),
    admin
      .from('project_checklist_schedule')
      .select('project_id, checklist_item_id, scheduled_date')
      .in('project_id', projectIds),
  ])
  if (itemsResult.error) throw new Error(itemsResult.error.message)
  if (logsResult.error) throw new Error(logsResult.error.message)
  if (exclusionsResult.error) throw new Error(exclusionsResult.error.message)
  if (scheduleResult.error) throw new Error(scheduleResult.error.message)

  const allItems = (itemsResult.data ?? []) as ChecklistItemRecord[]
  const logs = (logsResult.data ?? []) as {
    project_id: string
    checklist_item_id: string
    completed_at: string
    completed_by: string
  }[]
  const exclusions = (exclusionsResult.data ?? []) as {
    project_id: string
    checklist_item_id: string
  }[]
  const scheduleRows = (scheduleResult.data ?? []) as {
    project_id: string
    checklist_item_id: string
    scheduled_date: string
  }[]

  const excludedByProject = new Map<string, Set<string>>()
  for (const row of exclusions) {
    if (!excludedByProject.has(row.project_id)) excludedByProject.set(row.project_id, new Set())
    excludedByProject.get(row.project_id)!.add(row.checklist_item_id)
  }

  const scheduledDateByKey = new Map<string, string>()
  for (const row of scheduleRows) {
    scheduledDateByKey.set(`${row.project_id}:${row.checklist_item_id}`, row.scheduled_date)
  }

  // logs is ordered completed_at desc, so the first row seen per
  // (project_id, checklist_item_id) pair is the most recent one.
  const latestByKey = new Map<string, (typeof logs)[number]>()
  for (const log of logs) {
    const key = `${log.project_id}:${log.checklist_item_id}`
    if (!latestByKey.has(key)) latestByKey.set(key, log)
  }

  const now = Date.now()
  const monthStartMs = new Date(`${currentMonthStart()}T00:00:00Z`).getTime()

  return projectIds.map((projectId) => {
    const excluded = excludedByProject.get(projectId)
    const projectItems = allItems.filter((item) =>
      item.project_id === null ? !excluded?.has(item.id) : item.project_id === projectId,
    )

    const byPhase: Pick<ProjectChecklistStatus, 'setup' | 'recurring' | 'closeout'> = {
      setup: [],
      recurring: [],
      closeout: [],
    }

    for (const item of projectItems) {
      const latest = latestByKey.get(`${projectId}:${item.id}`) ?? null
      const completedAt = latest?.completed_at ?? null
      const completedBy = latest?.completed_by ?? null
      const done = completedAt !== null
      const isCustom = item.project_id !== null

      let stale = false
      let due = false
      let daysUntilDue: number | null = null

      if (item.phase === 'recurring') {
        if (item.cadence_type === 'calendar_month') {
          const loggedThisMonth = completedAt !== null && new Date(completedAt).getTime() >= monthStartMs
          stale = !loggedThisMonth
          due = !loggedThisMonth
        } else {
          daysUntilDue =
            item.cadence_days !== null && completedAt !== null
              ? item.cadence_days - (now - new Date(completedAt).getTime()) / DAY_MS
              : null
          stale = completedAt === null || (daysUntilDue ?? 0) < 0
          due = completedAt === null || (daysUntilDue !== null && daysUntilDue <= 1)
        }
      }

      byPhase[item.phase].push({
        item,
        completedAt,
        completedBy,
        done,
        stale,
        daysUntilDue,
        due,
        isCustom,
        scheduledDate: scheduledDateByKey.get(`${projectId}:${item.id}`) ?? null,
      })
    }

    return { projectId, ...byPhase }
  })
}

/**
 * Which of the 4 default calendar-month "Budget" items (Forecasted,
 * Projections Updated, Snapshots Taken, Sent to ERP) each project logged at
 * least once during a given (possibly past) calendar month — used by the
 * flow report PDF export's cover page. Unlike getChecklistStatusForProjects,
 * this checks a specific month, not "now".
 */
export async function getCalendarMonthCompletionForMonth(
  admin: SupabaseClient,
  projectIds: string[],
  month: string,
): Promise<Map<string, Map<string, boolean>>> {
  const monthStartMs = new Date(`${month}T00:00:00Z`).getTime()
  const [y, m] = month.split('-').map(Number)
  const monthEndMs = new Date(Date.UTC(y, m, 1)).getTime()

  const { data: items, error: itemsError } = await admin
    .from('checklist_items')
    .select('id, name')
    .eq('phase', 'recurring')
    .eq('cadence_type', 'calendar_month')
    .is('project_id', null)
    .order('sort_order')
  if (itemsError) throw new Error(itemsError.message)

  const itemNameById = new Map((items ?? []).map((i) => [i.id as string, i.name as string]))
  const itemIds = [...itemNameById.keys()]

  const result = new Map<string, Map<string, boolean>>()
  for (const projectId of projectIds) {
    result.set(projectId, new Map(items?.map((i) => [i.name as string, false])))
  }
  if (itemIds.length === 0 || projectIds.length === 0) return result

  const { data: logs, error: logsError } = await admin
    .from('project_checklist_log')
    .select('project_id, checklist_item_id, completed_at')
    .in('project_id', projectIds)
    .in('checklist_item_id', itemIds)
  if (logsError) throw new Error(logsError.message)

  for (const log of logs ?? []) {
    const completedAtMs = new Date(log.completed_at as string).getTime()
    if (completedAtMs < monthStartMs || completedAtMs >= monthEndMs) continue
    const itemName = itemNameById.get(log.checklist_item_id as string)
    if (!itemName) continue
    result.get(log.project_id as string)?.set(itemName, true)
  }

  return result
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
 * Setting a date on a setup item immediately completes it — the date (which
 * may be in the future, e.g. a Block Party scheduled for next Friday) becomes
 * project_checklist_log's completed_at, so the item shows done from that
 * point forward and the date surfaces on the calendar panel. Updates the
 * existing log row if one exists (rescheduling), rather than inserting a
 * second one — setup's "done" is presence of any row, not a count.
 */
export async function setSetupItemDate(
  admin: SupabaseClient,
  projectId: string,
  checklistItemId: string,
  profileId: string,
  date: string,
): Promise<void> {
  const { data: existing, error: selectError } = await admin
    .from('project_checklist_log')
    .select('id')
    .eq('project_id', projectId)
    .eq('checklist_item_id', checklistItemId)
    .limit(1)
    .maybeSingle()
  if (selectError) throw new Error(selectError.message)

  if (existing) {
    const { error } = await admin
      .from('project_checklist_log')
      .update({ completed_at: date, completed_by: profileId })
      .eq('id', existing.id)
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await admin.from('project_checklist_log').insert({
    project_id: projectId,
    checklist_item_id: checklistItemId,
    completed_at: date,
    completed_by: profileId,
  })
  if (error) throw new Error(error.message)
}

/**
 * A recurring item's date is a schedule marker only — it does NOT complete
 * the item (recurring items need their own check-off each cycle) and isn't
 * touched by completing one. One row per (project, item); setting a new date
 * overwrites it.
 */
export async function setChecklistItemScheduledDate(
  admin: SupabaseClient,
  projectId: string,
  checklistItemId: string,
  date: string,
): Promise<void> {
  const { error } = await admin.from('project_checklist_schedule').upsert(
    { project_id: projectId, checklist_item_id: checklistItemId, scheduled_date: date },
    { onConflict: 'project_id,checklist_item_id' },
  )
  if (error) throw new Error(error.message)
}

export async function clearChecklistItemScheduledDate(
  admin: SupabaseClient,
  projectId: string,
  checklistItemId: string,
): Promise<void> {
  const { error } = await admin
    .from('project_checklist_schedule')
    .delete()
    .eq('project_id', projectId)
    .eq('checklist_item_id', checklistItemId)
  if (error) throw new Error(error.message)
}

/**
 * Recurring items (both cadence types) are a running history — logging one
 * always inserts a new row, never updates an existing one.
 */
export async function logChecklistItem(
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

export async function addCustomChecklistItem(
  admin: SupabaseClient,
  projectId: string,
  name: string,
  cadenceType: 'rolling' | 'calendar_month',
  cadenceDays: number | null,
): Promise<ChecklistItemRecord> {
  const { data: existing, error: countError } = await admin
    .from('checklist_items')
    .select('sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: false })
    .limit(1)
  if (countError) throw new Error(countError.message)
  const nextSortOrder = (existing?.[0]?.sort_order ?? 100) + 1

  const { data, error } = await admin
    .from('checklist_items')
    .insert({
      phase: 'recurring',
      name,
      sort_order: nextSortOrder,
      cadence_days: cadenceType === 'rolling' ? cadenceDays : null,
      cadence_type: cadenceType,
      project_id: projectId,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as ChecklistItemRecord
}

/**
 * Removes a recurring item from one project's list: a shared default
 * (project_id is null) gets excluded for just this project; a project's own
 * custom item gets deleted outright (along with its completion history —
 * checklist_items has no ON DELETE CASCADE from project_checklist_log).
 */
export async function removeChecklistItem(
  admin: SupabaseClient,
  projectId: string,
  checklistItemId: string,
): Promise<void> {
  const { data: item, error: itemError } = await admin
    .from('checklist_items')
    .select('project_id')
    .eq('id', checklistItemId)
    .single()
  if (itemError) throw new Error(itemError.message)

  if (item.project_id === null) {
    const { error } = await admin
      .from('project_checklist_item_exclusions')
      .upsert(
        { project_id: projectId, checklist_item_id: checklistItemId },
        { onConflict: 'project_id,checklist_item_id' },
      )
    if (error) throw new Error(error.message)
    return
  }

  if (item.project_id !== projectId) {
    throw new Error('Cannot remove another project\'s custom checklist item')
  }

  const { error: logDeleteError } = await admin
    .from('project_checklist_log')
    .delete()
    .eq('checklist_item_id', checklistItemId)
  if (logDeleteError) throw new Error(logDeleteError.message)

  const { error: itemDeleteError } = await admin
    .from('checklist_items')
    .delete()
    .eq('id', checklistItemId)
    .eq('project_id', projectId)
  if (itemDeleteError) throw new Error(itemDeleteError.message)
}
