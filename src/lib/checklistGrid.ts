import type { Project } from './projects'
import type { ChecklistItemStatus, ProjectChecklistStatus } from './checklist'

export type Phase = 'setup' | 'recurring' | 'closeout'

export const PHASES: Phase[] = ['setup', 'recurring', 'closeout']

export interface ColumnDef {
  id: string
  name: string
  sortOrder: number
}

export interface PmGroup {
  pmId: string | null
  pmName: string
  projects: Project[]
}

/** Starred projects bucketed by pm_id, each sorted by job number; groups sorted by PM name with "Unassigned" (null pm_id) last. */
export function buildPmGroups(projects: Project[], nameFor: (profileId: string | null) => string): PmGroup[] {
  const map = new Map<string | null, Project[]>()
  for (const project of projects) {
    const key = project.pm_id
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(project)
  }
  const entries = [...map.entries()].map(([pmId, group]) => ({
    pmId,
    pmName: nameFor(pmId),
    projects: [...group].sort((a, b) => (a.job_number ?? '').localeCompare(b.job_number ?? '')),
  }))
  entries.sort((a, b) => {
    if (a.pmId === null) return 1
    if (b.pmId === null) return -1
    return a.pmName.localeCompare(b.pmName)
  })
  return entries
}

/** Column set per phase = union of every item id appearing in any of these projects' own checklist status (defaults minus exclusions, plus customs), sorted by sort_order. */
export function buildColumnsByPhase(
  projects: Project[],
  checklistByProject: Record<string, ProjectChecklistStatus>,
): Record<Phase, ColumnDef[]> {
  const result: Record<Phase, ColumnDef[]> = { setup: [], recurring: [], closeout: [] }
  for (const phase of PHASES) {
    const byId = new Map<string, ColumnDef>()
    for (const project of projects) {
      const status = checklistByProject[project.id]
      if (!status) continue
      for (const s of status[phase]) {
        if (!byId.has(s.item.id)) {
          byId.set(s.item.id, { id: s.item.id, name: s.item.name, sortOrder: s.item.sort_order })
        }
      }
    }
    result[phase] = [...byId.values()].sort((a, b) => a.sortOrder - b.sortOrder)
  }
  return result
}

/** projectId:itemId -> that project's status for that item; a missing entry means "not applicable" (excluded, or never part of this project's set) — not an unchecked box. */
export function buildCellLookup(
  checklistByProject: Record<string, ProjectChecklistStatus>,
): Map<string, ChecklistItemStatus> {
  const map = new Map<string, ChecklistItemStatus>()
  for (const [projectId, status] of Object.entries(checklistByProject)) {
    for (const phase of PHASES) {
      for (const s of status[phase as keyof Pick<ProjectChecklistStatus, Phase>]) {
        map.set(`${projectId}:${s.item.id}`, s)
      }
    }
  }
  return map
}
