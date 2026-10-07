import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { useProject } from '../contexts/ProjectContext'
import { useProfile } from '../contexts/ProfileContext'
import { useFlowReport } from '../contexts/FlowReportContext'
import { fetchOverview, saveOverviewView, type OverviewData, type OverviewRow } from '../lib/overview'
import type { OverviewView } from '../../shared/overviewView'
import { FLOW_BUDGET_ITEMS } from '../../shared/flowBudget'
import type { Project } from '../lib/projects'
import { InitiateProjectModal } from '../components/InitiateProjectModal'
import { ProcoreEmptyState } from '../components/ProcoreEmptyState'
import { OverviewViewPicker } from '../components/OverviewViewPicker'

/**
 * A scannable checklist grid: one row per project in the user's view, one column per Setup / Recurring /
 * Closeout item (grouped by phase) plus the FLOW group. A cell is a box — nothing to click. Rows are
 * grouped under their PM (projects with none under "Unassigned"), each group sorted by job number.
 * A project that hasn't been initiated yet gets a row too, below the initiated ones in its group, with
 * one merged cell (and an Initiate button) where its checklist cells would be; its FLOW cells are real.
 *
 * Which projects show is the "Choose a View" selection (profiles.overview_view): My Projects (Added,
 * live), Project Managers (all of a person's projects, following reassignment) and individual projects.
 * It never touches the user's Added list.
 *
 * Scrolling: the page is the only vertical scroller. The grid scrolls horizontally on its own
 * (project column sticky) but has no height limit, so there is no pinned header — pinning one would
 * need a nested vertical scroll area.
 */
/** The FLOW group: the report itself, then the four budget boxes saved on it. */
const FLOW_COLUMNS = [
  { key: 'report', label: 'Report' },
  ...FLOW_BUDGET_ITEMS,
] as const

export function OverviewPage() {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { projects, reloadProjects, addedVersion } = useProject()
  const { directory, nameFor } = useProfile()
  const { reportVersion } = useFlowReport()

  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [initiating, setInitiating] = useState<Project | null>(null)

  const requestId = useRef(0)
  const load = useCallback(async () => {
    if (!account) return
    const id = ++requestId.current
    const result = await fetchOverview(instance, account)
    if (id !== requestId.current) return
    if (result) setData(result)
    setFailed(!result)
    setLoading(false)
  }, [instance, account])

  useEffect(() => {
    void load()
  }, [load, reportVersion, addedVersion]) // a newly Added project shows up with no extra step

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const label = (id: string) => projectById.get(id)?.name ?? 'Unknown project'

  // Grouped by PM (alphabetical, "Unassigned" last). Within a group: initiated projects by job number,
  // then the uninitiated ones by job number.
  const groups = useMemo(() => {
    const byPm = new Map<string | null, OverviewRow[]>()
    for (const row of data?.rows ?? []) {
      if (!projectById.has(row.project_id)) continue
      byPm.set(row.pm_id, [...(byPm.get(row.pm_id) ?? []), row])
    }
    const jobNumber = (row: OverviewRow) => projectById.get(row.project_id)?.job_number ?? ''
    const byJob = (a: OverviewRow, b: OverviewRow) =>
      Number(b.initiated) - Number(a.initiated) ||
      Number(!jobNumber(a)) - Number(!jobNumber(b)) ||
      jobNumber(a).localeCompare(jobNumber(b), undefined, { numeric: true }) ||
      label(a.project_id).localeCompare(label(b.project_id))
    return [...byPm.entries()]
      .map(([pmId, rows]) => ({ pmId, name: pmId ? nameFor(pmId) : 'Unassigned', rows: rows.sort(byJob) }))
      .sort((a, b) => Number(a.pmId === null) - Number(b.pmId === null) || a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, projectById, directory])
  const rowCount = groups.reduce((n, g) => n + g.rows.length, 0)

  // Edits are applied at once (chips and rows follow) and saved; a failed save reloads the stored view.
  const saveSeq = useRef(0)
  async function handleViewChange(next: OverviewView) {
    if (!account) return
    const seq = ++saveSeq.current
    setData((prev) => prev && { ...prev, view: next })
    const saved = await saveOverviewView(instance, account, next)
    if (seq !== saveSeq.current) return // a newer change is already on its way
    void load() // the stored view decides the rows (or reverts the chips if the save failed)
    if (!saved) setFailed(true)
  }

  const setup = (data?.columns ?? []).filter((c) => c.phase === 'setup')
  const recurring = (data?.columns ?? []).filter((c) => c.phase === 'recurring')
  const closeout = (data?.columns ?? []).filter((c) => c.phase === 'closeout')
  const columns = [...setup, ...recurring, ...closeout]
  // Where a column group begins (a heavier left border).
  const groupStarts = new Set([0, setup.length, setup.length + recurring.length])
  // With no initiated project there are no checklist columns, but the merged cell still needs one to span.
  const checklistSpan = Math.max(columns.length, 1)

  return (
    <div className="w-full px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-legacy-blue-dark">Overview</h1>
          <p className="mt-1 text-sm text-legacy-blue-light">
            Checklist progress across the projects in your view. Choose a View to add a Project
            Manager's projects or individual projects; it never changes your Added projects.
          </p>
        </div>
        {data && (
          <OverviewViewPicker
            view={data.view}
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
          <p className="text-sm text-legacy-red">Couldn't load the overview. Try again in a moment.</p>
        ) : rowCount === 0 ? (
          // First run: nothing Added and nothing else chosen in the view.
          data && data.view.pm_ids.length === 0 && data.view.project_ids.length === 0 && !projects.some((p) => p.isStarred) ? (
            <ProcoreEmptyState />
          ) : (
            <p className="text-sm text-legacy-blue-light">
              No projects in this view. Use Choose a View to pick some.
            </p>
          )
        ) : (
          <div className="overflow-x-auto rounded-lg border border-legacy-blue-light/25">
            <table className="border-separate border-spacing-0 text-xs text-legacy-blue-dark">
              <thead>
                <tr>
                  <th
                    rowSpan={2}
                    className="sticky left-0 z-30 w-56 min-w-56 max-w-56 border-b border-r border-legacy-blue-light/25 bg-white px-3 text-left align-bottom text-[11px] font-semibold uppercase tracking-wide text-legacy-blue-light"
                  >
                    Project
                  </th>
                  {columns.length === 0 ? (
                    <PhaseHeader label="Checklist" span={1} />
                  ) : (
                    <>
                      <PhaseHeader label="Setup" span={setup.length} />
                      <PhaseHeader label="Recurring" span={recurring.length} />
                      <PhaseHeader label="Closeout" span={closeout.length} />
                    </>
                  )}
                  <PhaseHeader label="Flow" span={FLOW_COLUMNS.length} />
                </tr>
                <tr>
                  {columns.length === 0 && (
                    <th className="h-40 min-w-[20rem] border-b border-l-2 border-legacy-blue-light/25 border-l-legacy-blue-dark/40 bg-white" />
                  )}
                  {columns.map((col, i) => (
                    <th
                      key={col.id}
                      title={col.name}
                      className={`h-40 w-7 min-w-[1.75rem] border-b border-legacy-blue-light/25 bg-white p-0 align-bottom font-normal ${
                        groupStarts.has(i) ? 'border-l-2 border-l-legacy-blue-dark/40' : ''
                      }`}
                    >
                      <div className="mx-auto rotate-180 whitespace-nowrap pt-1.5 text-left leading-7 [writing-mode:vertical-rl]">
                        {col.name}
                      </div>
                    </th>
                  ))}
                  {FLOW_COLUMNS.map((col, i) => (
                    <th
                      key={col.key}
                      title={col.label}
                      className={`h-40 w-7 min-w-[1.75rem] border-b border-legacy-blue-light/25 bg-white p-0 align-bottom font-normal ${
                        i === 0 ? 'border-l-2 border-l-legacy-blue-dark/40' : ''
                      }`}
                    >
                      <div className="mx-auto rotate-180 whitespace-nowrap pt-1.5 text-left leading-7 [writing-mode:vertical-rl]">
                        {col.label}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.pmId ?? 'unassigned'}>
                    <tr>
                      <th
                        colSpan={1 + checklistSpan + FLOW_COLUMNS.length}
                        className="border-b border-legacy-blue-light/20 bg-legacy-blue-light/10 px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-legacy-blue-dark"
                      >
                        {/* Stays in view while the grid scrolls sideways. */}
                        <div className="sticky left-3 w-max">
                          {group.name}
                          <span className="ml-1.5 font-normal normal-case text-legacy-blue-light">
                            {group.rows.length} project{group.rows.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      </th>
                    </tr>
                    {group.rows.map((row) => {
                      const done = new Set(row.done)
                      const na = new Set(row.na)
                      const project = projectById.get(row.project_id)
                      return (
                        <tr key={row.project_id} className="group hover:bg-legacy-blue-light/5">
                          <th className="sticky left-0 z-10 w-56 min-w-56 max-w-56 border-b border-r border-legacy-blue-light/15 bg-white px-3 py-1 text-left font-medium group-hover:bg-legacy-blue-light/5">
                            <span className="block truncate">
                              {project?.job_number && (
                                <span className="mr-1.5 font-normal text-legacy-blue-light">{project.job_number}</span>
                              )}
                              {label(row.project_id)}
                            </span>
                          </th>
                          {row.initiated ? (
                            columns.length === 0 ? (
                              <td />
                            ) : (
                              columns.map((col, i) => (
                                <Cell
                                  key={col.id}
                                  state={na.has(col.id) ? 'na' : done.has(col.id) ? 'done' : 'open'}
                                  groupStart={groupStarts.has(i)}
                                  label={`${label(row.project_id)}: ${col.name}`}
                                />
                              ))
                            )
                          ) : (
                            <td
                              colSpan={checklistSpan}
                              className="border-b border-l-2 border-legacy-blue-light/15 border-l-legacy-blue-dark/40 bg-legacy-blue-light/[0.04] py-1"
                            >
                              {/* Pinned just right of the sticky project column so it stays readable while the grid scrolls. */}
                              <div className="sticky left-56 flex w-max items-center gap-3 px-3 text-legacy-blue-light">
                                <span>Initiate this project to see its checklist</span>
                                <button
                                  type="button"
                                  onClick={() => project && setInitiating(project)}
                                  className="rounded-full bg-legacy-red px-2.5 py-0.5 text-[11px] font-semibold text-white hover:opacity-90"
                                >
                                  Initiate Project
                                </button>
                              </div>
                            </td>
                          )}
                          {FLOW_COLUMNS.map((col, i) => (
                            <Cell
                              key={col.key}
                              state={row.flow[col.key] ? 'done' : 'open'}
                              groupStart={i === 0}
                              label={`${label(row.project_id)}: Flow ${col.label}`}
                            />
                          ))}
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {initiating && (
        <InitiateProjectModal
          project={initiating}
          onClose={() => setInitiating(null)}
          onDone={() => {
            // The project becomes initiated: refresh the shared project list and this grid.
            void reloadProjects()
            void load()
          }}
        />
      )}
    </div>
  )
}

function PhaseHeader({ label, span }: { label: string; span: number }) {
  if (span === 0) return null
  return (
    <th
      colSpan={span}
      className="h-7 border-b border-l-2 border-legacy-blue-light/25 border-l-legacy-blue-dark/40 bg-white text-center text-[11px] font-semibold uppercase tracking-wide text-legacy-blue-dark"
    >
      {label}
    </th>
  )
}

type CellState = 'done' | 'open' | 'na'

/**
 * A read-only box, nothing to click: checked = complete, empty = applies but not
 * complete, grayed out = doesn't apply to this project.
 */
function Cell({ state, groupStart, label }: { state: CellState; groupStart: boolean; label: string }) {
  const box =
    state === 'done'
      ? 'border-legacy-blue-dark bg-legacy-blue-dark text-white'
      : state === 'open'
        ? 'border-legacy-blue-dark/60 bg-white'
        : 'border-legacy-blue-light/20 bg-legacy-blue-light/15'
  return (
    <td
      className={`h-7 w-7 min-w-[1.75rem] border-b border-legacy-blue-light/15 text-center ${
        groupStart ? 'border-l-2 border-l-legacy-blue-dark/40' : 'border-l border-l-legacy-blue-light/10'
      }`}
    >
      <span
        role="checkbox"
        aria-checked={state === 'done'}
        aria-readonly="true"
        aria-disabled={state === 'na'}
        aria-label={`${label}${state === 'na' ? ' (does not apply)' : ''}`}
        className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border align-middle text-[10px] font-bold leading-none ${box}`}
      >
        {state === 'done' ? '✓' : ''}
      </span>
    </td>
  )
}
