import { useMemo } from 'react'
import { SlideOutPanel } from './SlideOutPanel'
import { useProject } from '../contexts/ProjectContext'
import { useProfile } from '../contexts/ProfileContext'
import { useChecklist } from '../contexts/ChecklistContext'
import { useFlowReport } from '../contexts/FlowReportContext'
import type { ChecklistItemStatus } from '../lib/checklist'
import type { FlowReport } from '../lib/flowReports'
import {
  buildCellLookup,
  buildColumnsByPhase,
  buildPmGroups,
  PHASES,
  type ColumnDef,
  type Phase,
  type PmGroup,
} from '../lib/checklistGrid'
import { FLOW_STATUS_LABEL } from './ProjectCard'

const PHASE_LABEL: Record<Phase, string> = {
  setup: 'Setup',
  recurring: 'Recurring',
  closeout: 'Closeout',
}

// Thicker/darker divider at the start of each category (Setup/Recurring/Closeout/Flow Status)
// so the category boundaries read clearly top-to-bottom, vs. the thin divider between individual
// items within the same category.
const CATEGORY_DIVIDER = 'border-l-2 border-legacy-blue-light/50'
const ITEM_DIVIDER = 'border-l border-legacy-blue-light/15'

/**
 * Slide-out drawer (same shell as CalendarPanel) with a grid version of the
 * old Excel checklist: starred projects (grouped by PM) as rows, every
 * checklist item (grouped Setup / Recurring / Closeout) plus a Flow Status
 * column as columns. Reads/writes through ChecklistContext and
 * FlowReportContext — the same state the project cards use — so an edit here
 * shows up on the card (and vice versa) without a reload.
 */
export function ChecklistPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { projects } = useProject()
  const { nameFor } = useProfile()
  const { checklistByProject, loading, toggleItem, logItem, setSetupDate, setSchedule } = useChecklist()
  const { statusByProject: flowStatusByProject, openFlowReportModal } = useFlowReport()

  const starredProjects = useMemo(() => projects.filter((p) => p.isStarred), [projects])

  const groups = useMemo(() => buildPmGroups(starredProjects, nameFor), [starredProjects, nameFor])

  const columnsByPhase = useMemo(
    () => buildColumnsByPhase(starredProjects, checklistByProject),
    [starredProjects, checklistByProject],
  )

  const cellLookup = useMemo(() => buildCellLookup(checklistByProject), [checklistByProject])

  return (
    <SlideOutPanel open={open} onClose={onClose} title="Project Checklist">
      {/* No left padding here — position:sticky sticks to the padding edge, not the clip
          (border) edge, so left padding on this container would leave a strip inside the clip
          bounds but outside the sticky column's own opaque background, letting scrolled-past
          columns show through. Left inset is applied per-element below instead (pl-4). */}
      <div className="relative flex-1 overflow-auto py-4 pr-4">
        {loading && (
          <p className="absolute right-6 top-6 text-xs text-legacy-blue-light">Loading…</p>
        )}

        {starredProjects.length === 0 ? (
          <p className="pl-4 text-sm text-legacy-blue-light">
            No starred projects yet. Star a project from the sidebar to see it here.
          </p>
        ) : (
          <table className="min-w-max border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 min-w-[220px] border-b border-r border-legacy-blue-light/25 bg-white py-2 pl-4 pr-2 text-left text-xs font-semibold uppercase tracking-wide text-legacy-blue-light">
                  Project
                </th>
                {PHASES.map((phase) => (
                  <th
                    key={phase}
                    colSpan={Math.max(columnsByPhase[phase].length, 1)}
                    className={`sticky top-0 z-10 border-b bg-legacy-blue-light/10 px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-legacy-blue-dark ${CATEGORY_DIVIDER}`}
                  >
                    {PHASE_LABEL[phase]}
                  </th>
                ))}
                <th
                  rowSpan={2}
                  className={`sticky top-0 z-10 min-w-[120px] border-b bg-white px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-legacy-blue-light ${CATEGORY_DIVIDER}`}
                >
                  Flow Status
                </th>
              </tr>
              <tr>
                <th className="sticky left-0 top-8 z-20 border-b border-r border-legacy-blue-light/25 bg-white" />
                {PHASES.map((phase) =>
                  columnsByPhase[phase].length > 0 ? (
                    columnsByPhase[phase].map((col, index) => (
                      <th
                        key={col.id}
                        className={`sticky top-8 z-10 w-[126px] border-b bg-white px-1.5 py-1.5 text-left text-xs font-medium text-legacy-blue-dark ${index === 0 ? CATEGORY_DIVIDER : ITEM_DIVIDER}`}
                      >
                        {col.name}
                      </th>
                    ))
                  ) : (
                    <th
                      key={`${phase}-empty`}
                      className={`sticky top-8 z-10 w-[126px] border-b bg-white px-1.5 py-1.5 text-left text-xs italic text-legacy-blue-light ${CATEGORY_DIVIDER}`}
                    >
                      No items yet
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <PmGroupRows
                  key={group.pmId ?? 'unassigned'}
                  group={group}
                  columnsByPhase={columnsByPhase}
                  cellLookup={cellLookup}
                  flowStatusByProject={flowStatusByProject}
                  onToggle={toggleItem}
                  onLog={logItem}
                  onSetSetupDate={setSetupDate}
                  onSetSchedule={setSchedule}
                  onOpenFlowReport={openFlowReportModal}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </SlideOutPanel>
  )
}

function PmGroupRows({
  group,
  columnsByPhase,
  cellLookup,
  flowStatusByProject,
  onToggle,
  onLog,
  onSetSetupDate,
  onSetSchedule,
  onOpenFlowReport,
}: {
  group: PmGroup
  columnsByPhase: Record<Phase, ColumnDef[]>
  cellLookup: Map<string, ChecklistItemStatus>
  flowStatusByProject: Record<string, FlowReport['status']>
  onToggle: (projectId: string, checklistItemId: string, done: boolean) => void
  onLog: (projectId: string, checklistItemId: string) => void
  onSetSetupDate: (projectId: string, checklistItemId: string, date: string) => void
  onSetSchedule: (projectId: string, checklistItemId: string, date: string | null) => void
  onOpenFlowReport: (projectId: string) => void
}) {
  return (
    <>
      <tr>
        {/* Browsers don't reliably keep `position: sticky` working on a colSpan'd cell — it
            silently stops sticking and scrolls away with the rest of the row. Split the PM
            label into its own single-column sticky cell (same pattern as the project rows'
            sticky cell below, opaque bg required for the same reason) plus a plain filler
            cell carrying the tint across the remaining columns. */}
        <td className="sticky left-0 z-10 border-b border-r border-legacy-blue-light/15 bg-[#f2f5f7] py-1 pl-4 pr-2 text-xs font-semibold text-legacy-blue-dark">
          {group.pmName}
        </td>
        {/* Segmented per phase (not one big colSpan) so the category divider lines pass
            through this row too, continuous with the header above and the rows below. */}
        {PHASES.map((phase) => (
          <td
            key={phase}
            colSpan={Math.max(columnsByPhase[phase].length, 1)}
            className={`border-b bg-legacy-blue-dark/5 ${CATEGORY_DIVIDER}`}
          />
        ))}
        <td className={`border-b bg-legacy-blue-dark/5 ${CATEGORY_DIVIDER}`} />
      </tr>
      {group.projects.map((project) => (
        <tr key={project.id} className="group">
          {/* Sticky column: background must stay fully opaque (incl. hover) and own its right
              edge with a border-r, rather than relying on the neighboring scrollable column's
              border-l — that border scrolls away with its cell, leaving this edge unbounded. */}
          <td className="sticky left-0 z-10 border-b border-r border-legacy-blue-light/15 bg-white py-1.5 pl-4 pr-2 text-legacy-blue-dark group-hover:bg-[#f3f5f7]">
            <span className="font-medium">{project.job_number ?? '—'}</span> — {project.name}
          </td>
          {PHASES.map((phase) =>
            columnsByPhase[phase].length > 0 ? (
              columnsByPhase[phase].map((col, index) => (
                <ChecklistCell
                  key={col.id}
                  phase={phase}
                  isCategoryStart={index === 0}
                  status={cellLookup.get(`${project.id}:${col.id}`)}
                  onToggle={(done) => onToggle(project.id, col.id, done)}
                  onLog={() => onLog(project.id, col.id)}
                  onSetSetupDate={(date) => onSetSetupDate(project.id, col.id, date)}
                  onSetSchedule={(date) => onSetSchedule(project.id, col.id, date)}
                />
              ))
            ) : (
              <td
                key={`${phase}-empty`}
                className={`border-b px-1.5 py-1.5 text-center text-legacy-blue-light ${CATEGORY_DIVIDER}`}
              >
                —
              </td>
            ),
          )}
          <td className={`border-b px-2 py-1.5 ${CATEGORY_DIVIDER}`}>
            {flowStatusByProject[project.id] ? (
              <button
                type="button"
                onClick={() => onOpenFlowReport(project.id)}
                className={`text-xs font-medium underline-offset-2 hover:underline ${
                  flowStatusByProject[project.id] === 'in_progress'
                    ? 'text-legacy-red'
                    : flowStatusByProject[project.id] === 'completed'
                      ? 'text-legacy-blue-dark'
                      : 'text-legacy-blue-light'
                }`}
                title={FLOW_STATUS_LABEL[flowStatusByProject[project.id]]}
              >
                {FLOW_STATUS_LABEL[flowStatusByProject[project.id]].replace('Flow: ', '')}
              </button>
            ) : (
              <span className="text-xs text-legacy-blue-light">—</span>
            )}
          </td>
        </tr>
      ))}
    </>
  )
}

/** Not applicable (excluded, or never part of this project's item set) renders as a dash, not an unchecked box. */
function ChecklistCell({
  phase,
  isCategoryStart,
  status,
  onToggle,
  onLog,
  onSetSetupDate,
  onSetSchedule,
}: {
  phase: Phase
  /** First item column of its phase — gets the thicker category divider instead of the thin item one. */
  isCategoryStart: boolean
  status: ChecklistItemStatus | undefined
  onToggle: (done: boolean) => void
  onLog: () => void
  onSetSetupDate: (date: string) => void
  onSetSchedule: (date: string | null) => void
}) {
  const divider = isCategoryStart ? CATEGORY_DIVIDER : ITEM_DIVIDER

  if (!status) {
    return (
      <td className={`border-b px-1.5 py-1.5 text-center text-legacy-blue-light ${divider}`}>
        <span aria-hidden className="select-none">
          - - -
        </span>
        <span className="sr-only">Not applicable</span>
      </td>
    )
  }

  const isRecurring = phase === 'recurring'
  // Recurring has no "uncheck" in the data model (logging always appends a
  // new history row) — checked reflects "satisfied for this cycle" and only
  // the false -> true transition does anything, same as the existing Log button.
  const checked = isRecurring ? !status.due : status.done
  const dateValue = isRecurring ? (status.scheduledDate ?? '') : (status.completedAt?.slice(0, 10) ?? '')

  return (
    <td className={`border-b px-1.5 py-1.5 ${divider}`}>
      <div className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            if (isRecurring) {
              if (e.target.checked) onLog()
              return
            }
            onToggle(e.target.checked)
          }}
          title={status.item.name}
          className="h-3.5 w-3.5 shrink-0 accent-legacy-blue-dark"
        />
        <input
          type="date"
          value={dateValue}
          onChange={(e) => {
            if (isRecurring) {
              onSetSchedule(e.target.value || null)
            } else if (e.target.value) {
              onSetSetupDate(e.target.value)
            }
          }}
          title={
            isRecurring
              ? "Schedule marker only — doesn't complete this item"
              : 'Setting a date completes this item'
          }
          className="w-[92px] rounded border border-legacy-blue-light/30 px-1 py-0.5 text-xs text-legacy-blue-dark"
        />
      </div>
    </td>
  )
}
