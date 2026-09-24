import { useState } from 'react'
import type { ChecklistItemStatus } from '../lib/checklist'

const PHASE_LABEL: Record<'setup' | 'weekly' | 'closeout', string> = {
  setup: 'Setup',
  weekly: 'Weekly',
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
  nameFor,
}: {
  phase: 'setup' | 'closeout'
  items: ChecklistItemStatus[]
  onToggle: (checklistItemId: string, done: boolean) => void
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
  nameFor,
}: {
  status: ChecklistItemStatus
  onToggle: (checklistItemId: string, done: boolean) => void
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
      <div className="min-w-0">
        <div className="text-legacy-blue-dark">{status.item.name}</div>
        {status.done && status.completedAt && (
          <div className="text-xs text-legacy-blue-light">
            {formatDate(status.completedAt)} by {nameFor(status.completedBy)}
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * Weekly: shows only items approaching (<= 1 day out) or past cadence by
 * default — not all six every time. "Show all" reveals the rest.
 */
export function WeeklyBadge({
  items,
  onLog,
}: {
  items: ChecklistItemStatus[]
  onLog: (checklistItemId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const dueItems = items.filter(
    (s) => s.completedAt === null || (s.daysUntilDue !== null && s.daysUntilDue <= 1),
  )
  const visibleItems = showAll ? items : dueItems

  return (
    <div>
      <BadgePill
        label={dueItems.length > 0 ? `Weekly — ${dueItems.length} due` : 'Weekly — current'}
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
                <WeeklyRow key={status.item.id} status={status} onLog={onLog} />
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-1 px-1 text-xs font-medium text-legacy-blue-light underline"
          >
            {showAll ? 'Show only due' : 'Show all'}
          </button>
        </div>
      )}
    </div>
  )
}

function WeeklyRow({
  status,
  onLog,
}: {
  status: ChecklistItemStatus
  onLog: (checklistItemId: string) => void
}) {
  const overdue = status.stale
  return (
    <li className="flex items-center justify-between gap-2 px-1 py-1 text-sm">
      <div className="min-w-0">
        <div className="text-legacy-blue-dark">{status.item.name}</div>
        <div className={`text-xs ${overdue ? 'text-legacy-red' : 'text-legacy-blue-light'}`}>
          {status.completedAt ? `Last: ${formatDate(status.completedAt)}` : 'Never logged'}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onLog(status.item.id)}
        className="shrink-0 rounded-full border border-legacy-blue-light/30 px-2.5 py-1 text-xs font-medium text-legacy-blue-dark hover:border-legacy-blue-dark"
      >
        Log
      </button>
    </li>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
