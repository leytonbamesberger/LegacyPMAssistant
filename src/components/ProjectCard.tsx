import { useState } from 'react'
import type { Project } from '../lib/projects'
import type { ProjectChecklistStatus } from '../lib/checklist'
import type { FlowReport } from '../lib/flowReports'
import type { ProfileDirectoryEntry } from '../lib/profiles'
import { isRecurringTaskDue, type Task } from '../lib/tasks'
import { RecurringBadge, SetupCloseoutBadge } from './ProjectChecklistBadge'

export const FLOW_STATUS_LABEL: Record<FlowReport['status'], string> = {
  not_started: 'Flow: Not Started',
  in_progress: 'Flow: In Progress',
  completed: 'Flow: Completed',
}

export const FLOW_STATUS_CLASS: Record<FlowReport['status'], string> = {
  not_started: 'border border-legacy-blue-light/25 text-legacy-blue-light',
  in_progress: 'border border-legacy-red/50 text-legacy-red',
  completed: 'border border-legacy-blue-light/25 bg-legacy-blue-light/5 text-legacy-blue-dark',
}

export function ProjectCard({
  project,
  checklist,
  flowReportStatus,
  myOpenTasks,
  directory,
  nameFor,
  onToggleChecklistItem,
  onLogChecklistItem,
  onAddCustomChecklistItem,
  onRemoveChecklistItem,
  onSetSetupDate,
  onSetSchedule,
  onReassign,
  onCompleteTask,
  onOpenFlowReport,
  onAddTask,
}: {
  project: Project
  checklist: ProjectChecklistStatus | undefined
  flowReportStatus: FlowReport['status'] | undefined
  myOpenTasks: Task[]
  directory: ProfileDirectoryEntry[]
  nameFor: (profileId: string | null) => string
  onToggleChecklistItem: (checklistItemId: string, done: boolean) => void
  onLogChecklistItem: (checklistItemId: string) => void
  onAddCustomChecklistItem: (
    name: string,
    cadenceType: 'rolling' | 'calendar_month',
    cadenceDays: number | null,
  ) => void
  onRemoveChecklistItem: (checklistItemId: string) => void
  onSetSetupDate: (checklistItemId: string, date: string) => void
  onSetSchedule: (checklistItemId: string, date: string | null) => void
  onReassign: (field: 'pm_id' | 'apm_id', profileId: string | null) => void
  onCompleteTask: (taskId: string) => void
  onOpenFlowReport: () => void
  onAddTask: () => void
}) {
  const showCloseout = project.status === 'closing' || project.status === 'closed'
  const hasChecklist = project.checklist_enabled && Boolean(checklist)
  const hasTasks = myOpenTasks.length > 0

  return (
    <div className="relative rounded-lg border border-legacy-blue-light/25 bg-white p-4">
      {project.status !== 'active' && (
        <span className="absolute right-4 top-4 shrink-0 rounded-full border border-legacy-red/40 px-2 py-0.5 text-xs font-medium capitalize text-legacy-red">
          {project.status}
        </span>
      )}

      <h3 className="text-center text-base font-semibold text-legacy-blue-dark">
        {project.name}
      </h3>
      {project.gc && <p className="text-xs text-legacy-blue-light">{project.gc}</p>}

      <div className="mt-3 flex flex-wrap gap-4 text-xs">
        <AssigneePicker
          label="PM"
          profileId={project.pm_id}
          directory={directory}
          nameFor={nameFor}
          onChange={(id) => onReassign('pm_id', id)}
        />
        <AssigneePicker
          label="APM"
          profileId={project.apm_id}
          directory={directory}
          nameFor={nameFor}
          onChange={(id) => onReassign('apm_id', id)}
        />
      </div>

      {(hasChecklist || flowReportStatus) && (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {hasChecklist && checklist && (
            <>
              <SetupCloseoutBadge
                phase="setup"
                items={checklist.setup}
                onToggle={onToggleChecklistItem}
                onSetDate={onSetSetupDate}
                nameFor={nameFor}
              />
              <RecurringBadge
                items={checklist.recurring}
                onLog={onLogChecklistItem}
                onRemove={onRemoveChecklistItem}
                onAddCustom={onAddCustomChecklistItem}
                onSetSchedule={onSetSchedule}
              />
              {showCloseout && (
                <SetupCloseoutBadge
                  phase="closeout"
                  items={checklist.closeout}
                  onToggle={onToggleChecklistItem}
                  nameFor={nameFor}
                />
              )}
            </>
          )}
          {flowReportStatus && (
            <button
              type="button"
              onClick={onOpenFlowReport}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition hover:ring-1 hover:ring-legacy-blue-dark/30 ${FLOW_STATUS_CLASS[flowReportStatus]}`}
            >
              {FLOW_STATUS_LABEL[flowReportStatus]}
            </button>
          )}
        </div>
      )}

      {hasTasks ? (
        <div className="mt-3 border-t border-legacy-blue-light/15 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-legacy-blue-light">Tasks</span>
            <AddTaskButton onClick={onAddTask} />
          </div>
          <ul className="mt-1 space-y-1">
            {myOpenTasks.map((task) => (
              <li key={task.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={task.is_recurring ? false : task.status === 'done'}
                  onChange={() => onCompleteTask(task.id)}
                  title={task.is_recurring ? 'Mark complete for now — resets when due again' : undefined}
                  className="h-3.5 w-3.5 shrink-0 accent-legacy-blue-dark"
                />
                <span className="text-legacy-blue-dark">{task.title}</span>
                {task.is_recurring ? (
                  <span
                    className={isRecurringTaskDue(task) ? 'font-medium text-legacy-red' : 'text-legacy-blue-light'}
                  >
                    · {isRecurringTaskDue(task) ? 'Due now' : `Every ${task.cadence_days}d`}
                  </span>
                ) : (
                  task.due_date && (
                    <span className="text-legacy-blue-light">
                      · Due{' '}
                      {new Date(task.due_date).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  )
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-3 flex justify-end">
          <AddTaskButton onClick={onAddTask} />
        </div>
      )}
    </div>
  )
}

function AddTaskButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Add task"
      aria-label="Add task"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-legacy-blue-light/30 text-sm leading-none text-legacy-blue-light hover:border-legacy-blue-dark hover:text-legacy-blue-dark"
    >
      +
    </button>
  )
}

function AssigneePicker({
  label,
  profileId,
  directory,
  nameFor,
  onChange,
}: {
  label: string
  profileId: string | null
  directory: ProfileDirectoryEntry[]
  nameFor: (profileId: string | null) => string
  onChange: (profileId: string | null) => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <label className="flex items-center gap-1 text-legacy-blue-light">
        {label}
        <select
          autoFocus
          defaultValue={profileId ?? ''}
          onChange={(e) => {
            onChange(e.target.value || null)
            setEditing(false)
          }}
          onBlur={() => setEditing(false)}
          className="rounded border border-legacy-blue-light/30 bg-white px-1 py-0.5 text-xs text-legacy-blue-dark"
        >
          <option value="">Unassigned</option>
          {directory.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name ?? 'Unnamed'}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-legacy-blue-light hover:text-legacy-blue-dark"
      title={`Reassign ${label}`}
    >
      {label}:{' '}
      <span className="font-medium text-legacy-blue-dark">{nameFor(profileId)}</span>
    </button>
  )
}
