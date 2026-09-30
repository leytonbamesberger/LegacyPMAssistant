import { useMemo, useState } from 'react'
import type { Project } from '../lib/projects'
import { isRecurringTaskDue, type Task } from '../lib/tasks'

const TYPE_LABEL: Record<Task['type'], string> = {
  project: 'Project',
  person: 'Person',
  personal: 'Personal',
}

export function MyTasksSection({
  tasks,
  projects,
  nameFor,
  currentProfileId,
  onAddTask,
  onSetStatus,
  onCompleteRecurring,
  onDelete,
}: {
  tasks: Task[]
  projects: Project[]
  nameFor: (profileId: string | null) => string
  currentProfileId: string | null
  onAddTask: () => void
  onSetStatus: (taskId: string, status: 'open' | 'done') => Promise<void>
  onCompleteRecurring: (taskId: string) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
}) {
  const [projectFilter, setProjectFilter] = useState<string>('all')

  const taskProjectIds = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.project_id).filter((id): id is string => !!id))),
    [tasks],
  )
  const filterableProjects = projects.filter((p) => taskProjectIds.includes(p.id))

  const filtered = tasks.filter((t) => {
    if (projectFilter === 'all') return true
    if (projectFilter === 'none') return t.project_id === null
    return t.project_id === projectFilter
  })

  const sorted = [...filtered].sort((a, b) => {
    const aOpen = a.is_recurring || a.status === 'open'
    const bOpen = b.is_recurring || b.status === 'open'
    if (aOpen !== bOpen) return aOpen ? -1 : 1
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date.localeCompare(b.due_date)
  })

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-legacy-blue-dark">My Tasks</h2>
          <p className="mt-1 text-sm text-legacy-blue-light">
            Everything assigned to or by you, across every project.
          </p>
        </div>
        <button
          type="button"
          onClick={onAddTask}
          className="rounded-full border border-legacy-blue-light/30 px-3 py-1.5 text-xs font-medium text-legacy-blue-dark hover:border-legacy-blue-dark"
        >
          + Add Task
        </button>
      </div>

      {taskProjectIds.length > 0 && (
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="mt-3 rounded border border-legacy-blue-light/30 px-2 py-1 text-xs text-legacy-blue-dark"
        >
          <option value="all">All Projects</option>
          <option value="none">No Project</option>
          {filterableProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      <div className="mt-3 divide-y divide-legacy-blue-light/15 rounded-lg border border-legacy-blue-light/25">
        {sorted.length === 0 ? (
          <p className="px-3 py-4 text-sm text-legacy-blue-light">No tasks.</p>
        ) : (
          sorted.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              projectName={projects.find((p) => p.id === task.project_id)?.name ?? null}
              nameFor={nameFor}
              currentProfileId={currentProfileId}
              onSetStatus={onSetStatus}
              onCompleteRecurring={onCompleteRecurring}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </div>
  )
}

function TaskRow({
  task,
  projectName,
  nameFor,
  currentProfileId,
  onSetStatus,
  onCompleteRecurring,
  onDelete,
}: {
  task: Task
  projectName: string | null
  nameFor: (profileId: string | null) => string
  currentProfileId: string | null
  onSetStatus: (taskId: string, status: 'open' | 'done') => Promise<void>
  onCompleteRecurring: (taskId: string) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
}) {
  const isMine = task.assigned_to === currentProfileId
  const handedOff = !isMine
  const due = isRecurringTaskDue(task)

  return (
    <div className="flex items-start gap-2 px-3 py-2.5">
      <input
        type="checkbox"
        checked={task.is_recurring ? false : task.status === 'done'}
        onChange={(e) =>
          task.is_recurring
            ? void onCompleteRecurring(task.id)
            : void onSetStatus(task.id, e.target.checked ? 'done' : 'open')
        }
        title={task.is_recurring ? 'Mark complete for now — resets when due again' : undefined}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-legacy-blue-dark"
      />
      <div className="min-w-0 flex-1">
        <div
          className={`text-sm ${!task.is_recurring && task.status === 'done' ? 'text-legacy-blue-light line-through' : 'text-legacy-blue-dark'}`}
        >
          {task.title}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-legacy-blue-light">
          <span>{TYPE_LABEL[task.type]}</span>
          {projectName && <span>· {projectName}</span>}
          {task.is_recurring ? (
            <span className={due ? 'font-medium text-legacy-red' : ''}>
              · {due ? 'Due now' : `Every ${task.cadence_days}d`}
              {task.last_completed_at && ` · Last: ${formatDate(task.last_completed_at)}`}
            </span>
          ) : (
            task.due_date && <span>· Due {formatDate(task.due_date)}</span>
          )}
          {handedOff && <span>· For {nameFor(task.assigned_to)}</span>}
          {isMine && task.assigned_by && task.assigned_by !== task.assigned_to && (
            <span>· Assigned by {nameFor(task.assigned_by)}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void onDelete(task.id)}
        title="Delete task"
        className="shrink-0 px-1 text-xs text-legacy-blue-light hover:text-legacy-red"
      >
        ×
      </button>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
