import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Project } from '../lib/projects'
import type { ProfileDirectoryEntry } from '../lib/profiles'
import type { NewTaskInput, Task } from '../lib/tasks'

const TYPE_LABEL: Record<Task['type'], string> = {
  project: 'Project',
  person: 'Person',
  personal: 'Personal',
}

export function MyTasksSection({
  tasks,
  projects,
  directory,
  nameFor,
  currentProfileId,
  onCreate,
  onSetStatus,
  onDelete,
}: {
  tasks: Task[]
  projects: Project[]
  directory: ProfileDirectoryEntry[]
  nameFor: (profileId: string | null) => string
  currentProfileId: string | null
  onCreate: (fields: NewTaskInput) => Promise<void>
  onSetStatus: (taskId: string, status: 'open' | 'done') => Promise<void>
  onDelete: (taskId: string) => Promise<void>
}) {
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [showAddForm, setShowAddForm] = useState(false)

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
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1
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
          onClick={() => setShowAddForm((v) => !v)}
          className="rounded-full border border-legacy-blue-light/30 px-3 py-1.5 text-xs font-medium text-legacy-blue-dark hover:border-legacy-blue-dark"
        >
          {showAddForm ? 'Cancel' : '+ Add Task'}
        </button>
      </div>

      {showAddForm && (
        <AddTaskForm
          projects={projects}
          directory={directory}
          currentProfileId={currentProfileId}
          onCreate={async (fields) => {
            await onCreate(fields)
            setShowAddForm(false)
          }}
        />
      )}

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
  onDelete,
}: {
  task: Task
  projectName: string | null
  nameFor: (profileId: string | null) => string
  currentProfileId: string | null
  onSetStatus: (taskId: string, status: 'open' | 'done') => Promise<void>
  onDelete: (taskId: string) => Promise<void>
}) {
  const isMine = task.assigned_to === currentProfileId
  const handedOff = !isMine

  return (
    <div className="flex items-start gap-2 px-3 py-2.5">
      <input
        type="checkbox"
        checked={task.status === 'done'}
        onChange={(e) => void onSetStatus(task.id, e.target.checked ? 'done' : 'open')}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-legacy-blue-dark"
      />
      <div className="min-w-0 flex-1">
        <div
          className={`text-sm ${task.status === 'done' ? 'text-legacy-blue-light line-through' : 'text-legacy-blue-dark'}`}
        >
          {task.title}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-legacy-blue-light">
          <span>{TYPE_LABEL[task.type]}</span>
          {projectName && <span>· {projectName}</span>}
          {task.due_date && <span>· Due {formatDate(task.due_date)}</span>}
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

function AddTaskForm({
  projects,
  directory,
  currentProfileId,
  onCreate,
}: {
  projects: Project[]
  directory: ProfileDirectoryEntry[]
  currentProfileId: string | null
  onCreate: (fields: NewTaskInput) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<Task['type']>('personal')
  const [projectId, setProjectId] = useState('')
  const [assignedTo, setAssignedTo] = useState(currentProfileId ?? '')
  const [dueDate, setDueDate] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !assignedTo || saving) return
    setSaving(true)
    await onCreate({
      type,
      projectId: projectId || null,
      title: title.trim(),
      description: null,
      dueDate: dueDate || null,
      assignedTo,
      visibility,
    })
    setSaving(false)
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="mt-3 space-y-2 rounded-lg border border-legacy-blue-light/25 bg-legacy-blue-light/5 p-3"
    >
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
        className="w-full rounded border border-legacy-blue-light/30 px-2 py-1.5 text-sm text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as Task['type'])}
          className="rounded border border-legacy-blue-light/30 px-2 py-1 text-xs text-legacy-blue-dark"
        >
          <option value="personal">Personal</option>
          <option value="person">Person</option>
          <option value="project">Project</option>
        </select>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded border border-legacy-blue-light/30 px-2 py-1 text-xs text-legacy-blue-dark"
        >
          <option value="">No Project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          className="rounded border border-legacy-blue-light/30 px-2 py-1 text-xs text-legacy-blue-dark"
        >
          {directory.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === currentProfileId ? 'Me' : (p.display_name ?? 'Unnamed')}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded border border-legacy-blue-light/30 px-2 py-1 text-xs text-legacy-blue-dark"
        />
        {type === 'personal' && (
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}
            className="rounded border border-legacy-blue-light/30 px-2 py-1 text-xs text-legacy-blue-dark"
          >
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        )}
      </div>
      <button
        type="submit"
        disabled={saving || !title.trim()}
        className="rounded-full bg-legacy-blue-dark px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
      >
        Add Task
      </button>
    </form>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
