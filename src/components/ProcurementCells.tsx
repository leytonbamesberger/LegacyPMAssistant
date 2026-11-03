import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LinkedTask, ProcurementStatus } from '../lib/procurement'

/**
 * The editable cells of the Procurement table. Each one keeps its own draft and saves through
 * `onCommit` on blur (or Enter / a short pause for dates) — the page applies the change at once and
 * reverts it if the save fails. Inputs are plain tab stops, so Tab / Shift+Tab walk a row.
 */

const CELL =
  'min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-xs text-legacy-blue-dark hover:border-legacy-blue-light/25 focus:border-legacy-blue-dark focus:bg-white focus:outline-none'

const FULL = `w-full ${CELL}`

const ISO = /^\d{4}-\d{2}-\d{2}$/
const validIso = (value: string) => ISO.test(value) && Number(value.slice(0, 4)) >= 1900 && !Number.isNaN(Date.parse(value))

export function TextCell({
  value,
  onCommit,
  label,
  list,
  required = false,
}: {
  value: string | null
  /** Called with the new text (blank = null for optional cells). */
  onCommit: (next: string | null) => void
  label: string
  /** id of a <datalist> offering suggestions. */
  list?: string
  /** Blank is not allowed: an empty draft snaps back to the saved text. */
  required?: boolean
}) {
  const saved = value ?? ''
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])

  function commit() {
    if (draft === saved) return
    if (required && !draft.trim()) {
      setDraft(saved)
      return
    }
    onCommit(draft.trim() ? draft : null)
  }

  return (
    <input
      type="text"
      list={list}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(saved)
      }}
      aria-label={label}
      title={draft || undefined}
      className={FULL}
    />
  )
}

/**
 * A compact NATIVE date input. A native date field fires `change` for every keystroke (typing a year
 * passes through "0002", "0020", ...), so a typed date is saved once it settles (short pause, Enter, or
 * leaving the field). Clearing it saves on Enter / leaving only — never on the pause, which could catch a
 * half-edited field. Past dates are fine.
 */
export function DateCell({
  value,
  onCommit,
  label,
}: {
  value: string | null
  onCommit: (next: string | null) => void
  label: string
}) {
  const saved = value ?? ''
  const [draft, setDraft] = useState(saved)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => setDraft(saved), [saved])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  function commit(next: string) {
    window.clearTimeout(timer.current)
    if (next === saved) return
    if (next !== '' && !validIso(next)) return
    onCommit(next === '' ? null : next)
  }

  return (
    <input
      type="date"
      value={draft}
      min="1900-01-01"
      onChange={(e) => {
        const next = e.target.value
        setDraft(next)
        window.clearTimeout(timer.current)
        if (next !== '') timer.current = window.setTimeout(() => commit(next), 700)
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(draft)
      }}
      aria-label={label}
      className={FULL}
    />
  )
}

/** Lead time: a whole number (blank = none) plus the days / weeks unit. */
export function LeadTimeCell({
  value,
  unit,
  onValue,
  onUnit,
  label,
}: {
  value: number | null
  unit: 'days' | 'weeks'
  onValue: (next: number | null) => void
  onUnit: (next: 'days' | 'weeks') => void
  label: string
}) {
  const saved = value === null ? '' : String(value)
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])

  function commit() {
    if (draft === saved) return
    if (draft.trim() === '') return onValue(null)
    if (/^\d+$/.test(draft.trim()) && Number(draft) <= 10_000) return onValue(Number(draft))
    setDraft(saved)
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setDraft(saved)
        }}
        aria-label={`${label} lead time`}
        className={`${CELL} w-12 shrink-0`}
      />
      <select
        value={unit}
        onChange={(e) => onUnit(e.target.value as 'days' | 'weeks')}
        aria-label={`${label} lead time unit`}
        className={`${CELL} w-[4.25rem] shrink-0 px-0.5`}
      >
        <option value="days">days</option>
        <option value="weeks">weeks</option>
      </select>
    </div>
  )
}

/** Single-line display that opens into a textarea while focused. */
export function NotesCell({
  value,
  onCommit,
  label,
}: {
  value: string | null
  onCommit: (next: string | null) => void
  label: string
}) {
  const saved = value ?? ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(saved)
  useEffect(() => {
    if (!editing) setDraft(saved)
  }, [saved, editing])

  if (!editing) {
    return (
      <input
        type="text"
        readOnly
        value={saved}
        onFocus={() => setEditing(true)}
        aria-label={label}
        title={saved || undefined}
        className={`${FULL} cursor-text truncate`}
      />
    )
  }
  return (
    <textarea
      autoFocus
      rows={3}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.setSelectionRange(draft.length, draft.length)}
      onBlur={() => {
        setEditing(false)
        if (draft !== saved) onCommit(draft.trim() ? draft : null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setDraft(saved)
          e.currentTarget.blur()
        }
      }}
      aria-label={label}
      className={`${FULL} resize-y border-legacy-blue-dark bg-white`}
    />
  )
}

const STATUS_STYLE: Record<ProcurementStatus, string> = {
  'Not Submitted': 'bg-legacy-blue-light/10 text-legacy-blue-light',
  Submitted: 'bg-legacy-blue-light/20 text-legacy-blue-dark',
  Approved: 'bg-legacy-blue-light/35 text-legacy-blue-dark',
  Ordered: 'bg-legacy-blue-light/70 text-white',
  Delivered: 'bg-legacy-blue-dark text-white',
}

export function StatusPill({ status }: { status: ProcurementStatus }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status]}`}>
      {status}
    </span>
  )
}

const POPOVER_WIDTH = 288

/**
 * The open-task list behind an item's count chip. Positioned from the chip's rectangle and drawn in a
 * portal (fixed), so the table's own overflow never clips it or adds a scrollbar; it closes on an outside
 * click, Escape, or any scroll.
 */
export function TaskPopover({
  anchor,
  tasks,
  nameFor,
  currentProfileId,
  onAddTask,
  onClose,
}: {
  anchor: DOMRect
  tasks: LinkedTask[]
  nameFor: (profileId: string) => string
  currentProfileId: string | null
  onAddTask: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(anchor.bottom + 4)

  // Flip above the chip when there isn't room below.
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0
    if (anchor.bottom + 4 + height > window.innerHeight - 8) setTop(Math.max(8, anchor.top - 4 - height))
  }, [anchor])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // The popover's own task list scrolls; only a scroll elsewhere (the page, the table) dismisses it.
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - POPOVER_WIDTH - 8))
  const person = (id: string) => (id === currentProfileId ? 'Me' : nameFor(id))

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Open tasks for this item"
      style={{ top, left, width: POPOVER_WIDTH }}
      className="fixed z-50 rounded-lg border border-legacy-blue-light/25 bg-white p-3 shadow-lg"
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-legacy-blue-light">
        Open tasks ({tasks.length})
      </div>
      <ul className="mt-1.5 max-h-60 divide-y divide-legacy-blue-light/10 overflow-y-auto">
        {tasks.map((task) => (
          <li key={task.id} className="py-1.5 text-xs">
            <div className="font-medium text-legacy-blue-dark">{task.title}</div>
            <div className="text-legacy-blue-light">
              {task.due_date ? `Due ${task.due_date}` : 'No due date'}
              {task.assignee_ids.length > 0 && ` · ${task.assignee_ids.map(person).join(', ')}`}
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          onClose()
          onAddTask()
        }}
        className="mt-2 rounded-full bg-legacy-blue-dark px-3 py-1 text-xs font-medium text-white hover:opacity-90"
      >
        + Add task
      </button>
    </div>,
    document.body,
  )
}
