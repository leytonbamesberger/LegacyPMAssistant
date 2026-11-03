import { SupabaseClient } from '@supabase/supabase-js'
import { normalizeOverviewView, type OverviewView } from '../shared/overviewView.js'
import { resolveViewProjects } from './overview.js'
import { selectAll } from './selectAll.js'
import { isRealDate, TaskRuleError } from './tasks.js'

/**
 * The Procurement log: items per project, the viewer's saved view + collapsed groups, and the open tasks
 * linked to each item. Est. Delivery and Status are computed in the app, never stored.
 */
export interface ProcurementItem {
  id: string
  project_id: string
  spec_number: string | null
  description: string
  tag: string | null
  submitted_date: string | null
  approved_date: string | null
  ordered_date: string | null
  delivered_date: string | null
  required_on_site: string | null
  lead_time_value: number | null
  lead_time_unit: 'days' | 'weeks'
  vendor: string | null
  vendor_rep: string | null
  delivery_location: string | null
  po_number: string | null
  notes: string | null
  sort_order: number
  created_at: string
}

/** An open task linked to an item, as shown in the count popover. */
export interface LinkedTask {
  id: string
  title: string
  due_date: string | null
  assignee_ids: string[]
}

export interface ProcurementData {
  /** The caller's saved "Choose a View" selection for this tab (independent of the Overview's). */
  view: OverviewView
  /** Project ids whose groups the caller has collapsed. */
  collapsed: string[]
  /** The projects in the view (active ones), initiated or not. */
  projectIds: string[]
  items: ProcurementItem[]
  /** Open linked tasks the caller is allowed to see (assigned to or by them), keyed by item id. */
  taskLinks: Record<string, LinkedTask[]>
}

const ITEM_COLUMNS =
  'id, project_id, spec_number, description, tag, submitted_date, approved_date, ordered_date, delivered_date, required_on_site, lead_time_value, lead_time_unit, vendor, vendor_rep, delivery_location, po_number, notes, sort_order, created_at'
const CHUNK = 50

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0))]
}

function toItem(row: Record<string, unknown>): ProcurementItem {
  return { ...row, sort_order: (row.sort_order as number | null) ?? 0 } as unknown as ProcurementItem
}

export async function getProcurement(admin: SupabaseClient, profileId: string): Promise<ProcurementData> {
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('procurement_view, procurement_collapsed')
    .eq('id', profileId)
    .single()
  if (profileError) throw new Error(profileError.message)
  const view = normalizeOverviewView(profile?.procurement_view)
  const collapsed = stringIds(profile?.procurement_collapsed)

  const projects = await resolveViewProjects(admin, profileId, view)
  const projectIds = projects.map((p) => p.id)

  const items: ProcurementItem[] = []
  for (let i = 0; i < projectIds.length; i += CHUNK) {
    const chunk = projectIds.slice(i, i + CHUNK)
    const rows = await selectAll<Record<string, unknown>>(
      () =>
        admin
          .from('procurement_items')
          .select(ITEM_COLUMNS)
          .in('project_id', chunk)
          .order('sort_order')
          .order('created_at')
          .order('id') as never,
    )
    items.push(...rows.map(toItem))
  }

  // Tasks stay private as they are everywhere else: only ones the caller is assigned to or assigned.
  const taskLinks: Record<string, LinkedTask[]> = {}
  const itemIds = items.map((item) => item.id)
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const chunk = itemIds.slice(i, i + CHUNK)
    const rows = await selectAll<{
      id: string
      title: string
      due_date: string | null
      assigned_by: string | null
      procurement_item_id: string
      task_assignees: { user_id: string }[]
    }>(
      () =>
        admin
          .from('tasks')
          .select('id, title, due_date, assigned_by, procurement_item_id, task_assignees(user_id)')
          .in('procurement_item_id', chunk)
          .neq('status', 'complete')
          .order('id') as never,
    )
    for (const row of rows) {
      const assigneeIds = (row.task_assignees ?? []).map((a) => a.user_id)
      if (row.assigned_by !== profileId && !assigneeIds.includes(profileId)) continue
      ;(taskLinks[row.procurement_item_id] ??= []).push({
        id: row.id,
        title: row.title,
        due_date: row.due_date,
        assignee_ids: assigneeIds,
      })
    }
  }
  for (const list of Object.values(taskLinks)) {
    list.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.id.localeCompare(b.id))
  }

  return { view, collapsed, projectIds, items, taskLinks }
}

export async function saveProcurementView(admin: SupabaseClient, profileId: string, raw: unknown): Promise<OverviewView> {
  const view = normalizeOverviewView(raw)
  const { error } = await admin.from('profiles').update({ procurement_view: view }).eq('id', profileId)
  if (error) throw new Error(error.message)
  return view
}

export async function saveProcurementCollapsed(admin: SupabaseClient, profileId: string, raw: unknown): Promise<string[]> {
  const collapsed = stringIds(raw)
  const { error } = await admin.from('profiles').update({ procurement_collapsed: collapsed }).eq('id', profileId)
  if (error) throw new Error(error.message)
  return collapsed
}

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

const TEXT_FIELDS = ['spec_number', 'tag', 'vendor', 'vendor_rep', 'delivery_location', 'po_number', 'notes'] as const
const DATE_FIELDS = ['submitted_date', 'approved_date', 'ordered_date', 'delivered_date', 'required_on_site'] as const
const MAX_TEXT = 500
const MAX_NOTES = 10_000
const MAX_LEAD_TIME = 10_000

/**
 * Validates the fields of an item edit (a partial row) into what gets written. Anything unknown, or a
 * blank Description, is rejected; blank optional text and dates become null.
 */
export function parseItemPatch(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new TaskRuleError('"fields" (object) is required')
  const input = raw as Record<string, unknown>
  const patch: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    if (key === 'description') {
      if (typeof value !== 'string' || !value.trim()) throw new TaskRuleError('Description is required')
      if (value.trim().length > MAX_TEXT) throw new TaskRuleError(`Description can be at most ${MAX_TEXT} characters`)
      patch.description = value.trim()
    } else if ((TEXT_FIELDS as readonly string[]).includes(key)) {
      if (value !== null && typeof value !== 'string') throw new TaskRuleError(`"${key}" must be a string or null`)
      const text = typeof value === 'string' ? value.trim() : ''
      const max = key === 'notes' ? MAX_NOTES : MAX_TEXT
      if (text.length > max) throw new TaskRuleError(`"${key}" can be at most ${max} characters`)
      patch[key] = text || null
    } else if ((DATE_FIELDS as readonly string[]).includes(key)) {
      if (value === null || value === '') patch[key] = null
      else if (typeof value === 'string' && isRealDate(value) && Number(value.slice(0, 4)) >= 1900) patch[key] = value
      else throw new TaskRuleError(`"${key}" must be a real date (YYYY-MM-DD) or null`)
    } else if (key === 'lead_time_value') {
      if (value === null) patch[key] = null
      else if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_LEAD_TIME) patch[key] = value
      else throw new TaskRuleError('"lead_time_value" must be a whole number of 0 or more, or null')
    } else if (key === 'lead_time_unit') {
      if (value !== 'days' && value !== 'weeks') throw new TaskRuleError('"lead_time_unit" must be "days" or "weeks"')
      patch[key] = value
    } else if (key === 'sort_order') {
      if (typeof value !== 'number' || !Number.isInteger(value)) throw new TaskRuleError('"sort_order" must be a whole number')
      patch[key] = value
    } else {
      throw new TaskRuleError(`Unknown field "${key}"`)
    }
  }
  if (Object.keys(patch).length === 0) throw new TaskRuleError('No fields to change')
  return patch
}

/** Adds an item to the bottom of a project's list. Only a Description is needed. */
export async function createProcurementItem(
  admin: SupabaseClient,
  profileId: string,
  projectId: unknown,
  description: unknown,
): Promise<ProcurementItem> {
  if (typeof projectId !== 'string' || !projectId) throw new TaskRuleError('"projectId" (string) is required')
  const { description: cleaned } = parseItemPatch({ description })

  const { data: project, error: projectError } = await admin.from('projects').select('id').eq('id', projectId).maybeSingle()
  if (projectError) throw new Error(projectError.message)
  if (!project) throw new TaskRuleError('Project not found', 404)

  const { data: last, error: lastError } = await admin
    .from('procurement_items')
    .select('sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: false })
    .limit(1)
  if (lastError) throw new Error(lastError.message)
  const sortOrder = ((last?.[0]?.sort_order as number | null | undefined) ?? 0) + 1

  const { data, error } = await admin
    .from('procurement_items')
    .insert({ project_id: projectId, description: cleaned, sort_order: sortOrder, created_by: profileId })
    .select(ITEM_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toItem(data as Record<string, unknown>)
}

export async function updateProcurementItem(admin: SupabaseClient, itemId: unknown, rawFields: unknown): Promise<ProcurementItem> {
  if (typeof itemId !== 'string' || !itemId) throw new TaskRuleError('"itemId" (string) is required')
  const patch = parseItemPatch(rawFields)
  const { data, error } = await admin.from('procurement_items').update(patch).eq('id', itemId).select(ITEM_COLUMNS).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new TaskRuleError('Item not found', 404)
  return toItem(data as Record<string, unknown>)
}

/** Deleting an item never deletes a task: tasks.procurement_item_id is ON DELETE SET NULL. */
export async function deleteProcurementItem(admin: SupabaseClient, itemId: unknown): Promise<void> {
  if (typeof itemId !== 'string' || !itemId) throw new TaskRuleError('"itemId" (string) is required')
  const { error } = await admin.from('procurement_items').delete().eq('id', itemId)
  if (error) throw new Error(error.message)
}
