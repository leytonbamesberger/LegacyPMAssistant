import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useProject } from '../contexts/ProjectContext'
import { useProfile } from '../contexts/ProfileContext'
import { localToday } from '../lib/dates'
import {
  createProcurementItem,
  deleteProcurementItem,
  fetchProcurement,
  needsAttention,
  saveProcurementCollapsed,
  saveProcurementView,
  updateProcurementItem,
  type ProcurementData,
  type ProcurementJumpState,
  type ProcurementItem,
  type ProcurementItemFields,
} from '../lib/procurement'
import { createTask, type NewTaskInput } from '../lib/tasks'
import type { OverviewView } from '../../shared/overviewView'
import { AddTaskModal } from '../components/AddTaskModal'
import { OverviewViewPicker } from '../components/OverviewViewPicker'
import { ProcoreEmptyState } from '../components/ProcoreEmptyState'
import {
  anyFilterActive,
  distinctValues,
  itemFiltersActive,
  itemMatchesFilters,
  NO_PROCUREMENT_FILTERS,
  ProcurementFilters,
  projectMatchesJob,
  type ProcurementFilterState,
} from '../components/ProcurementFilters'
import {
  ProcurementTable,
  sortItems,
  type ColumnKey,
  type ProcurementGroup,
  type SortState,
} from '../components/ProcurementTable'

interface Jump {
  itemId: string
  projectId: string
  /** The item's project wasn't in the view, so it was added to it; if it's still missing after that, give up. */
  addedToView: boolean
}

const ERROR_MS = 5000
const HIGHLIGHT_MS = 2400

/**
 * The procurement log that replaces the per-project Excel sheets. One collapsible group per project in
 * the user's own view (profiles.procurement_view — independent of the Overview's), items edited right in
 * their cells, and each item linkable to follow-up tasks. Est. Delivery, Status and "needs attention" are
 * computed from the dates, never stored. Not gated by initiation: any project in the view works.
 *
 * Scrolling: the page is the only vertical scroller; the table scrolls horizontally on its own (Spec # and
 * Description pinned).
 */
export function ProcurementPage() {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { projects, addedVersion } = useProject()
  const { profile, directory, nameFor } = useProfile()
  const location = useLocation()
  const navigate = useNavigate()

  const [data, setData] = useState<ProcurementData | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [filters, setFilters] = useState<ProcurementFilterState>(NO_PROCUREMENT_FILTERS) // reset on reload by design
  const [sort, setSort] = useState<SortState | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [taskFor, setTaskFor] = useState<ProcurementItem | null>(null)
  const [jump, setJump] = useState<Jump | null>(null)
  const jumpBusy = useRef(false)
  const quickAddRefs = useRef(new Map<string, HTMLInputElement>())
  const [addFocus, setAddFocus] = useState<string | null>(null)

  const requestId = useRef(0)
  const load = useCallback(async () => {
    if (!account) return
    const id = ++requestId.current
    const result = await fetchProcurement(instance, account)
    if (id !== requestId.current) return
    if (result) setData(result)
    setFailed(!result)
    setLoading(false)
  }, [instance, account])

  useEffect(() => {
    void load()
  }, [load, addedVersion]) // a newly Added project shows up with no extra step

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  // ---- view + collapsed groups -------------------------------------------------------------

  // Edits show at once and are saved; a failed save reloads the stored view.
  const viewSeq = useRef(0)
  async function handleViewChange(next: OverviewView) {
    if (!account) return
    const seq = ++viewSeq.current
    setData((prev) => prev && { ...prev, view: next })
    const saved = await saveProcurementView(instance, account, next)
    if (seq !== viewSeq.current) return // a newer change is already on its way
    void load() // the stored view decides the projects (or reverts the chips if the save failed)
    if (!saved) setFailed(true)
  }

  async function setCollapsedIds(ids: string[]) {
    if (!account) return
    setData((prev) => prev && { ...prev, collapsed: ids })
    const ok = await saveProcurementCollapsed(instance, account, ids)
    if (!ok) void load()
  }

  const collapsed = useMemo(() => new Set(data?.collapsed ?? []), [data?.collapsed])

  function toggleGroup(projectId: string) {
    const ids = data?.collapsed ?? []
    void setCollapsedIds(ids.includes(projectId) ? ids.filter((id) => id !== projectId) : [...ids, projectId])
  }

  // "+ Add Item": expand the group if needed, then focus its quick-add row once it exists.
  function requestAdd(projectId: string) {
    if (data?.collapsed.includes(projectId)) void setCollapsedIds(data.collapsed.filter((id) => id !== projectId))
    setAddFocus(projectId)
  }
  useEffect(() => {
    if (!addFocus) return
    const input = quickAddRefs.current.get(addFocus)
    if (!input) return // not rendered yet (the group is still collapsed): this effect runs again when it is
    input.scrollIntoView({ block: 'center' })
    input.focus()
    setAddFocus(null)
  }, [addFocus, data])

  // ---- item edits ---------------------------------------------------------------------------

  const patchLocal = useCallback((itemId: string, fields: ProcurementItemFields) => {
    setData((prev) =>
      prev && { ...prev, items: prev.items.map((item) => (item.id === itemId ? { ...item, ...fields } : item)) },
    )
  }, [])

  const errorTimers = useRef(new Map<string, number>())
  function flagError(itemId: string, message: string) {
    setRowErrors((prev) => ({ ...prev, [itemId]: message }))
    window.clearTimeout(errorTimers.current.get(itemId))
    errorTimers.current.set(
      itemId,
      window.setTimeout(() => {
        setRowErrors((prev) => {
          const { [itemId]: _gone, ...rest } = prev
          return rest
        })
      }, ERROR_MS),
    )
  }
  useEffect(() => {
    const timers = errorTimers.current
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [])

  // Optimistic: the cell shows the new value now; a failed save puts the old one back and flags the row.
  async function handlePatch(item: ProcurementItem, fields: ProcurementItemFields) {
    if (!account) return
    const keys = Object.keys(fields) as (keyof ProcurementItemFields)[]
    const previous = Object.fromEntries(keys.map((key) => [key, item[key]])) as ProcurementItemFields
    patchLocal(item.id, fields)
    const saved = await updateProcurementItem(instance, account, item.id, fields)
    if (!saved) {
      patchLocal(item.id, previous)
      flagError(item.id, `Couldn’t save ${keys.map((k) => k.replace(/_/g, ' ')).join(', ')} — the change was reverted.`)
      return
    }
    // Take the server's cleaned-up version of just what was edited (trimmed text, etc.).
    patchLocal(item.id, Object.fromEntries(keys.map((key) => [key, saved[key]])) as ProcurementItemFields)
  }

  async function handleCreate(projectId: string, description: string): Promise<boolean> {
    if (!account) return false
    const item = await createProcurementItem(instance, account, projectId, description)
    if (!item) return false
    setData((prev) => prev && { ...prev, items: [...prev.items, item] })
    return true
  }

  // Linked tasks stay (the database just clears their link), so only the item and its task list go.
  async function handleDelete(item: ProcurementItem) {
    if (!account) return
    setData((prev) => {
      if (!prev) return prev
      const { [item.id]: _links, ...taskLinks } = prev.taskLinks
      return { ...prev, items: prev.items.filter((i) => i.id !== item.id), taskLinks }
    })
    const ok = await deleteProcurementItem(instance, account, item.id)
    if (!ok) void load()
  }

  async function handleCreateTask(item: ProcurementItem, fields: NewTaskInput): Promise<boolean> {
    if (!account) return false
    const task = await createTask(instance, account, { ...fields, procurementItemId: item.id })
    if (task) void load() // the item's open-task count and popover pick it up
    return task !== null
  }

  // ---- jump from a task's chip --------------------------------------------------------------

  useEffect(() => {
    const state = location.state as Partial<ProcurementJumpState> | null
    if (!state?.procurementItemId || !state.procurementProjectId) return
    setJump({ itemId: state.procurementItemId, projectId: state.procurementProjectId, addedToView: false })
    navigate(location.pathname, { replace: true, state: null }) // so a refresh doesn't jump again
  }, [location.state, location.pathname, navigate])

  useEffect(() => {
    if (!jump || !data || jumpBusy.current) return
    if (!data.projectIds.includes(jump.projectId)) {
      if (jump.addedToView) {
        setJump(null) // still not shown after adding it (the project is gone / inactive)
        return
      }
      // The item's project isn't in the user's view: add it (saved, like any other view change), then reload.
      setJump({ ...jump, addedToView: true })
      jumpBusy.current = true
      void (async () => {
        if (account) {
          await saveProcurementView(instance, account, {
            ...data.view,
            project_ids: [...data.view.project_ids, jump.projectId],
          })
          await load()
        }
        jumpBusy.current = false
      })()
      return
    }
    if (!data.items.some((item) => item.id === jump.itemId)) {
      setJump(null) // the item was deleted
      return
    }
    if (data.collapsed.includes(jump.projectId)) {
      void setCollapsedIds(data.collapsed.filter((id) => id !== jump.projectId))
      return
    }
    // Scroll the pinned Description cell (always on screen horizontally) so the table doesn't slide sideways.
    const cell = document.querySelector(`#proc-item-${CSS.escape(jump.itemId)} td:nth-child(2)`)
    if (!cell) return // not rendered yet: this effect runs again with the next render
    cell.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setHighlightId(jump.itemId)
    setJump(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, data])

  useEffect(() => {
    if (!highlightId) return
    const timer = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS)
    return () => window.clearTimeout(timer)
  }, [highlightId])

  // ---- what to show -------------------------------------------------------------------------

  const today = localToday() // the browser's date decides what is late
  const openCount = useCallback((itemId: string) => data?.taskLinks[itemId]?.length ?? 0, [data?.taskLinks])

  const shownProjects = useMemo(() => {
    const byJobNumber = (a: { job_number: string | null; name: string }, b: { job_number: string | null; name: string }) =>
      Number(!a.job_number) - Number(!b.job_number) ||
      (a.job_number ?? '').localeCompare(b.job_number ?? '', undefined, { numeric: true }) ||
      a.name.localeCompare(b.name)
    return (data?.projectIds ?? [])
      .map((id) => projectById.get(id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined)
      .sort(byJobNumber)
  }, [data?.projectIds, projectById])

  const itemsByProject = useMemo(() => {
    const map = new Map<string, ProcurementItem[]>()
    for (const item of data?.items ?? []) map.set(item.project_id, [...(map.get(item.project_id) ?? []), item])
    return map
  }, [data?.items])

  const vendors = useMemo(() => distinctValues(data?.items ?? [], 'vendor'), [data?.items])
  const locations = useMemo(() => distinctValues(data?.items ?? [], 'delivery_location'), [data?.items])

  const itemFilters = itemFiltersActive(filters)
  const groups = useMemo<ProcurementGroup[]>(() => {
    const out: ProcurementGroup[] = []
    for (const project of shownProjects) {
      if (!projectMatchesJob(project, filters.job)) continue
      const all = itemsByProject.get(project.id) ?? []
      const matching = all.filter((item) => itemMatchesFilters(item, filters, { today, openTaskCount: openCount(item.id) }))
      if (itemFilters && matching.length === 0) continue // projects with nothing to show hide while a filter is on
      out.push({
        project,
        items: sortItems(matching, sort, openCount),
        total: all.length,
        attention: all.filter((item) => needsAttention(item, today)).length,
      })
    }
    return out
  }, [shownProjects, itemsByProject, filters, itemFilters, sort, today, openCount])

  function handleSort(key: ColumnKey) {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  const shownIds = groups.map((g) => g.project.id)
  const view = data?.view
  const noAdded = !projects.some((p) => p.isStarred)

  return (
    <div className="w-full px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-legacy-blue-dark">Procurement</h1>
          <p className="mt-1 text-sm text-legacy-blue-light">
            Track submittals, orders and deliveries for the projects in your view. Choose a View to add a
            Project Manager's projects or individual projects; it never changes your Added projects.
          </p>
        </div>
        {data && view && (
          <OverviewViewPicker
            view={view}
            onChange={(next) => void handleViewChange(next)}
            projects={projects}
            directory={directory}
          />
        )}
      </div>

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-legacy-blue-light">Loading…</p>
        ) : failed && !data ? (
          <p className="text-sm text-legacy-red">Couldn't load the procurement log. Try again in a moment.</p>
        ) : shownProjects.length === 0 ? (
          // First run: nothing Added and nothing else chosen in the view.
          view && view.pm_ids.length === 0 && view.project_ids.length === 0 && noAdded ? (
            <ProcoreEmptyState />
          ) : (
            <p className="text-sm text-legacy-blue-light">
              No projects in this view. Use Choose a View to pick some.
            </p>
          )
        ) : (
          <>
            <ProcurementFilters
              filters={filters}
              onChange={setFilters}
              vendors={vendors}
              locations={locations}
              onCollapseAll={() => void setCollapsedIds([...new Set([...(data?.collapsed ?? []), ...shownIds])])}
              onExpandAll={() => void setCollapsedIds((data?.collapsed ?? []).filter((id) => !shownIds.includes(id)))}
            />
            <div className="mt-4">
              {groups.length === 0 ? (
                <p className="text-sm text-legacy-blue-light">
                  Nothing matches these filters.{' '}
                  {anyFilterActive(filters) && (
                    <button
                      type="button"
                      onClick={() => setFilters(NO_PROCUREMENT_FILTERS)}
                      className="font-medium underline hover:text-legacy-blue-dark"
                    >
                      Clear filters
                    </button>
                  )}
                </p>
              ) : (
                <ProcurementTable
                  groups={groups}
                  collapsed={collapsed}
                  filtersActive={itemFilters}
                  sort={sort}
                  onSort={handleSort}
                  today={today}
                  taskLinks={data?.taskLinks ?? {}}
                  vendors={vendors}
                  locations={locations}
                  highlightId={highlightId}
                  rowErrors={rowErrors}
                  currentProfileId={profile?.id ?? null}
                  nameFor={nameFor}
                  quickAddRefs={quickAddRefs}
                  onToggleGroup={toggleGroup}
                  onRequestAdd={requestAdd}
                  onCreate={handleCreate}
                  onPatch={(item, fields) => void handlePatch(item, fields)}
                  onDelete={(item) => void handleDelete(item)}
                  onAddTask={setTaskFor}
                />
              )}
            </div>
          </>
        )}
      </div>

      {taskFor && (
        <AddTaskModal
          presetProjectId={taskFor.project_id}
          presetTitle={`Follow up: ${taskFor.description}`}
          projects={projects}
          directory={directory}
          currentProfileId={profile?.id ?? null}
          onClose={() => setTaskFor(null)}
          onSave={(fields) => handleCreateTask(taskFor, fields)}
        />
      )}
    </div>
  )
}
