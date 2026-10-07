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
import { insertTasks } from './tasks.js'

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

export interface ProjectEditCatalog {
  project: {
    id: string
    initiated: boolean
    status: 'active' | 'closing' | 'closed'
    pm_id: string | null
    apm_id: string | null
  }
  items: EditCatalogItem[]
  /** The project's existing open Setup due date ("Setup complete by"), to prefill added Setup items. */
  setupDueDate: string | null
  closeout: CloseoutCatalogItem[]
}

interface ChecklistTaskRow {
  checklist_item_id: string
  status: string
  source_category: string
  due_date: string | null
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
        .select('checklist_item_id, status, source_category, due_date')
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

  return { project, items, setupDueDate: openSetupDates[0] ?? null, closeout }
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
  return { projectId, pmId: person('pmId'), apmId: person('apmId'), removeItemIds, addSetup, addRecurring }
}

/**
 * Applies an Edit Project submission:
 *  - PM / APM: updates the project and swaps the old people for the new on its OPEN setup / recurring /
 *    closeout tasks (completed tasks are never touched).
 *  - removed items: Setup items whose task is complete are refused; the rest get an exclusion and lose
 *    their open task(s); a recurring item then can't spawn another instance.
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
  const wantsItems = payload.removeItemIds.length + payload.addSetup.length + payload.addRecurring.length > 0
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

  // ---- write ----
  const personFields: { pm_id?: string | null; apm_id?: string | null } = {}
  if (payload.pmId !== undefined) personFields.pm_id = payload.pmId
  if (payload.apmId !== undefined) personFields.apm_id = payload.apmId
  if (Object.keys(personFields).length > 0) {
    const { error } = await admin.from('projects').update(personFields).eq('id', projectId)
    if (error) throw new Error(error.message)
  }

  await excludeItems(admin, projectId, toRemove)

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
