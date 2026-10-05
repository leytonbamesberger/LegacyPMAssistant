import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { localToday } from '../lib/dates'
import type { TaskListRow } from '../lib/taskRows'
import { TASK_STATUS_LABEL, type Task, type TaskStatus } from '../lib/tasks'

const STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'complete']
const CATEGORY_LABEL = { setup: 'Setup', recurring: 'Recurring', flow: 'FLOW' } as const

const OPEN_COLUMNS =
  'grid-cols-[7.5rem_minmax(12rem,2.2fr)_minmax(8rem,1.2fr)_minmax(7rem,1fr)_minmax(6rem,0.8fr)_5.5rem_6.5rem_minmax(8rem,1.4fr)_1.25rem]'
const ARCHIVE_COLUMNS =
  'grid-cols-[7.5rem_minmax(12rem,2.2fr)_minmax(8rem,1.2fr)_minmax(7rem,1fr)_minmax(6rem,0.8fr)_5.5rem_5.5rem_6.5rem_minmax(8rem,1.4fr)]'

/**
 * Full-width task rows (not cards) shared by the Tasks and Archive pages. On the Tasks
 * page the rows can also be collapsible groups (recurring tasks by name, a project's Setup
 * bundle) and the one computed FLOW row; the Archive passes plain task rows only.
 */
export function TaskTable({
  rows,
  mode,
  loading,
  error = false,
  onRetry,
  emptyMessage,
  footer,
  currentProfileId,
  projectName,
  nameFor,
  onStatus,
  onDelete,
  onOpenFlowTab,
  onSaveNotes,
  onMeetingDate,
}: {
  rows: TaskListRow[]
  mode: 'open' | 'archive'
  loading: boolean
  /** The last load failed — shown instead of the empty message, which would claim there's nothing there. */
  error?: boolean
  onRetry?: () => void
  emptyMessage: string
  /** Rendered inside the bordered list, under the rows (the Tasks page's Upcoming button). */
  footer?: ReactNode
  currentProfileId: string | null
  projectName: (projectId: string) => string | null
  nameFor: (profileId: string) => string
  onStatus: (task: Task, status: TaskStatus) => void
  onDelete?: (task: Task) => void
  /** Clicking the computed FLOW row goes to the FLOW tab. */
  onOpenFlowTab?: () => void
  /** Persists a task's notes (null clears them). Offered on every task row, generated ones included. */
  onSaveNotes: (task: Task, notes: string | null) => Promise<void>
  /**
   * A meeting task's date input changed: a date completes it, null reopens it. Meeting rows show this
   * date input where every other row shows its status control.
   */
  onMeetingDate?: (task: Task, date: string | null) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  // Groups start collapsed and keep their state across refetches (ids are stable).
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const columns = mode === 'open' ? OPEN_COLUMNS : ARCHIVE_COLUMNS
  const today = localToday()
  const person = (id: string) => (id === currentProfileId ? 'Me' : nameFor(id))

  const headers =
    mode === 'open'
      ? ['Status', 'Task', 'Project', 'Assignees', 'Assigned by', 'Due', 'Repeats', 'Notes', '']
      : [
          'Status',
          'Task',
          'Project',
          'Assignees',
          'Assigned by',
          'Due',
          'Completed',
          'Repeats',
          'Notes',
        ]

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** The Due cell: red when late (open view only). */
  function dueCell(due: string | null, tbd = false, time: string | null = null) {
    const late = mode === 'open' && !!due && due < today
    return (
      <div className={late ? 'font-medium text-legacy-red' : 'text-legacy-blue-dark'}>
        {tbd ? 'TBD' : due ? formatDate(due) : '—'}
        {time && !tbd ? (
          <span className="block text-xs font-normal text-legacy-blue-light">{time.slice(0, 5)}</span>
        ) : null}
      </div>
    )
  }

  function taskRow(task: Task, indented = false) {
    // Reopening a completed recurring task is refused server-side (its next cycle already exists).
    const statusEditable = !(mode === 'archive' && task.is_recurring)
    const generated = task.source_category !== null
    const assignedBy = task.assigned_by ? person(task.assigned_by) : generated ? 'System' : '—'

    return (
      <div key={task.id} className={indented ? 'bg-legacy-blue-light/[0.03]' : undefined}>
        <div className={`grid ${columns} items-start gap-3 px-3 py-2.5 text-sm`}>
          <div>
            {task.is_meeting && onMeetingDate ? (
              <MeetingDateInput
                task={task}
                clearable={mode === 'archive'}
                onCommit={(date) => onMeetingDate(task, date)}
              />
            ) : statusEditable ? (
              <select
                value={task.status}
                onChange={(e) => onStatus(task, e.target.value as TaskStatus)}
                aria-label={`Status of ${task.title}`}
                className="w-full rounded border border-legacy-blue-light/30 px-1 py-1 text-xs text-legacy-blue-dark"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TASK_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="block rounded border border-legacy-blue-light/25 px-1.5 py-1 text-center text-xs text-legacy-blue-light">
                {TASK_STATUS_LABEL[task.status]}
              </span>
            )}
          </div>

          <div className={`min-w-0 ${indented ? 'pl-6' : ''}`}>
            <span
              className={`font-medium ${
                task.status === 'complete' ? 'text-legacy-blue-light' : 'text-legacy-blue-dark'
              }`}
            >
              {task.title}
            </span>
            {task.source_category && (
              <span className="ml-2 rounded-full bg-legacy-blue-light/10 px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-legacy-blue-light">
                {CATEGORY_LABEL[task.source_category]}
              </span>
            )}
          </div>

          <div className="truncate text-legacy-blue-dark">
            {task.project_id ? (projectName(task.project_id) ?? '') : ''}
          </div>
          <div className="text-legacy-blue-dark">{task.assignee_ids.map(person).join(', ')}</div>
          <div className="text-legacy-blue-light">{assignedBy}</div>
          {dueCell(task.due_date, task.is_tbd, task.due_time)}
          {mode === 'archive' && (
            <div className="text-legacy-blue-dark">
              {task.completed_at ? formatDate(task.completed_at.slice(0, 10)) : '—'}
            </div>
          )}
          <div className="text-legacy-blue-light">{cadenceLabel(task)}</div>
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => setEditingId(editingId === task.id ? null : task.id)}
              aria-expanded={editingId === task.id}
              aria-label={`${task.notes ? 'Edit' : 'Add'} notes for ${task.title}`}
              title={task.notes ?? 'Add a note'}
              className={`block w-full truncate text-left hover:text-legacy-blue-dark ${
                task.notes ? 'text-legacy-blue-light' : 'text-legacy-blue-light/50'
              }`}
            >
              {task.notes || '+ Add note'}
            </button>
          </div>
          {mode === 'open' && (
            <div>
              {!generated && onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(task)}
                  title="Delete task"
                  className="text-legacy-blue-light hover:text-legacy-red"
                >
                  ×
                </button>
              )}
            </div>
          )}
        </div>
        {editingId === task.id && (
          <NotesEditor
            task={task}
            onSave={(notes) => onSaveNotes(task, notes)}
            onClose={() => setEditingId(null)}
          />
        )}
      </div>
    )
  }

  function groupRow(row: Extract<TaskListRow, { kind: 'group' }>) {
    const open = openGroups.has(row.id)
    return (
      <div key={row.id}>
        <div className={`grid ${columns} items-start gap-3 px-3 py-2.5 text-sm`}>
          <div />
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => toggleGroup(row.id)}
              aria-expanded={open}
              className="flex items-center gap-1.5 text-left font-medium text-legacy-blue-dark hover:underline"
            >
              <span
                aria-hidden
                className={`inline-block text-[10px] text-legacy-blue-light transition-transform ${
                  open ? 'rotate-90' : ''
                }`}
              >
                ▶
              </span>
              {row.label}
            </button>
          </div>
          <div className="truncate text-legacy-blue-dark">
            {row.projectId ? (projectName(row.projectId) ?? '') : ''}
          </div>
          <div />
          <div />
          {dueCell(row.due)}
          <div />
          <div />
          <div />
        </div>
        {open && (
          <div className="divide-y divide-legacy-blue-light/10 border-t border-legacy-blue-light/10">
            {row.children.map((child) => taskRow(child, true))}
          </div>
        )}
      </div>
    )
  }

  function flowRow(row: Extract<TaskListRow, { kind: 'flow' }>) {
    return (
      <div
        key="flow-row"
        onClick={onOpenFlowTab}
        className={`grid ${columns} cursor-pointer items-start gap-3 px-3 py-2.5 text-sm hover:bg-legacy-blue-light/5`}
      >
        <div />
        <div className="min-w-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenFlowTab?.()
            }}
            className="text-left font-medium text-legacy-blue-dark underline-offset-2 hover:underline"
          >
            FLOW Reports ({row.count})
          </button>
        </div>
        <div />
        <div />
        <div />
        {dueCell(row.due)}
        <div />
        <div />
        <div />
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-legacy-blue-light/25">
      <div className="min-w-[62rem]">
        <div
          className={`grid ${columns} gap-3 border-b border-legacy-blue-light/20 bg-legacy-blue-light/5 px-3 py-2 text-xs font-medium uppercase tracking-wide text-legacy-blue-light`}
        >
          {headers.map((h, i) => (
            <div key={`${h}-${i}`}>{h}</div>
          ))}
        </div>

        {loading ? (
          <p className="px-3 py-4 text-sm text-legacy-blue-light">Loading…</p>
        ) : error && rows.length === 0 ? (
          <p className="px-3 py-4 text-sm text-legacy-red">
            Couldn't load tasks.{' '}
            {onRetry && (
              <button type="button" onClick={onRetry} className="font-medium underline">
                Retry
              </button>
            )}
          </p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-4 text-sm text-legacy-blue-light">{emptyMessage}</p>
        ) : (
          <div className="divide-y divide-legacy-blue-light/15">
            {rows.map((row) =>
              row.kind === 'task' ? taskRow(row.task) : row.kind === 'group' ? groupRow(row) : flowRow(row),
            )}
          </div>
        )}

        {footer && !loading && (
          <div className="border-t border-legacy-blue-light/15 px-3 py-2.5">{footer}</div>
        )}
      </div>
    </div>
  )
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * A meeting row's stand-in for the status control: a compact NATIVE date input. A native date field
 * fires `change` for every keystroke (typing a year passes through "0002", "0020", ...), so a typed
 * date is committed once it settles (short pause, Enter, or leaving the field); a picker selection
 * commits after the same pause. Any real date is accepted, including past ones. Emptying it commits
 * `null` only where that means something (the Archive, where it reopens the task).
 */
function MeetingDateInput({
  task,
  clearable,
  onCommit,
}: {
  task: Task
  clearable: boolean
  onCommit: (date: string | null) => void
}) {
  const saved = task.meeting_date ?? ''
  const [draft, setDraft] = useState(saved)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => setDraft(saved), [saved])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  function commit(value: string) {
    window.clearTimeout(timer.current)
    if (value === saved) return
    if (value === '') {
      if (clearable && saved !== '') onCommit(null)
      return
    }
    if (!ISO.test(value) || Number(value.slice(0, 4)) < 1900 || Number.isNaN(Date.parse(value))) return
    onCommit(value)
  }

  return (
    <input
      type="date"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        window.clearTimeout(timer.current)
        const value = e.target.value
        timer.current = window.setTimeout(() => commit(value), 700)
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(draft)
      }}
      aria-label={`Meeting date for ${task.title}`}
      title={
        clearable
          ? 'Meeting date — clear it to reopen this task'
          : 'Enter the meeting date to complete this task'
      }
      className="w-full min-w-0 rounded border border-legacy-blue-light/30 px-1 py-0.5 text-xs text-legacy-blue-dark"
    />
  )
}

/** Inline notes editor under a row. Saves on blur and with the Save button; both are no-ops when nothing changed. */
function NotesEditor({
  task,
  onSave,
  onClose,
}: {
  task: Task
  onSave: (notes: string | null) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(task.notes ?? '')
  const [saved, setSaved] = useState(task.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (draft === saved || saving) return
    setSaving(true)
    await onSave(draft.trim() ? draft : null)
    setSaved(draft)
    setSaving(false)
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="border-t border-legacy-blue-light/10 bg-legacy-blue-light/5 px-3 py-3"
    >
      <label className="block text-xs font-medium text-legacy-blue-light">
        Notes — {task.title}
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          rows={3}
          className="mt-1 w-full resize-y rounded border border-legacy-blue-light/30 bg-white px-2 py-1.5 text-sm font-normal text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
        />
      </label>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={async () => {
            await save()
            onClose()
          }}
          disabled={saving}
          className="rounded-full bg-legacy-blue-dark px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-legacy-blue-light underline hover:text-legacy-blue-dark"
        >
          Close
        </button>
        {draft !== saved && !saving && (
          <span className="text-xs text-legacy-blue-light">Unsaved changes</span>
        )}
      </div>
    </div>
  )
}

function cadenceLabel(task: Task): string {
  if (!task.is_recurring || !task.cadence_value || !task.cadence_unit) return ''
  const { cadence_value: n, cadence_unit: unit } = task
  if (n === 1) return `↻ ${{ day: 'daily', week: 'weekly', month: 'monthly' }[unit]}`
  return `↻ every ${n} ${unit}s`
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
