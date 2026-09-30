import { useState } from 'react'
import type { ChecklistItemStatus } from '../lib/checklist'

const PHASE_LABEL: Record<'setup' | 'recurring' | 'closeout', string> = {
  setup: 'Setup',
  recurring: 'Recurring',
  closeout: 'Closeout',
}

function BadgePill({
  label,
  tone,
  expanded,
  onClick,
}: {
  label: string
  tone: 'complete' | 'attention' | 'neutral'
  expanded: boolean
  onClick: () => void
}) {
  const toneClass =
    tone === 'complete'
      ? 'border-legacy-blue-light/25 bg-legacy-blue-light/5 text-legacy-blue-dark'
      : tone === 'attention'
        ? 'border-legacy-red/50 bg-legacy-red/5 text-legacy-red'
        : 'border-legacy-blue-light/25 text-legacy-blue-light'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${toneClass} ${
        expanded ? 'ring-1 ring-legacy-blue-dark/30' : ''
      }`}
    >
      {label}
    </button>
  )
}

/** Setup/closeout: a flat checklist, checkbox + name + who/when once checked. */
export function SetupCloseoutBadge({
  phase,
  items,
  onToggle,
  onSetDate,
  nameFor,
}: {
  phase: 'setup' | 'closeout'
  items: ChecklistItemStatus[]
  onToggle: (checklistItemId: string, done: boolean) => void
  /** Only meaningful (and only rendered) for phase="setup" — see the calendar panel. */
  onSetDate?: (checklistItemId: string, date: string) => void
  nameFor: (profileId: string | null) => string
}) {
  const [expanded, setExpanded] = useState(false)
  const doneCount = items.filter((s) => s.done).length

  return (
    <div>
      <BadgePill
        label={`${PHASE_LABEL[phase]} ${doneCount}/${items.length}`}
        tone={doneCount === items.length && items.length > 0 ? 'complete' : 'neutral'}
        expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <ul className="mt-2 space-y-1 rounded-md border border-legacy-blue-light/15 bg-legacy-blue-light/5 p-2">
          {items.map((status) => (
            <ChecklistRow
              key={status.item.id}
              status={status}
              onToggle={onToggle}
              onSetDate={phase === 'setup' ? onSetDate : undefined}
              nameFor={nameFor}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ChecklistRow({
  status,
  onToggle,
  onSetDate,
  nameFor,
}: {
  status: ChecklistItemStatus
  onToggle: (checklistItemId: string, done: boolean) => void
  onSetDate?: (checklistItemId: string, date: string) => void
  nameFor: (profileId: string | null) => string
}) {
  return (
    <li className="flex items-start gap-2 px-1 py-1 text-sm">
      <input
        type="checkbox"
        checked={status.done}
        onChange={(e) => onToggle(status.item.id, e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-legacy-blue-dark"
      />
      <div className="min-w-0 flex-1">
        <div className="text-legacy-blue-dark">{status.item.name}</div>
        {status.done && status.completedAt && (
          <div className="text-xs text-legacy-blue-light">
            {formatDate(status.completedAt)} by {nameFor(status.completedBy)}
          </div>
        )}
      </div>
      {onSetDate && (
        <input
          type="date"
          title="Set a date — completes the item and shows it on the calendar"
          defaultValue={status.completedAt ? status.completedAt.slice(0, 10) : ''}
          onChange={(e) => e.target.value && onSetDate(status.item.id, e.target.value)}
          className="shrink-0 rounded border border-legacy-blue-light/30 px-1 py-0.5 text-xs text-legacy-blue-dark"
        />
      )}
    </li>
  )
}

/**
 * Recurring: shows only items currently due by default (rolling items
 * approaching/past cadence, or never logged; calendar_month items not yet
 * logged this month) — not all ten every time. "Show all" reveals the rest.
 * Count reflects everything due across both cadence types combined.
 */
export function RecurringBadge({
  items,
  onLog,
  onRemove,
  onAddCustom,
  onSetSchedule,
}: {
  items: ChecklistItemStatus[]
  onLog: (checklistItemId: string) => void
  onRemove: (checklistItemId: string) => void
  onAddCustom: (name: string, cadenceType: 'rolling' | 'calendar_month', cadenceDays: number | null) => void
  /** Schedule marker only — doesn't complete the item. See the calendar panel. */
  onSetSchedule: (checklistItemId: string, date: string | null) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)

  const dueItems = items.filter((s) => s.due)
  const visibleItems = showAll ? items : dueItems

  return (
    <div>
      <BadgePill
        label={`Recurring (${dueItems.length})`}
        tone={dueItems.length > 0 ? 'attention' : 'complete'}
        expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <div className="mt-2 rounded-md border border-legacy-blue-light/15 bg-legacy-blue-light/5 p-2">
          {visibleItems.length === 0 ? (
            <p className="px-1 py-1 text-sm text-legacy-blue-light">
              Nothing due right now.
            </p>
          ) : (
            <ul className="space-y-1">
              {visibleItems.map((status) => (
                <RecurringRow
                  key={status.item.id}
                  status={status}
                  onLog={onLog}
                  onRemove={onRemove}
                  onSetSchedule={onSetSchedule}
                />
              ))}
            </ul>
          )}
          <div className="mt-1 flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-xs font-medium text-legacy-blue-light underline"
            >
              {showAll ? 'Show only due' : 'Show all'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="text-xs font-medium text-legacy-blue-light underline"
            >
              {showAddForm ? 'Cancel' : '+ Add item'}
            </button>
          </div>
          {showAddForm && (
            <AddCustomItemForm
              onAdd={(name, cadenceType, cadenceDays) => {
                onAddCustom(name, cadenceType, cadenceDays)
                setShowAddForm(false)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function RecurringRow({
  status,
  onLog,
  onRemove,
  onSetSchedule,
}: {
  status: ChecklistItemStatus
  onLog: (checklistItemId: string) => void
  onRemove: (checklistItemId: string) => void
  onSetSchedule: (checklistItemId: string, date: string | null) => void
}) {
  const overdue = status.stale
  const isCalendarMonth = status.item.cadence_type === 'calendar_month'
  const statusText = isCalendarMonth
    ? status.completedAt && !overdue
      ? 'Logged this month'
      : 'Not logged this month'
    : status.completedAt
      ? `Last: ${formatDate(status.completedAt)}`
      : 'Never logged'

  return (
    <li className="flex items-center justify-between gap-2 px-1 py-1 text-sm">
      <div className="min-w-0">
        <div className="text-legacy-blue-dark">
          {status.item.name}
          {status.isCustom && (
            <span className="ml-1 text-xs font-normal text-legacy-blue-light">(custom)</span>
          )}
        </div>
        <div className={`text-xs ${overdue ? 'text-legacy-red' : 'text-legacy-blue-light'}`}>
          {statusText}
          {status.scheduledDate && ` · Scheduled ${formatDate(status.scheduledDate)}`}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <input
          type="date"
          title="Schedule marker only — doesn't complete this item, shown on the calendar"
          defaultValue={status.scheduledDate ?? ''}
          onChange={(e) => onSetSchedule(status.item.id, e.target.value || null)}
          className="w-[112px] rounded border border-legacy-blue-light/30 px-1 py-0.5 text-xs text-legacy-blue-dark"
        />
        <button
          type="button"
          onClick={() => onLog(status.item.id)}
          className="rounded-full border border-legacy-blue-light/30 px-2.5 py-1 text-xs font-medium text-legacy-blue-dark hover:border-legacy-blue-dark"
        >
          Log
        </button>
        <button
          type="button"
          onClick={() => onRemove(status.item.id)}
          title={status.isCustom ? 'Delete this custom item' : 'Hide from this project'}
          className="px-1 text-xs text-legacy-blue-light hover:text-legacy-red"
        >
          ×
        </button>
      </div>
    </li>
  )
}

function AddCustomItemForm({
  onAdd,
}: {
  onAdd: (name: string, cadenceType: 'rolling' | 'calendar_month', cadenceDays: number | null) => void
}) {
  const [name, setName] = useState('')
  const [cadenceType, setCadenceType] = useState<'rolling' | 'calendar_month'>('rolling')
  const [cadenceDays, setCadenceDays] = useState('7')

  function handleAdd() {
    if (!name.trim()) return
    const days = cadenceType === 'rolling' ? Number(cadenceDays) || 7 : null
    onAdd(name.trim(), cadenceType, days)
  }

  return (
    <div className="mt-2 space-y-1.5 border-t border-legacy-blue-light/15 pt-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Item name"
        className="w-full rounded border border-legacy-blue-light/30 px-2 py-1 text-xs text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
      />
      <div className="flex items-center gap-1.5">
        <select
          value={cadenceType}
          onChange={(e) => setCadenceType(e.target.value as 'rolling' | 'calendar_month')}
          className="rounded border border-legacy-blue-light/30 px-1.5 py-1 text-xs text-legacy-blue-dark"
        >
          <option value="rolling">Every N days</option>
          <option value="calendar_month">Once a calendar month</option>
        </select>
        {cadenceType === 'rolling' && (
          <input
            type="number"
            min={1}
            value={cadenceDays}
            onChange={(e) => setCadenceDays(e.target.value)}
            className="w-16 rounded border border-legacy-blue-light/30 px-1.5 py-1 text-xs text-legacy-blue-dark"
          />
        )}
        <button
          type="button"
          onClick={handleAdd}
          disabled={!name.trim()}
          className="ml-auto rounded-full bg-legacy-blue-dark px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60"
        >
          Add
        </button>
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
