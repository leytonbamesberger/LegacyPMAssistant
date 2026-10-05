import { SupabaseClient } from '@supabase/supabase-js'

/**
 * The checklist catalog (`checklist_items`, per-project exclusions, a
 * project's own custom items) is just the menu the initiation wizard picks
 * from. Whether an item is DONE lives in `tasks` — there is no separate
 * completion log (see the initiation section of supabase/schema.sql). The old
 * Budget items are gone from the catalog: they're checkboxes on the flow report.
 */
export interface ChecklistItemRecord {
  id: string
  phase: 'setup' | 'recurring' | 'closeout'
  name: string
  sort_order: number
  cadence_days: number | null
  cadence_type: 'rolling' | 'calendar_month' | null
  /** One of the four meeting Setup items, which may be left TBD in the wizard. */
  is_meeting: boolean
  /** null = shared default; set = one project's own custom item. */
  project_id: string | null
}

export interface InitiationCatalogItem extends ChecklistItemRecord {
  /** This project has hidden this shared default (project_checklist_item_exclusions). */
  excluded: boolean
}

export interface InitiationCatalog {
  items: InitiationCatalogItem[]
  pm_id: string | null
  apm_id: string | null
  initiated: boolean
}

/** Setup + Recurring items for one project: shared defaults (flagged if excluded) plus its own custom items. */
export async function getInitiationCatalog(
  admin: SupabaseClient,
  projectId: string,
): Promise<InitiationCatalog> {
  const [itemsResult, exclusionsResult, projectResult] = await Promise.all([
    admin
      .from('checklist_items')
      .select('*')
      .in('phase', ['setup', 'recurring'])
      .or(`project_id.is.null,project_id.eq.${projectId}`)
      .order('phase', { ascending: false }) // 'setup' before 'recurring'
      .order('sort_order'),
    admin.from('project_checklist_item_exclusions').select('checklist_item_id').eq('project_id', projectId),
    admin.from('projects').select('pm_id, apm_id, initiated').eq('id', projectId).single(),
  ])
  if (itemsResult.error) throw new Error(itemsResult.error.message)
  if (exclusionsResult.error) throw new Error(exclusionsResult.error.message)
  if (projectResult.error) throw new Error(projectResult.error.message)

  const excluded = new Set((exclusionsResult.data ?? []).map((r) => r.checklist_item_id as string))
  return {
    items: ((itemsResult.data ?? []) as ChecklistItemRecord[]).map((item) => ({
      ...item,
      excluded: item.project_id === null && excluded.has(item.id),
    })),
    pm_id: projectResult.data.pm_id as string | null,
    apm_id: projectResult.data.apm_id as string | null,
    initiated: projectResult.data.initiated as boolean,
  }
}
