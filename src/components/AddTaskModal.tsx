import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Project } from '../lib/projects'
import type { ProfileDirectoryEntry } from '../lib/profiles'
import type { CadenceUnit, NewTaskInput } from '../lib/tasks'
import { projectSearchOptions } from '../lib/projectOptions'
import { Modal } from './Modal'
import { SearchSelect } from './SearchSelect'

/**
 * Manual task entry — generated checklist and flow tasks don't come through
 * here. There's no "type" to pick: the server sets it from the assignee and
 * project (see inferTaskType in server/tasks.ts).
 */
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
  const [projectId, setProjectId] = useState<string | null>(presetProjectId)
  const [notes, setNotes] = useState('')
  const [assignedTo, setAssignedTo] = useState(currentProfileId ?? '')
  const [dueDate, setDueDate] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [isRecurring, setIsRecurring] = useState(false)
  const [cadenceValue, setCadenceValue] = useState('1')
  const [cadenceUnit, setCadenceUnit] = useState<CadenceUnit>('week')
  const [saving, setSaving] = useState(false)

  const projectOptions = useMemo(() => projectSearchOptions(projects), [projects])
  // Visibility only matters for a task that will end up personal: nobody else assigned, no project.
  const isPersonal = !projectId && (!assignedTo || assignedTo === currentProfileId)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !assignedTo || saving) return
    // The next cycle's due date is computed from this one, so recurring needs a date.
    if (isRecurring && !dueDate) return
    setSaving(true)
    await onCreate({
      projectId,
      title: title.trim(),
      description: null,
      notes: notes.trim() ? notes : null,
      dueDate: dueDate || null,
      assigneeIds: [assignedTo],
      visibility,
      isRecurring,
      cadenceValue: isRecurring ? Number(cadenceValue) || 1 : null,
      cadenceUnit: isRecurring ? cadenceUnit : null,
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
        <SearchSelect
          label="Project"
          options={projectOptions}
          value={projectId}
          onChange={setProjectId}
          allLabel="No project"
          placeholder="Search projects…"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            aria-label="Assigned to"
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
            aria-label={isRecurring ? 'First due date' : 'Due date'}
            title={isRecurring ? 'First due date' : 'Due date'}
            className="rounded border border-legacy-blue-light/30 px-2 py-1 text-xs text-legacy-blue-dark"
          />
          {isPersonal && (
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}
              aria-label="Visibility"
              className="rounded border border-legacy-blue-light/30 px-2 py-1 text-xs text-legacy-blue-dark"
            >
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
          )}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          aria-label="Notes"
          rows={3}
          className="w-full resize-y rounded border border-legacy-blue-light/30 px-2 py-1.5 text-sm text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
        />
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
                value={cadenceValue}
                onChange={(e) => setCadenceValue(e.target.value)}
                className="w-14 rounded border border-legacy-blue-light/30 px-1.5 py-0.5 text-xs text-legacy-blue-dark"
              />
              <select
                value={cadenceUnit}
                onChange={(e) => setCadenceUnit(e.target.value as CadenceUnit)}
                className="rounded border border-legacy-blue-light/30 px-1.5 py-0.5 text-xs text-legacy-blue-dark"
              >
                <option value="day">days</option>
                <option value="week">weeks</option>
                <option value="month">months</option>
              </select>
              <span className="text-legacy-blue-light">(needs a first due date)</span>
            </>
          )}
        </label>
        <button
          type="submit"
          disabled={saving || !title.trim() || (isRecurring && !dueDate)}
          className="rounded-full bg-legacy-blue-dark px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        >
          Add Task
        </button>
      </form>
    </Modal>
  )
}
