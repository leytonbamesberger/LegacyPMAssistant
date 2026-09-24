import { useState } from 'react'
import type { Project } from '../lib/projects'
import type { ProjectChecklistStatus } from '../lib/checklist'
import type { FlowReport } from '../lib/flowReports'
import type { ProfileDirectoryEntry } from '../lib/profiles'
import type { Task } from '../lib/tasks'
import { SetupCloseoutBadge, WeeklyBadge } from './ProjectChecklistBadge'

const FLOW_STATUS_LABEL: Record<FlowReport['status'], string> = {
  not_started: 'Flow: Not Started',
  in_progress: 'Flow: In Progress',
  completed: 'Flow: Completed',
}

const FLOW_STATUS_CLASS: Record<FlowReport['status'], string> = {
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
  onLogWeeklyItem,
  onReassign,
  onCompleteTask,
}: {
  project: Project
  checklist: ProjectChecklistStatus | undefined
  flowReportStatus: FlowReport['status'] | undefined
  myOpenTasks: Task[]
  directory: ProfileDirectoryEntry[]
  nameFor: (profileId: string | null) => string
  onToggleChecklistItem: (checklistItemId: string, done: boolean) => void
  onLogWeeklyItem: (checklistItemId: string) => void
  onReassign: (field: 'pm_id' | 'apm_id', profileId: string | null) => void
  onCompleteTask: (taskId: string) => void
}) {
  const showCloseout = project.status === 'closing' || project.status === 'closed'

  return (
    <div className="rounded-lg border border-legacy-blue-light/25 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-legacy-blue-dark">
            {project.name}
          </h3>
          <p className="text-xs text-legacy-blue-light">
            {project.job_number ?? 'No job number'}
            {project.gc ? ` · ${project.gc}` : ''}
          </p>
        </div>
        {project.status !== 'active' && (
          <span className="shrink-0 rounded-full border border-legacy-red/40 px-2 py-0.5 text-xs font-medium capitalize text-legacy-red">
            {project.status}
          </span>
        )}
      </div>

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

      {project.checklist_enabled && checklist && (
        <div className="mt-3 flex flex-wrap gap-2">
          <SetupCloseoutBadge
            phase="setup"
            items={checklist.setup}
            onToggle={onToggleChecklistItem}
            nameFor={nameFor}
          />
          <WeeklyBadge items={checklist.weekly} onLog={onLogWeeklyItem} />
          {showCloseout && (
            <SetupCloseoutBadge
              phase="closeout"
              items={checklist.closeout}
              onToggle={onToggleChecklistItem}
              nameFor={nameFor}
            />
          )}
        </div>
      )}

      {flowReportStatus && (
        <div className="mt-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${FLOW_STATUS_CLASS[flowReportStatus]}`}
          >
            {FLOW_STATUS_LABEL[flowReportStatus]}
          </span>
        </div>
      )}

      {myOpenTasks.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-legacy-blue-light/15 pt-2">
          {myOpenTasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                onChange={() => onCompleteTask(task.id)}
                className="h-3.5 w-3.5 shrink-0 accent-legacy-blue-dark"
              />
              <span className="text-legacy-blue-dark">{task.title}</span>
              {task.due_date && (
                <span className="text-legacy-blue-light">
                  · Due {new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
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
