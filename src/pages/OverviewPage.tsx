import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { useProject } from '../contexts/ProjectContext'
import { useFlowReport } from '../contexts/FlowReportContext'
import { fetchOverview, setOverviewProject, type OverviewData } from '../lib/overview'
import { FLOW_BUDGET_ITEMS } from '../../shared/flowBudget'
import { projectSearchOptions } from '../lib/projectOptions'
import type { Project } from '../lib/projects'
import { InitiateProjectModal } from '../components/InitiateProjectModal'
import { SearchSelect, type SearchSelectOption } from '../components/SearchSelect'

/**
 * A scannable checklist grid: one row per project on the user's Overview, one column per Setup /
 * Recurring item (grouped by phase) plus the FLOW group. A cell is a box — nothing to click. A
 * project that hasn't been initiated yet gets a row too, sorted below the initiated ones, with one
 * merged cell (and an Initiate button) where its checklist cells would be; its FLOW cells are real.
 * The project selection is its own list (seeded from Added on first open) and never touches Added.
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
  const { projects, reloadProjects } = useProject()
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
  }, [load, reportVersion])

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const label = (id: string) => projectById.get(id)?.name ?? 'Unknown project'

  // Initiated projects first, then the uninitiated ones — each group alphabetical.
  const rows = useMemo(
    () =>
      (data?.rows ?? [])
        .filter((r) => projectById.has(r.project_id))
        .sort(
          (a, b) =>
            Number(b.initiated) - Number(a.initiated) ||
            label(a.project_id).localeCompare(label(b.project_id)),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, projectById],
  )

  const addOptions = useMemo<SearchSelectOption[]>(() => {
    const picked = new Set(data?.selectedProjectIds ?? [])
    return projectSearchOptions(projects.filter((p) => !picked.has(p.id)))
  }, [projects, data])

  async function handleAdd(projectId: string | null) {
    if (!account || !projectId) return
    if (await setOverviewProject(instance, account, projectId, true)) void load()
  }

  async function handleRemove(projectId: string) {
    if (!account) return
    setData((prev) =>
      prev && {
        ...prev,
        selectedProjectIds: prev.selectedProjectIds.filter((id) => id !== projectId),
        rows: prev.rows.filter((r) => r.project_id !== projectId),
      },
    )
    if (!(await setOverviewProject(instance, account, projectId, false))) void load()
  }

  const setup = (data?.columns ?? []).filter((c) => c.phase === 'setup')
  const recurring = (data?.columns ?? []).filter((c) => c.phase === 'recurring')
  const columns = [...setup, ...recurring]
  // With no initiated project there are no checklist columns, but the merged cell still needs one to span.
  const checklistSpan = Math.max(columns.length, 1)

  return (
    <div className="w-full px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-legacy-blue-dark">Overview</h1>
          <p className="mt-1 text-sm text-legacy-blue-light">
            Checklist progress across the projects you've chosen to track here. This list is
            separate from your Added projects.
          </p>
        </div>
        <div className="w-64">
          <SearchSelect
            label="Add a project to Overview"
            options={addOptions}
            value={null}
            onChange={(id) => void handleAdd(id)}
            allLabel="Choose a project…"
            placeholder="Search projects…"
          />
        </div>
      </div>

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-legacy-blue-light">Loading…</p>
        ) : failed && !data ? (
          <p className="text-sm text-legacy-red">Couldn't load the overview. Try again in a moment.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-legacy-blue-light">
            No projects on your Overview yet. Add one above.
          </p>
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
                        i === 0 || i === setup.length ? 'border-l-2 border-l-legacy-blue-dark/40' : ''
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
                {rows.map((row) => {
                  const done = new Set(row.done)
                  const na = new Set(row.na)
                  const project = projectById.get(row.project_id)
                  return (
                    <tr key={row.project_id} className="group hover:bg-legacy-blue-light/5">
                      <th className="sticky left-0 z-10 w-56 min-w-56 max-w-56 border-b border-r border-legacy-blue-light/15 bg-white px-3 py-1 text-left font-medium group-hover:bg-legacy-blue-light/5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">
                            {project?.job_number && (
                              <span className="mr-1.5 font-normal text-legacy-blue-light">
                                {project.job_number}
                              </span>
                            )}
                            {label(row.project_id)}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleRemove(row.project_id)}
                            title="Remove from Overview"
                            aria-label={`Remove ${label(row.project_id)} from Overview`}
                            className="shrink-0 text-legacy-blue-light opacity-0 hover:text-legacy-red focus:opacity-100 group-hover:opacity-100"
                          >
                            ×
                          </button>
                        </div>
                      </th>
                      {row.initiated ? (
                        columns.length === 0 ? (
                          <td />
                        ) : (
                          columns.map((col, i) => (
                            <Cell
                              key={col.id}
                              state={na.has(col.id) ? 'na' : done.has(col.id) ? 'done' : 'open'}
                              groupStart={i === 0 || i === setup.length}
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
