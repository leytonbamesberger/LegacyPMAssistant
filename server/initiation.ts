import { SupabaseClient } from '@supabase/supabase-js'
import type { CadenceUnit } from '../shared/period.js'
import { syncGeneratedTaskAssignees } from './generatedTasks.js'
import { insertTasks, TaskRuleError, type InsertTaskInput } from './tasks.js'
import type { ChecklistItemRecord } from './checklist.js'

/** Rejected initiation input / state (maps to a 4xx, not a server fault). */
export class InitiationError extends TaskRuleError {}

/** A wizard row: an existing catalog item (`itemId`) or a brand-new custom one (`newName`). */
interface ItemRef {
  itemId: string | null
  newName: string | null
}

export interface SetupSelection extends ItemRef {
  isComplete: boolean
  /** The project's "Setup complete by" date — every setup task's due date, meetings included. */
  dueDate: string | null
  /** Meetings only: the date the meeting is (or was) held. Entering one completes the task. */
  meetingDate: string | null
  /** Meetings only: the meeting date is still to be decided. */
  isTbd: boolean
}

export interface RecurringSelection extends ItemRef {
  startDate: string | null
  timeOfDay: string | null
  cadenceValue: number | null
  cadenceUnit: CadenceUnit | null
}

export interface InitiationPayload {
  projectId: string
  pmId: string | null
  apmId: string | null
  setup: SetupSelection[]
  recurring: RecurringSelection[]
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME_OF_DAY = /^\d{2}:\d{2}(:\d{2})?$/
const CADENCE_UNITS: readonly string[] = ['day', 'week', 'month']

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseItemRef(raw: Record<string, unknown>, where: string): ItemRef {
  const itemId = asString(raw.itemId)
  const newName = asString(raw.newName)
  if (!itemId && !newName) throw new InitiationError(`${where}: each item needs an "itemId" or a "newName"`)
  if (itemId && newName) throw new InitiationError(`${where}: an item can't have both "itemId" and "newName"`)
  return { itemId, newName }
}

function parseDate(value: unknown, where: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new InitiationError(`${where}: dates must be YYYY-MM-DD`)
  }
  return value
}

/** Shape-checks the untrusted request body; rule checks that need the catalog happen in initiateProject. */
export function parseInitiationPayload(body: unknown): InitiationPayload {
  const raw = (body ?? {}) as Record<string, unknown>
  const projectId = asString(raw.projectId)
  if (!projectId) throw new InitiationError('"projectId" (string) is required')
  if (!Array.isArray(raw.setup) || !Array.isArray(raw.recurring)) {
    throw new InitiationError('"setup" and "recurring" (arrays) are required')
  }

  for (const key of ['pmId', 'apmId'] as const) {
    if (raw[key] !== null && raw[key] !== undefined && typeof raw[key] !== 'string') {
      throw new InitiationError(`"${key}" must be a string or null`)
    }
  }

  const setup = (raw.setup as Record<string, unknown>[]).map((row, i): SetupSelection => {
    const where = `setup[${i}]`
    return {
      ...parseItemRef(row, where),
      isComplete: row.isComplete === true,
      dueDate: parseDate(row.dueDate, where),
      meetingDate: parseDate(row.meetingDate, where),
      isTbd: row.isTbd === true,
    }
  })

  const recurring = (raw.recurring as Record<string, unknown>[]).map((row, i): RecurringSelection => {
    const where = `recurring[${i}]`
    const timeOfDay = asString(row.timeOfDay)
    if (timeOfDay && !TIME_OF_DAY.test(timeOfDay)) throw new InitiationError(`${where}: "timeOfDay" must be HH:MM`)
    const cadenceValue = typeof row.cadenceValue === 'number' ? row.cadenceValue : null
    if (cadenceValue !== null && (!Number.isInteger(cadenceValue) || cadenceValue <= 0)) {
      throw new InitiationError(`${where}: "cadenceValue" must be a positive whole number`)
    }
    const cadenceUnit = asString(row.cadenceUnit)
    if (cadenceUnit && !CADENCE_UNITS.includes(cadenceUnit)) {
      throw new InitiationError(`${where}: "cadenceUnit" must be day, week, or month`)
    }
    return {
      ...parseItemRef(row, where),
      startDate: parseDate(row.startDate, where),
      timeOfDay,
      cadenceValue,
      cadenceUnit: cadenceUnit as CadenceUnit | null,
    }
  })

  return {
    projectId,
    pmId: asString(raw.pmId),
    apmId: asString(raw.apmId),
    setup,
    recurring,
  }
}

interface ResolvedItem {
  id: string | null // null until a new custom item is inserted
  name: string
  /** Meeting items (checklist_items.is_meeting) may be left TBD. */
  isMeeting: boolean
}

function resolveItems(
  refs: ItemRef[],
  phase: 'setup' | 'recurring',
  catalog: Map<string, ChecklistItemRecord>,
): ResolvedItem[] {
  const seen = new Set<string>()
  return refs.map((ref) => {
    if (!ref.itemId) return { id: null, name: ref.newName as string, isMeeting: false }
    const item = catalog.get(ref.itemId)
    if (!item || item.phase !== phase) {
      throw new InitiationError(`Unknown ${phase} checklist item "${ref.itemId}" for this project`)
    }
    if (seen.has(item.id)) throw new InitiationError(`"${item.name}" was listed twice`)
    seen.add(item.id)
    return { id: item.id, name: item.name, isMeeting: phase === 'setup' && item.is_meeting === true }
  })
}

function nextSortOrder(existing: ChecklistItemRecord[], phase: 'setup' | 'recurring'): () => number {
  let max = Math.max(100, ...existing.filter((i) => i.project_id && i.phase === phase).map((i) => i.sort_order))
  return () => ++max
}

/**
 * Finishes the wizard: records the project's checklist choices and turns each
 * included Setup / Recurring item into a task (the task IS the completion
 * record). Everything the wizard collected arrives in this one call — nothing
 * is written while the wizard is open, so abandoning it leaves no half-set-up
 * project.
 *
 * Validates everything first, then writes in an order that is safe to retry
 * after a partial failure: clear this project's earlier checklist tasks/config,
 * write exclusions/customs/config/tasks, and set `initiated = true` LAST — so a
 * failed run leaves the project uninitiated and a retry starts clean.
 */
export async function initiateProject(
  admin: SupabaseClient,
  actingProfileId: string,
  payload: InitiationPayload,
): Promise<void> {
  const { projectId } = payload

  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('id, initiated')
    .eq('id', projectId)
    .maybeSingle()
  if (projectError) throw new Error(projectError.message)
  if (!project) throw new InitiationError('Project not found', 404)
  if (project.initiated) throw new InitiationError('This project has already been initiated')

  const { data: catalogRows, error: catalogError } = await admin
    .from('checklist_items')
    .select('*')
    .in('phase', ['setup', 'recurring'])
    .or(`project_id.is.null,project_id.eq.${projectId}`)
  if (catalogError) throw new Error(catalogError.message)
  const catalogItems = (catalogRows ?? []) as ChecklistItemRecord[]
  const catalog = new Map(catalogItems.map((i) => [i.id, i]))

  // ---- validate (no writes yet) ----
  const setupItems = resolveItems(payload.setup, 'setup', catalog)
  const recurringItems = resolveItems(payload.recurring, 'recurring', catalog)

  payload.setup.forEach((sel, i) => {
    const item = setupItems[i]
    if (item.isMeeting) {
      // A meeting needs ONE of: a meeting date, TBD, or Done. A date completes it.
      if (sel.isTbd && sel.meetingDate) {
        throw new InitiationError(`"${item.name}": TBD and a meeting date can't both be set`)
      }
      const complete = sel.isComplete || !!sel.meetingDate
      if (!complete && !sel.isTbd) {
        throw new InitiationError(`"${item.name}" needs a meeting date, TBD, or to be marked done`)
      }
      // Still open (TBD) -> it carries the setup due date like every other open setup item.
      if (!complete && !sel.dueDate) {
        throw new InitiationError(`"${item.name}" needs the setup due date ("Setup complete by")`)
      }
    } else {
      if (sel.isTbd) {
        throw new InitiationError(`"${item.name}" needs a due date or to be marked done — only meeting items can be TBD`)
      }
      if (sel.meetingDate) {
        throw new InitiationError(`"${item.name}": only meeting items have a meeting date`)
      }
      // An item already Done needs no date; anything else must say when it's due.
      if (!sel.dueDate && !sel.isComplete) {
        throw new InitiationError(`"${item.name}" needs a due date or to be marked done`)
      }
    }
  })
  payload.recurring.forEach((sel, i) => {
    const item = recurringItems[i]
    if (!sel.startDate || !sel.cadenceValue || !sel.cadenceUnit) {
      throw new InitiationError(`"${item.name}" needs a start date and a cadence`)
    }
  })

  // ---- write ----
  const assigneeIds = [payload.pmId, payload.apmId].filter((id): id is string => !!id)

  // 1. Clear any earlier (failed) attempt's checklist tasks + config. Flow tasks are untouched.
  const { error: clearTasksError } = await admin
    .from('tasks')
    .delete()
    .eq('project_id', projectId)
    .in('source_category', ['setup', 'recurring'])
  if (clearTasksError) throw new Error(clearTasksError.message)
  const { error: clearConfigError } = await admin
    .from('project_checklist_item_config')
    .delete()
    .eq('project_id', projectId)
  if (clearConfigError) throw new Error(clearConfigError.message)

  // 2. PM/APM as confirmed in the last step.
  const { error: assignError } = await admin
    .from('projects')
    .update({ pm_id: payload.pmId, apm_id: payload.apmId })
    .eq('id', projectId)
  if (assignError) throw new Error(assignError.message)

  // 3. Exclusions: every shared default (Setup + Recurring) the wizard didn't keep.
  const includedIds = new Set([...setupItems, ...recurringItems].map((i) => i.id).filter(Boolean) as string[])
  const defaultIds = catalogItems.filter((i) => i.project_id === null).map((i) => i.id)
  if (defaultIds.length > 0) {
    const { error } = await admin
      .from('project_checklist_item_exclusions')
      .delete()
      .eq('project_id', projectId)
      .in('checklist_item_id', defaultIds)
    if (error) throw new Error(error.message)
  }
  const excludedRows = defaultIds
    .filter((id) => !includedIds.has(id))
    .map((checklist_item_id) => ({ project_id: projectId, checklist_item_id }))
  if (excludedRows.length > 0) {
    const { error } = await admin.from('project_checklist_item_exclusions').insert(excludedRows)
    if (error) throw new Error(error.message)
  }

  // 4. Custom items: drop this project's own customs the wizard removed, insert the new ones.
  const removedCustomIds = catalogItems
    .filter((i) => i.project_id === projectId && !includedIds.has(i.id))
    .map((i) => i.id)
  if (removedCustomIds.length > 0) {
    const { error } = await admin.from('checklist_items').delete().in('id', removedCustomIds)
    if (error) throw new Error(error.message)
  }

  const newCustoms: { phase: 'setup' | 'recurring'; item: ResolvedItem }[] = [
    ...setupItems.filter((i) => !i.id).map((item) => ({ phase: 'setup' as const, item })),
    ...recurringItems.filter((i) => !i.id).map((item) => ({ phase: 'recurring' as const, item })),
  ]
  if (newCustoms.length > 0) {
    const nextSetup = nextSortOrder(catalogItems, 'setup')
    const nextRecurring = nextSortOrder(catalogItems, 'recurring')
    const { data: inserted, error } = await admin
      .from('checklist_items')
      .insert(
        newCustoms.map(({ phase, item }) => ({
          phase,
          name: item.name,
          sort_order: phase === 'setup' ? nextSetup() : nextRecurring(),
          cadence_days: null,
          cadence_type: phase === 'recurring' ? 'rolling' : null,
          project_id: projectId,
        })),
      )
      .select('id')
    if (error) throw new Error(error.message)
    newCustoms.forEach(({ item }, i) => {
      item.id = (inserted ?? [])[i].id as string
    })
  }

  // 5. Config rows + one task per included item.
  const taskBase = {
    type: 'project' as const,
    projectId,
    assignedBy: actingProfileId,
    assigneeIds,
    visibility: 'public' as const,
  }
  // Every row carries every column. supabase-js turns a bulk insert's missing keys into explicit
  // NULLs (not column defaults), so a row that omitted `is_tbd` would violate its NOT NULL.
  const configRow = (
    checklistItemId: string,
    fields: Partial<{
      due_date: string | null
      is_tbd: boolean
      cadence_value: number | null
      cadence_unit: string | null
      start_date: string | null
      time_of_day: string | null
    }>,
  ) => ({
    project_id: projectId,
    checklist_item_id: checklistItemId,
    due_date: null,
    is_tbd: false,
    cadence_value: null,
    cadence_unit: null,
    start_date: null,
    time_of_day: null,
    ...fields,
  })
  const configRows: ReturnType<typeof configRow>[] = []
  const tasks: InsertTaskInput[] = []

  payload.setup.forEach((sel, i) => {
    const item = setupItems[i]
    // Every setup task, meetings included, is due on the project's "Setup complete by" date (null when
    // that was left blank because everything is complete). A meeting date is separate and completes it.
    const meetingDate = item.isMeeting ? sel.meetingDate : null
    const complete = sel.isComplete || meetingDate !== null
    // A TBD meeting is open with no date; it's recorded on the config row (tasks.is_tbd stays false so
    // the Tasks page shows the setup due date, not "TBD").
    const meetingTbd = item.isMeeting && sel.isTbd && !complete
    configRows.push(configRow(item.id as string, { due_date: sel.dueDate, is_tbd: meetingTbd }))
    tasks.push({
      ...taskBase,
      title: item.name,
      dueDate: sel.dueDate,
      meetingDate,
      status: complete ? 'complete' : 'not_started',
      checklistItemId: item.id,
      sourceCategory: 'setup',
    })
  })

  payload.recurring.forEach((sel, i) => {
    const item = recurringItems[i]
    configRows.push(
      configRow(item.id as string, {
        due_date: sel.startDate,
        start_date: sel.startDate,
        time_of_day: sel.timeOfDay,
        cadence_value: sel.cadenceValue,
        cadence_unit: sel.cadenceUnit,
      }),
    )
    tasks.push({
      ...taskBase,
      title: item.name,
      dueDate: sel.startDate,
      dueTime: sel.timeOfDay,
      isRecurring: true,
      cadenceValue: sel.cadenceValue,
      cadenceUnit: sel.cadenceUnit,
      checklistItemId: item.id,
      sourceCategory: 'recurring',
    })
  })

  if (configRows.length > 0) {
    const { error } = await admin.from('project_checklist_item_config').insert(configRows)
    if (error) throw new Error(error.message)
  }
  await insertTasks(admin, tasks)

  // 6. Last: flipping this is what hides the "Initiate Project" entry.
  const { error: initiatedError } = await admin.from('projects').update({ initiated: true }).eq('id', projectId)
  if (initiatedError) throw new Error(initiatedError.message)

  // The standing flow task follows the PM/APM just confirmed. Best-effort — the project is already initiated.
  try {
    await syncGeneratedTaskAssignees(admin, projectId)
  } catch (err) {
    console.warn('[initiation] could not re-sync flow task assignees:', err)
  }
}
