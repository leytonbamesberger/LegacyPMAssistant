import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { localToday } from '../lib/dates'
import type { Project } from '../lib/projects'
import type { ProfileDirectoryEntry } from '../lib/profiles'
import type { CadenceUnit, NewTaskInput, Task } from '../lib/tasks'
import { projectSearchOptions } from '../lib/projectOptions'
import { Modal } from './Modal'
import { SearchSelect } from './SearchSelect'

/**
 * Manual task entry and editing — generated checklist tasks don't come through here. There's no
 * "type" to pick: the server sets it from the assignee and project (see inferTaskType in
 * server/tasks.ts).
 *
 * Pass `editing` to open it in edit mode: the form is pre-filled from that task and saves back to the
 * same row (same fields, same validation). The due date is required either way — new tasks start on
 * today's date in the browser's local time zone, and an edited task with no date must be given one.
 */
export function AddTaskModal({
  presetProjectId,
  projects,
  directory,
  currentProfileId,
  editing = null,
  onClose,
  onSave,
}: {
  presetProjectId: string | null
  projects: Project[]
  directory: ProfileDirectoryEntry[]
  currentProfileId: string | null
  /** The manual task being edited; omit to add a new one. */
  editing?: Task | null
  onClose: () => void
  /** Resolves true when saved (the modal closes), false when it failed (the modal stays open). */
  onSave: (fields: NewTaskInput) => Promise<boolean>
}) {
  const [title, setTitle] = useState(editing?.title ?? '')
  const [projectId, setProjectId] = useState<string | null>(editing ? editing.project_id : presetProjectId)
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [assignedTo, setAssignedTo] = useState(editing ? (editing.assignee_ids[0] ?? '') : (currentProfileId ?? ''))
  // Local-time today for a new task (never UTC); an edited task keeps its date, or is blank if it has none.
  const [dueDate, setDueDate] = useState(editing ? (editing.due_date ?? '') : localToday())
  const [visibility, setVisibility] = useState<'private' | 'public'>(editing?.visibility ?? 'private')
  const [isRecurring, setIsRecurring] = useState(editing?.is_recurring ?? false)
  const [cadenceValue, setCadenceValue] = useState(String(editing?.cadence_value ?? 1))
  const [cadenceUnit, setCadenceUnit] = useState<CadenceUnit>(editing?.cadence_unit ?? 'week')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const projectOptions = useMemo(() => projectSearchOptions(projects), [projects])
  // Visibility only matters for a task that will end up personal: nobody else assigned, no project.
  const isPersonal = !projectId && (!assignedTo || assignedTo === currentProfileId)
  // A finished task is history (its next cycle already exists), so its repeat settings are read-only.
  const repeatLocked = editing?.status === 'complete'
  const dueDateValid = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && Number(dueDate.slice(0, 4)) >= 1900
  const canSave = !!title.trim() && !!assignedTo && dueDateValid && !saving

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setFailed(false)
    // The modal can only pick one assignee; a task that somehow has several keeps them unless the pick changes.
    const original = editing?.assignee_ids ?? []
    const assigneeIds = original.length > 1 && assignedTo === original[0] ? original : [assignedTo]
    const ok = await onSave({
      projectId,
      title: title.trim(),
      description: null,
      notes: notes.trim() ? notes : null,
      dueDate,
      assigneeIds,
      visibility,
      isRecurring,
      cadenceValue: isRecurring ? Number(cadenceValue) || 1 : null,
      cadenceUnit: isRecurring ? cadenceUnit : null,
    })
    setSaving(false)
    if (ok) onClose()
    else setFailed(true)
  }

  const heading = editing ? 'Edit Task' : 'Add Task'
  return (
    <Modal onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-legacy-blue-dark">{heading}</h2>
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
          aria-label="Task title"
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
        <div className="flex flex-wrap items-center gap-2">
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
            required
            value={dueDate}
            min="1900-01-01"
            onChange={(e) => setDueDate(e.target.value)}
            aria-label={isRecurring ? 'First due date' : 'Due date'}
            title={isRecurring ? 'First due date' : 'Due date'}
            className={`rounded border px-2 py-1 text-xs text-legacy-blue-dark ${
              dueDateValid ? 'border-legacy-blue-light/30' : 'border-legacy-red'
            }`}
          />
          {!dueDateValid && <span className="text-xs text-legacy-red">Due date required</span>}
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
        <label className="flex flex-wrap items-center gap-2 text-xs text-legacy-blue-dark">
          <input
            type="checkbox"
            checked={isRecurring}
            disabled={repeatLocked}
            onChange={(e) => setIsRecurring(e.target.checked)}
            className="h-3.5 w-3.5 accent-legacy-blue-dark"
          />
          <span>Recurring</span>
          {isRecurring && (
            <>
              <span>every</span>
              <input
                type="number"
                min={1}
                value={cadenceValue}
                disabled={repeatLocked}
                onChange={(e) => setCadenceValue(e.target.value)}
                className="w-14 rounded border border-legacy-blue-light/30 px-1.5 py-0.5 text-xs text-legacy-blue-dark"
              />
              <select
                value={cadenceUnit}
                disabled={repeatLocked}
                onChange={(e) => setCadenceUnit(e.target.value as CadenceUnit)}
                className="rounded border border-legacy-blue-light/30 px-1.5 py-0.5 text-xs text-legacy-blue-dark"
              >
                <option value="day">days</option>
                <option value="week">weeks</option>
                <option value="month">months</option>
              </select>
            </>
          )}
        </label>
        {editing && isRecurring && (
          <p className="text-xs text-legacy-blue-light">
            {repeatLocked
              ? 'This one is done and its next cycle already exists — change the repeat on the open task in Tasks.'
              : 'A new repeat applies to the cycles created after this one; cycles that already exist keep theirs.'}
          </p>
        )}
        {failed && (
          <p role="alert" className="text-xs text-legacy-red">
            Couldn’t save the task — try again.
          </p>
        )}
        <button
          type="submit"
          disabled={!canSave}
          className="rounded-full bg-legacy-blue-dark px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        >
          {saving ? 'Saving…' : editing ? 'Save' : 'Add Task'}
        </button>
      </form>
    </Modal>
  )
}
