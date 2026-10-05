import { addDaysISO } from './dates'
import type { Task } from './tasks'

/** How far ahead the default Tasks view looks (late items are always included). */
export const WINDOW_DAYS = 7

/** What the Tasks list is made of: plain tasks, collapsible groups, and the one computed FLOW row. */
export type TaskListRow =
  | { kind: 'task'; task: Task }
  | {
      kind: 'group'
      /** Stable across refetches so a group stays open: "recurring:<title>" or "setup:<projectId>". */
      id: string
      label: string
      /** Set for a project's Setup bundle; recurring groups span projects, so null. */
      projectId: string | null
      /** Earliest child due date (null if none has one). */
      due: string | null
      children: Task[]
    }
  | { kind: 'flow'; count: number; due: string }

export interface FlowRowInfo {
  /** Added projects whose current-period flow report is missing or not completed. */
  count: number
  /** Last day of the current period. */
  due: string
}

/** Sort key shared by every row type: due date ascending (late first, oldest overdue first), no date last. */
export function rowDue(row: TaskListRow): string | null {
  if (row.kind === 'task') return row.task.due_date
  return row.due
}

function rowTitle(row: TaskListRow): string {
  if (row.kind === 'task') return row.task.title
  if (row.kind === 'group') return row.label
  return 'FLOW Reports'
}

function compareRows(a: TaskListRow, b: TaskListRow): number {
  const da = rowDue(a)
  const db = rowDue(b)
  if (da !== db) {
    if (da === null) return 1
    if (db === null) return -1
    return da.localeCompare(db)
  }
  return rowTitle(a).localeCompare(rowTitle(b))
}

function earliestDue(tasks: Task[]): string | null {
  const dates = tasks.map((t) => t.due_date).filter((d): d is string => !!d)
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null
}

function compareChildren(projectName: (id: string) => string | null) {
  return (a: Task, b: Task): number => {
    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date.localeCompare(b.due_date)
    }
    return (projectName(a.project_id ?? '') ?? '').localeCompare(projectName(b.project_id ?? '') ?? '')
  }
}

/**
 * Turns the (already filtered) open tasks into the rows the Tasks page shows.
 *
 * 1. Window: unless `showUpcoming`, only late (due before today) and due-within-7-days
 *    items — a task with no due date is "upcoming", never windowed in.
 * 2. Group what's left: recurring tasks sharing a title across 2+ projects, and each
 *    project's open Setup tasks (meetings included — a project's Setup bundle is every setup task). A group of one stays a plain row. Counts are
 *    of the children visible *in this view*. Manual tasks never group.
 * 3. Sort everything — tasks, groups, the FLOW row — by due date (a group by its earliest child).
 */
export function buildTaskRows(
  tasks: Task[],
  options: {
    today: string
    showUpcoming: boolean
    projectName: (projectId: string) => string | null
    flow: FlowRowInfo | null
  },
): { rows: TaskListRow[]; upcomingCount: number } {
  const { today, showUpcoming, projectName, flow } = options
  const cutoff = addDaysISO(today, WINDOW_DAYS)
  const inWindow = (due: string | null) => due !== null && due <= cutoff

  const visible = showUpcoming ? tasks : tasks.filter((t) => inWindow(t.due_date))
  const upcomingCount = tasks.length - tasks.filter((t) => inWindow(t.due_date)).length

  const rows: TaskListRow[] = []
  const grouped = new Set<string>()
  const byChildren = compareChildren(projectName)

  // Recurring: same title, 2+ projects.
  const recurringByTitle = new Map<string, Task[]>()
  for (const t of visible) {
    if (t.source_category !== 'recurring') continue
    recurringByTitle.set(t.title, [...(recurringByTitle.get(t.title) ?? []), t])
  }
  for (const [title, children] of recurringByTitle) {
    if (children.length < 2 || new Set(children.map((c) => c.project_id)).size < 2) continue
    children.forEach((c) => grouped.add(c.id))
    const sorted = [...children].sort(byChildren)
    rows.push({
      kind: 'group',
      id: `recurring:${title}`,
      label: `${title} (${children.length})`,
      projectId: null,
      due: earliestDue(sorted),
      children: sorted,
    })
  }

  // Setup: each project's open setup tasks (meetings included) form one bundle.
  const setupByProject = new Map<string, Task[]>()
  for (const t of visible) {
    if (t.source_category !== 'setup' || !t.project_id) continue
    setupByProject.set(t.project_id, [...(setupByProject.get(t.project_id) ?? []), t])
  }
  for (const [projectId, children] of setupByProject) {
    if (children.length < 2) continue
    children.forEach((c) => grouped.add(c.id))
    const sorted = [...children].sort(byChildren)
    rows.push({
      kind: 'group',
      id: `setup:${projectId}`,
      label: `Setup: ${projectName(projectId) ?? 'Unknown project'} (${children.length})`,
      projectId,
      due: earliestDue(sorted),
      children: sorted,
    })
  }

  for (const t of visible) if (!grouped.has(t.id)) rows.push({ kind: 'task', task: t })

  if (flow && flow.count > 0 && (showUpcoming || inWindow(flow.due))) {
    rows.push({ kind: 'flow', count: flow.count, due: flow.due })
  }

  rows.sort(compareRows)
  return { rows, upcomingCount }
}
