import { SupabaseClient } from '@supabase/supabase-js'
import { syncGeneratedTaskAssignees } from './generatedTasks.js'
import type { ChecklistItemRecord } from './checklist.js'
import {
  asString,
  buildChecklistRows,
  checkRecurringSelections,
  checkSetupSelections,
  InitiationError,
  parseDate,
  parseRecurringSelections,
  parseSetupSelections,
  resolveItems,
  type RecurringSelection,
  type ResolvedItem,
  type SetupSelection,
} from './initiation.js'
import { selectAll } from './selectAll.js'
import { insertTasks, isRealDate, meetingDateFields } from './tasks.js'
import type { CadenceUnit } from '../shared/period.js'

/**
 * Edit Project and Closeout Project: changes to a project AFTER it was initiated. Both follow the
 * initiation wizard's rules (same validation, same task shape), and both validate everything before
 * they write anything.
 */

// ---------------------------------------------------------------------------------------------
// Catalog (what the Edit and Closeout modals show)
// ---------------------------------------------------------------------------------------------

export interface EditCatalogItem extends ChecklistItemRecord {
  /**
   * included = the project has a task for it now; excluded = the project hid it; new = neither (an
   * item added to the catalog after this project was initiated).
   */
  state: 'included' | 'excluded' | 'new'
  /** A Setup item whose task is already complete — it can't be removed. */
  locked: boolean
}

export interface CloseoutCatalogItem {
  id: string
  name: string
  sort_order: number
  /** The project already has a closeout task for it. */
  selected: boolean
  /** That task is complete — it can't be removed. */
  locked: boolean
  dueDate: string | null
}

/** What the Edit modal's Dates tab shows and can change (see EditDatesPayload). */
export interface EditDatesCatalog {
  /** One row per meeting task — editable even when complete. */
  meetings: { taskId: string; itemId: string; name: string; complete: boolean; dueDate: string | null; meetingDate: string | null }[]
  /** One row per included recurring item: its current (earliest) open instance. */
  recurring: {
    taskId: string
    itemId: string
    name: string
    dueDate: string | null
    cadenceValue: number
    cadenceUnit: CadenceUnit
  }[]
  /** One row per closeout task (only once closeout has started); complete ones are read-only. */
  closeout: { taskId: string; itemId: string; name: string; complete: boolean; dueDate: string | null }[]
}

export interface ProjectEditCatalog {
  project: {
    id: string
    initiated: boolean
    status: 'active' | 'closing' | 'closed'
    pm_id: string | null
    apm_id: string | null
  }
  items: EditCatalogItem[]
  /**
   * The project's existing open Setup due date ("Setup complete by"): prefills added Setup items and is
   * the Dates tab's field. null = no open Setup tasks (the field is hidden).
   */
  setupDueDate: string | null
  closeout: CloseoutCatalogItem[]
  dates: EditDatesCatalog
}

interface ChecklistTaskRow {
  id: string
  checklist_item_id: string
  status: string
  source_category: string
  due_date: string | null
  meeting_date: string | null
  cadence_value: number | null
  cadence_unit: CadenceUnit | null
}

async function loadProject(admin: SupabaseClient, projectId: string) {
  const { data, error } = await admin
    .from('projects')
    .select('id, initiated, status, pm_id, apm_id')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new InitiationError('Project not found', 404)
  return data as ProjectEditCatalog['project']
}

async function loadChecklistTasks(admin: SupabaseClient, projectId: string): Promise<ChecklistTaskRow[]> {
  return selectAll<ChecklistTaskRow>(
    () =>
      admin
        .from('tasks')
        .select('id, checklist_item_id, status, source_category, due_date, meeting_date, cadence_value, cadence_unit')
        .eq('project_id', projectId)
        .not('checklist_item_id', 'is', null)
        .order('id') as never,
  )
}

export async function getProjectEditCatalog(admin: SupabaseClient, projectId: string): Promise<ProjectEditCatalog> {
  const project = await loadProject(admin, projectId)
  const [itemsResult, exclusionsResult, tasks] = await Promise.all([
    admin
      .from('checklist_items')
      .select('*')
      .in('phase', ['setup', 'recurring', 'closeout'])
      .or(`project_id.is.null,project_id.eq.${projectId}`)
      .order('phase', { ascending: false }) // setup, recurring, closeout -> reverse-alpha puts 'setup' first
      .order('sort_order'),
    admin.from('project_checklist_item_exclusions').select('checklist_item_id').eq('project_id', projectId),
    loadChecklistTasks(admin, projectId),
  ])
  if (itemsResult.error) throw new Error(itemsResult.error.message)
  if (exclusionsResult.error) throw new Error(exclusionsResult.error.message)

  const all = (itemsResult.data ?? []) as ChecklistItemRecord[]
  const excluded = new Set((exclusionsResult.data ?? []).map((r) => r.checklist_item_id as string))
  const tasksOf = (itemId: string, category: string) =>
    tasks.filter((t) => t.checklist_item_id === itemId && t.source_category === category)

  const items: EditCatalogItem[] = all
    .filter((i) => i.phase === 'setup' || i.phase === 'recurring')
    .map((item) => {
      const mine = tasksOf(item.id, item.phase)
      const state: EditCatalogItem['state'] =
        item.phase === 'setup'
          ? mine.length > 0
            ? 'included'
            : excluded.has(item.id)
              ? 'excluded'
              : 'new'
          : mine.some((t) => t.status !== 'complete')
            ? 'included'
            : excluded.has(item.id)
              ? 'excluded'
              : 'new'
      return { ...item, state, locked: item.phase === 'setup' && mine.some((t) => t.status === 'complete') }
    })
    // setup before recurring, each by sort_order
    .sort((a, b) => (a.phase === b.phase ? a.sort_order - b.sort_order : a.phase === 'setup' ? -1 : 1))

  const openSetupDates = tasks
    .filter((t) => t.source_category === 'setup' && t.status !== 'complete' && t.due_date)
    .map((t) => t.due_date as string)
    .sort()

  const closeout: CloseoutCatalogItem[] = all
    .filter((i) => i.phase === 'closeout' && i.project_id === null)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => {
      const mine = tasksOf(item.id, 'closeout')
      const open = mine.find((t) => t.status !== 'complete')
      const done = mine.find((t) => t.status === 'complete')
      return {
        id: item.id,
        name: item.name,
        sort_order: item.sort_order,
        selected: mine.length > 0,
        locked: !open && !!done,
        dueDate: (open ?? done)?.due_date ?? null,
      }
    })

  const byOrder = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order
  const dates: EditDatesCatalog = {
    meetings: all
      .filter((i) => i.phase === 'setup' && i.is_meeting)
      .sort(byOrder)
      .flatMap((item) => {
        const task = tasksOf(item.id, 'setup')[0]
        return task
          ? [{
              taskId: task.id,
              itemId: item.id,
              name: item.name,
              complete: task.status === 'complete',
              dueDate: task.due_date,
              meetingDate: task.meeting_date,
            }]
          : []
      }),
    recurring: all
      .filter((i) => i.phase === 'recurring')
      .sort(byOrder)
      .flatMap((item) => {
        // The current instance is the earliest open one (a new cycle only exists once the last is done).
        const current = tasksOf(item.id, 'recurring')
          .filter((t) => t.status !== 'complete')
          .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))[0]
        return current && current.cadence_value && current.cadence_unit
          ? [{
              taskId: current.id,
              itemId: item.id,
              name: item.name,
              dueDate: current.due_date,
              cadenceValue: current.cadence_value,
              cadenceUnit: current.cadence_unit,
            }]
          : []
      }),
    closeout: all
      .filter((i) => i.phase === 'closeout' && i.project_id === null)
      .sort(byOrder)
      .flatMap((item) => {
        const mine = tasksOf(item.id, 'closeout')
        const task = mine.find((t) => t.status !== 'complete') ?? mine[0]
        return task
          ? [{ taskId: task.id, itemId: item.id, name: item.name, complete: task.status === 'complete', dueDate: task.due_date }]
          : []
      }),
  }

  return { project, items, setupDueDate: openSetupDates[0] ?? null, closeout, dates }
}

// ---------------------------------------------------------------------------------------------
// Shared writes
// ---------------------------------------------------------------------------------------------

/**
 * Takes items off a project: records an exclusion (a "Recurring" one is what stops future instances —
 * completing an instance never spawns the next one for an excluded item, see spawnNextRecurrence),
 * deletes the items' OPEN tasks, and drops their saved config. Completed tasks are history and stay.
 */
async function excludeItems(admin: SupabaseClient, projectId: string, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return
  const { error: exclusionError } = await admin
    .from('project_checklist_item_exclusions')
    .upsert(
      itemIds.map((checklist_item_id) => ({ project_id: projectId, checklist_item_id })),
      { onConflict: 'project_id,checklist_item_id', ignoreDuplicates: true },
    )
  if (exclusionError) throw new Error(exclusionError.message)

  const { error: taskError } = await admin
    .from('tasks')
    .delete()
    .eq('project_id', projectId)
    .in('checklist_item_id', itemIds)
    .in('source_category', ['setup', 'recurring'])
    .neq('status', 'complete')
  if (taskError) throw new Error(taskError.message)

  const { error: configError } = await admin
    .from('project_checklist_item_config')
    .delete()
    .eq('project_id', projectId)
    .in('checklist_item_id', itemIds)
  if (configError) throw new Error(configError.message)
}

async function currentAssignees(admin: SupabaseClient, projectId: string): Promise<string[]> {
  const project = await loadProject(admin, projectId)
  return [project.pm_id, project.apm_id].filter((id): id is string => !!id)
}

// ---------------------------------------------------------------------------------------------
// Edit Project
// ---------------------------------------------------------------------------------------------

/** Date changes from the Dates tab. Only what changed is sent; every list may be empty. */
export interface EditDatesPayload {
  /** New due date for every open Setup task (meetings included). */
  setupDueDate?: string
  /** A meeting's date: set completes it, null reopens it. */
  meetings: { taskId: string; meetingDate: string | null }[]
  /** A recurring item's current open instance: its next due date and/or its cadence. */
  recurring: { taskId: string; dueDate?: string; cadenceValue?: number; cadenceUnit?: CadenceUnit }[]
  /** Open closeout tasks' due dates. */
  closeout: { taskId: string; dueDate: string }[]
}

export interface EditProjectPayload {
  projectId: string
  /** Undefined = leave as is; null = clear. */
  pmId: string | null | undefined
  apmId: string | null | undefined
  /** Included items to take off the project. */
  removeItemIds: string[]
  /** Newly (re)included items with what the wizard would have asked for them. */
  addSetup: SetupSelection[]
  addRecurring: RecurringSelection[]
  dates: EditDatesPayload
}

function parseDatesPayload(value: unknown): EditDatesPayload {
  const raw = (value ?? {}) as Record<string, unknown>
  const rows = (key: string): Record<string, unknown>[] => {
    if (raw[key] === undefined) return []
    if (!Array.isArray(raw[key])) throw new InitiationError(`"dates.${key}" must be an array`)
    return raw[key] as Record<string, unknown>[]
  }
  const realDate = (v: unknown, where: string): string => {
    if (typeof v !== 'string' || !isRealDate(v)) throw new InitiationError(`${where}: must be a real date (YYYY-MM-DD)`)
    return v
  }
  const taskId = (row: Record<string, unknown>, where: string): string => {
    const id = asString(row?.taskId)
    if (!id) throw new InitiationError(`${where}: "taskId" is required`)
    return id
  }

  const setupDueDate = raw.setupDueDate === undefined ? undefined : realDate(raw.setupDueDate, 'dates.setupDueDate')
  const meetings = rows('meetings').map((row, i) => ({
    taskId: taskId(row, `dates.meetings[${i}]`),
    meetingDate: row.meetingDate === null ? null : realDate(row.meetingDate, `dates.meetings[${i}].meetingDate`),
  }))
  const recurring = rows('recurring').map((row, i) => {
    const where = `dates.recurring[${i}]`
    const out: EditDatesPayload['recurring'][number] = { taskId: taskId(row, where) }
    if (row.dueDate !== undefined) out.dueDate = realDate(row.dueDate, `${where}.dueDate`)
    if (row.cadenceValue !== undefined || row.cadenceUnit !== undefined) {
      const { cadenceValue, cadenceUnit } = row
      if (typeof cadenceValue !== 'number' || !Number.isInteger(cadenceValue) || cadenceValue <= 0) {
        throw new InitiationError(`${where}: the cadence must be a positive whole number`)
      }
      if (cadenceUnit !== 'day' && cadenceUnit !== 'week' && cadenceUnit !== 'month') {
        throw new InitiationError(`${where}: "cadenceUnit" must be day, week, or month`)
      }
      out.cadenceValue = cadenceValue
      out.cadenceUnit = cadenceUnit
    }
    return out
  })
  const closeout = rows('closeout').map((row, i) => ({
    taskId: taskId(row, `dates.closeout[${i}]`),
    dueDate: realDate(row.dueDate, `dates.closeout[${i}].dueDate`),
  }))
  return { setupDueDate, meetings, recurring, closeout }
}

function hasDateEdits(d: EditDatesPayload): boolean {
  return d.setupDueDate !== undefined || d.meetings.length + d.recurring.length + d.closeout.length > 0
}

export function parseEditPayload(body: unknown): EditProjectPayload {
  const raw = (body ?? {}) as Record<string, unknown>
  const projectId = asString(raw.projectId)
  if (!projectId) throw new InitiationError('"projectId" (string) is required')

  const person = (key: 'pmId' | 'apmId'): string | null | undefined => {
    if (!(key in raw)) return undefined
    if (raw[key] !== null && typeof raw[key] !== 'string') throw new InitiationError(`"${key}" must be a string or null`)
    return asString(raw[key])
  }
  const list = (key: string): unknown[] => {
    if (raw[key] === undefined) return []
    if (!Array.isArray(raw[key])) throw new InitiationError(`"${key}" must be an array`)
    return raw[key] as unknown[]
  }
  const removeItemIds = list('removeItemIds').map((id) => {
    if (typeof id !== 'string') throw new InitiationError('"removeItemIds" must be strings')
    return id
  })
  const addSetup = parseSetupSelections(list('addSetup'))
  const addRecurring = parseRecurringSelections(list('addRecurring'))
  if ([...addSetup, ...addRecurring].some((s) => !s.itemId)) {
    throw new InitiationError('Only existing checklist items can be added to a project here')
  }
  return {
    projectId,
    pmId: person('pmId'),
    apmId: person('apmId'),
    removeItemIds,
    addSetup,
    addRecurring,
    dates: parseDatesPayload(raw.dates),
  }
}

/**
 * Writes the Dates tab's changes. Only rows whose value really differs are written; completed tasks are
 * never touched (except a meeting's date, which also moves a completed meeting). `removedItemIds` are the
 * items this same edit takes off the project — their tasks are gone, so their date edits are skipped.
 */
async function applyDateEdits(
  admin: SupabaseClient,
  projectId: string,
  dates: EditDatesPayload,
  current: EditDatesCatalog,
  removedItemIds: Set<string>,
): Promise<void> {
  const update = async (taskId: string, fields: Record<string, unknown>) => {
    const { error } = await admin.from('tasks').update(fields).eq('id', taskId)
    if (error) throw new Error(error.message)
  }

  if (dates.setupDueDate !== undefined) {
    const { error } = await admin
      .from('tasks')
      .update({ due_date: dates.setupDueDate })
      .eq('project_id', projectId)
      .eq('source_category', 'setup')
      .neq('status', 'complete')
      .or(`due_date.is.null,due_date.neq.${dates.setupDueDate}`)
    if (error) throw new Error(error.message)
  }

  const meetingsById = new Map(current.meetings.map((m) => [m.taskId, m]))
  const changedMeetings = dates.meetings.filter((m) => {
    const was = meetingsById.get(m.taskId)
    return was && !removedItemIds.has(was.itemId) && was.meetingDate !== m.meetingDate
  })
  if (changedMeetings.length > 0) {
    const { data, error } = await admin
      .from('tasks')
      .select('id, completed_at')
      .in('id', changedMeetings.map((m) => m.taskId))
    if (error) throw new Error(error.message)
    const completedAt = new Map((data ?? []).map((r) => [r.id as string, r.completed_at as string | null]))
    for (const m of changedMeetings) {
      await update(m.taskId, meetingDateFields(m.meetingDate, completedAt.get(m.taskId) ?? null))
    }
  }

  const recurringById = new Map(current.recurring.map((r) => [r.taskId, r]))
  for (const edit of dates.recurring) {
    const was = recurringById.get(edit.taskId)
    if (!was || removedItemIds.has(was.itemId)) continue
    const fields: Record<string, unknown> = {}
    if (edit.dueDate !== undefined && edit.dueDate !== was.dueDate) fields.due_date = edit.dueDate
    const cadenceChanged =
      edit.cadenceValue !== undefined && (edit.cadenceValue !== was.cadenceValue || edit.cadenceUnit !== was.cadenceUnit)
    if (cadenceChanged) {
      fields.cadence_value = edit.cadenceValue
      fields.cadence_unit = edit.cadenceUnit
    }
    if (Object.keys(fields).length > 0) await update(edit.taskId, fields)
    if (cadenceChanged) {
      // Keep the saved config in step with the live task (it's what the item started from).
      const { error } = await admin
        .from('project_checklist_item_config')
        .upsert(
          {
            project_id: projectId,
            checklist_item_id: was.itemId,
            cadence_value: edit.cadenceValue,
            cadence_unit: edit.cadenceUnit,
          },
          { onConflict: 'project_id,checklist_item_id' },
        )
      if (error) throw new Error(error.message)
    }
  }

  const closeoutById = new Map(current.closeout.map((c) => [c.taskId, c]))
  for (const edit of dates.closeout) {
    const was = closeoutById.get(edit.taskId)
    if (was && was.dueDate !== edit.dueDate) await update(edit.taskId, { due_date: edit.dueDate })
  }
}

/**
 * Applies an Edit Project submission:
 *  - PM / APM: updates the project and swaps the old people for the new on its OPEN setup / recurring /
 *    closeout tasks (completed tasks are never touched).
 *  - removed items: Setup items whose task is complete are refused; the rest get an exclusion and lose
 *    their open task(s); a recurring item then can't spawn another instance.
 *  - dates: re-dates the open Setup tasks, sets / clears meeting dates, moves a recurring item's open
 *    instance and cadence, and moves open closeout tasks (see applyDateEdits).
 *  - added items: any exclusion is lifted and the task(s) are created exactly as initiation does, for
 *    the project's current PM/APM, with the editing user as `assigned_by`.
 * An uninitiated project can only have its PM / APM changed.
 */
export async function editProject(
  admin: SupabaseClient,
  actingProfileId: string,
  payload: EditProjectPayload,
): Promise<{ added: number; removed: number }> {
  const { projectId } = payload
  const project = await loadProject(admin, projectId)
  const wantsItems =
    payload.removeItemIds.length + payload.addSetup.length + payload.addRecurring.length > 0 ||
    hasDateEdits(payload.dates)
  if (!project.initiated && wantsItems) {
    throw new InitiationError('This project has not been initiated yet — only its PM and APM can be changed')
  }

  // ---- validate (no writes yet) ----
  const catalog = await getProjectEditCatalog(admin, projectId)
  const byId = new Map(catalog.items.map((i) => [i.id, i]))

  const removeIds = [...new Set(payload.removeItemIds)]
  for (const id of removeIds) {
    const item = byId.get(id)
    if (!item) throw new InitiationError(`Unknown checklist item "${id}" for this project`)
    if (item.locked) throw new InitiationError(`"${item.name}" is already complete and can't be removed`)
  }
  const toRemove = removeIds.filter((id) => byId.get(id)?.state === 'included')

  const catalogMap = new Map(catalog.items.map((i) => [i.id, i as ChecklistItemRecord]))
  const setupItems = resolveItems(payload.addSetup, 'setup', catalogMap)
  const recurringItems = resolveItems(payload.addRecurring, 'recurring', catalogMap)
  for (const item of [...setupItems, ...recurringItems]) {
    const found = byId.get(item.id as string)
    if (found?.state === 'included') throw new InitiationError(`"${item.name}" is already on this project`)
    if (found?.locked) throw new InitiationError(`"${item.name}" is already complete`)
    if (removeIds.includes(item.id as string)) throw new InitiationError(`"${item.name}" can't be removed and added at once`)
  }
  checkSetupSelections(setupItems, payload.addSetup)
  checkRecurringSelections(recurringItems, payload.addRecurring)

  // Date edits may only target this project's own tasks that the Dates tab can edit.
  const { dates } = payload
  if (dates.setupDueDate !== undefined && catalog.setupDueDate === null) {
    throw new InitiationError('This project has no open Setup tasks to re-date')
  }
  const knownMeetings = new Set(catalog.dates.meetings.map((m) => m.taskId))
  const knownRecurring = new Set(catalog.dates.recurring.map((r) => r.taskId))
  const editableCloseout = new Set(catalog.dates.closeout.filter((c) => !c.complete).map((c) => c.taskId))
  if (dates.meetings.some((m) => !knownMeetings.has(m.taskId))) {
    throw new InitiationError('A meeting in this edit does not belong to this project')
  }
  if (dates.recurring.some((r) => !knownRecurring.has(r.taskId))) {
    throw new InitiationError('A recurring item in this edit is not open on this project')
  }
  if (dates.closeout.some((c) => !editableCloseout.has(c.taskId))) {
    throw new InitiationError('A closeout task in this edit is complete or does not belong to this project')
  }

  // ---- write ----
  const personFields: { pm_id?: string | null; apm_id?: string | null } = {}
  if (payload.pmId !== undefined) personFields.pm_id = payload.pmId
  if (payload.apmId !== undefined) personFields.apm_id = payload.apmId
  if (Object.keys(personFields).length > 0) {
    const { error } = await admin.from('projects').update(personFields).eq('id', projectId)
    if (error) throw new Error(error.message)
  }

  await excludeItems(admin, projectId, toRemove)

  // Before the additions below, so "Setup complete by" re-dates only the tasks that were already open.
  await applyDateEdits(admin, projectId, dates, catalog.dates, new Set(toRemove))

  const addIds = [...setupItems, ...recurringItems].map((i) => i.id as string)
  if (addIds.length > 0) {
    const { error: liftError } = await admin
      .from('project_checklist_item_exclusions')
      .delete()
      .eq('project_id', projectId)
      .in('checklist_item_id', addIds)
    if (liftError) throw new Error(liftError.message)
    const { error: staleConfigError } = await admin
      .from('project_checklist_item_config')
      .delete()
      .eq('project_id', projectId)
      .in('checklist_item_id', addIds)
    if (staleConfigError) throw new Error(staleConfigError.message)

    const { configRows, tasks } = buildChecklistRows({
      projectId,
      actingProfileId,
      assigneeIds: await currentAssignees(admin, projectId),
      setup: payload.addSetup.map((sel, i) => ({ item: setupItems[i] as ResolvedItem & { id: string }, sel })),
      recurring: payload.addRecurring.map((sel, i) => ({ item: recurringItems[i] as ResolvedItem & { id: string }, sel })),
    })
    const { error: configError } = await admin.from('project_checklist_item_config').insert(configRows)
    if (configError) throw new Error(configError.message)
    await insertTasks(admin, tasks)
  }

  // Open generated tasks follow the (possibly new) PM/APM. Best-effort like the other callers: the edit is saved.
  if (Object.keys(personFields).length > 0) {
    try {
      await syncGeneratedTaskAssignees(admin, projectId)
    } catch (err) {
      console.warn('[projectEdit] could not re-sync task assignees after the PM/APM change:', err)
    }
  }
  return { added: addIds.length, removed: toRemove.length }
}

// ---------------------------------------------------------------------------------------------
// Closeout Project
// ---------------------------------------------------------------------------------------------

export interface CloseoutPayload {
  projectId: string
  /** The closeout items that apply, each with its own due date. */
  items: { itemId: string; dueDate: string }[]
  /** Only honoured the first time (while the project isn't 'closing' yet). */
  stopRecurring: boolean
}

export function parseCloseoutPayload(body: unknown): CloseoutPayload {
  const raw = (body ?? {}) as Record<string, unknown>
  const projectId = asString(raw.projectId)
  if (!projectId) throw new InitiationError('"projectId" (string) is required')
  if (!Array.isArray(raw.items)) throw new InitiationError('"items" (array) is required')
  const items = (raw.items as Record<string, unknown>[]).map((row, i) => {
    const itemId = asString(row?.itemId)
    if (!itemId) throw new InitiationError(`items[${i}]: "itemId" is required`)
    const dueDate = parseDate(row.dueDate, `items[${i}]`)
    if (!dueDate) throw new InitiationError(`items[${i}]: each closeout item needs a due date`)
    return { itemId, dueDate }
  })
  return { projectId, items, stopRecurring: raw.stopRecurring === true }
}

/**
 * Closes a project out (it stays in the app; nothing is removed from Procore or the database):
 *  - one `closeout` task per chosen item (PM/APM assigned, `assigned_by` = the user, the chosen due date);
 *    re-opening this later reconciles instead of duplicating — a complete closeout task is locked, an open
 *    one gets its due date updated, and an open one left unchecked is deleted;
 *  - first time only, optionally stops the project's recurring tasks (exclusion + open instances deleted;
 *    completed history stays). Setup tasks and FLOW are never affected;
 *  - sets projects.status = 'closing' — LAST, so a failed attempt can be retried with the same options.
 */
export async function closeoutProject(
  admin: SupabaseClient,
  actingProfileId: string,
  payload: CloseoutPayload,
): Promise<{ created: number; updated: number; removed: number; stoppedRecurring: boolean }> {
  const { projectId } = payload
  const catalog = await getProjectEditCatalog(admin, projectId)
  if (!catalog.project.initiated) throw new InitiationError('Initiate this project before closing it out')

  // ---- validate ----
  const closeoutById = new Map(catalog.closeout.map((c) => [c.id, c]))
  const seen = new Set<string>()
  for (const { itemId } of payload.items) {
    if (!closeoutById.has(itemId)) throw new InitiationError(`Unknown closeout item "${itemId}"`)
    if (seen.has(itemId)) throw new InitiationError('A closeout item was listed twice')
    seen.add(itemId)
  }

  const tasks = await selectAll<{ id: string; checklist_item_id: string; status: string; due_date: string | null }>(
    () =>
      admin
        .from('tasks')
        .select('id, checklist_item_id, status, due_date')
        .eq('project_id', projectId)
        .eq('source_category', 'closeout')
        .order('id') as never,
  )

  // ---- write ----
  const toCreate = payload.items.filter(({ itemId }) => !tasks.some((t) => t.checklist_item_id === itemId))
  const toUpdate = payload.items.flatMap(({ itemId, dueDate }) => {
    const open = tasks.find((t) => t.checklist_item_id === itemId && t.status !== 'complete')
    return open && open.due_date !== dueDate ? [{ id: open.id, dueDate }] : []
  })
  // Open closeout tasks the user unchecked go away; complete ones stay (locked).
  const toDelete = tasks.filter((t) => t.status !== 'complete' && !seen.has(t.checklist_item_id)).map((t) => t.id)

  if (toCreate.length > 0) {
    const assigneeIds = await currentAssignees(admin, projectId)
    await insertTasks(
      admin,
      toCreate.map(({ itemId, dueDate }) => ({
        type: 'project' as const,
        projectId,
        title: closeoutById.get(itemId)?.name as string,
        dueDate,
        status: 'not_started' as const,
        assignedBy: actingProfileId,
        assigneeIds,
        visibility: 'public' as const,
        checklistItemId: itemId,
        sourceCategory: 'closeout' as const,
      })),
    )
  }
  for (const { id, dueDate } of toUpdate) {
    const { error } = await admin.from('tasks').update({ due_date: dueDate }).eq('id', id)
    if (error) throw new Error(error.message)
  }
  if (toDelete.length > 0) {
    const { error } = await admin.from('tasks').delete().in('id', toDelete)
    if (error) throw new Error(error.message)
  }

  // First time = the project is still 'active'. A 'closing' one is being re-opened; a 'closed' one stays closed.
  const firstTime = catalog.project.status === 'active'
  const stopRecurring = payload.stopRecurring && firstTime
  if (stopRecurring) {
    await excludeItems(
      admin,
      projectId,
      catalog.items.filter((i) => i.phase === 'recurring').map((i) => i.id),
    )
  }

  if (firstTime) {
    const { error } = await admin.from('projects').update({ status: 'closing' }).eq('id', projectId)
    if (error) throw new Error(error.message)
  }
  return { created: toCreate.length, updated: toUpdate.length, removed: toDelete.length, stoppedRecurring: stopRecurring }
}
