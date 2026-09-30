import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Project } from '../lib/projects'
import type { ProfileDirectoryEntry } from '../lib/profiles'
import type { NewTaskInput, Task } from '../lib/tasks'
import { Modal } from './Modal'

/** Same modal/form used by My Tasks' "+ Add Task" and each project card's "+" button. */
export function AddTaskModal({
  presetProjectId,
  projects,
  directory,
  currentProfileId,
  onClose,
  onCreate,
}: {
  presetProjectId: string | null
  projects: Project[]
  directory: ProfileDirectoryEntry[]
  currentProfileId: string | null
  onClose: () => void
  onCreate: (fields: NewTaskInput) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<Task['type']>('personal')
  const [projectId, setProjectId] = useState(presetProjectId ?? '')
  const [assignedTo, setAssignedTo] = useState(currentProfileId ?? '')
  const [dueDate, setDueDate] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [isRecurring, setIsRecurring] = useState(false)
  const [cadenceDays, setCadenceDays] = useState('7')
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
      dueDate: isRecurring ? null : dueDate || null,
      assignedTo,
      visibility,
      isRecurring,
      cadenceDays: isRecurring ? Number(cadenceDays) || 7 : null,
    })
    setSaving(false)
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-legacy-blue-dark">Add Task</h2>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-legacy-blue-light hover:text-legacy-red"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-3 space-y-2">
        <input
          type="text"
          autoFocus
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
          {!isRecurring && (
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded border border-legacy-blue-light/30 px-2 py-1 text-xs text-legacy-blue-dark"
            />
          )}
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
        <label className="flex items-center gap-2 text-xs text-legacy-blue-dark">
          <input
            type="checkbox"
            checked={isRecurring}
            onChange={(e) => setIsRecurring(e.target.checked)}
            className="h-3.5 w-3.5 accent-legacy-blue-dark"
          />
          Recurring
          {isRecurring && (
            <>
              every
              <input
                type="number"
                min={1}
                value={cadenceDays}
                onChange={(e) => setCadenceDays(e.target.value)}
                className="w-14 rounded border border-legacy-blue-light/30 px-1.5 py-0.5 text-xs text-legacy-blue-dark"
              />
              days
            </>
          )}
        </label>
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="rounded-full bg-legacy-blue-dark px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        >
          Add Task
        </button>
      </form>
    </Modal>
  )
}
