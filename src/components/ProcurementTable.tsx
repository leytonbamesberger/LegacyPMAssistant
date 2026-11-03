import { Fragment, useRef, useState, type MutableRefObject } from 'react'
import {
  attentionReasons,
  estDelivery,
  itemStatus,
  PROCUREMENT_STATUSES,
  type LinkedTask,
  type ProcurementItem,
  type ProcurementItemFields,
} from '../lib/procurement'
import type { Project } from '../lib/projects'
import { DateCell, LeadTimeCell, NotesCell, StatusPill, TaskPopover, TextCell } from './ProcurementCells'

export type ColumnKey =
  | 'spec_number'
  | 'description'
  | 'tag'
  | 'status'
  | 'submitted_date'
  | 'approved_date'
  | 'ordered_date'
  | 'lead_time'
  | 'est_delivery'
  | 'required_on_site'
  | 'delivered_date'
  | 'vendor'
  | 'vendor_rep'
  | 'delivery_location'
  | 'po_number'
  | 'notes'
  | 'tasks'

/** Column order is fixed; widths (rem) are what make the pinned Spec # / Description offsets exact. */
const COLUMNS: { key: ColumnKey; label: string; width: number }[] = [
  { key: 'spec_number', label: 'Spec #', width: 5.5 },
  { key: 'description', label: 'Description', width: 18 },
  { key: 'tag', label: 'Tag', width: 6.5 },
  { key: 'status', label: 'Status', width: 8 },
  { key: 'submitted_date', label: 'Submitted', width: 8.75 },
  { key: 'approved_date', label: 'Approved', width: 8.75 },
  { key: 'ordered_date', label: 'Ordered', width: 8.75 },
  { key: 'lead_time', label: 'Lead Time', width: 8.5 },
  { key: 'est_delivery', label: 'Est. Delivery', width: 8.5 },
  { key: 'required_on_site', label: 'Required on Site', width: 8.75 },
  { key: 'delivered_date', label: 'Delivered', width: 8.75 },
  { key: 'vendor', label: 'Vendor', width: 10 },
  { key: 'vendor_rep', label: 'Vendor Rep', width: 9 },
  { key: 'delivery_location', label: 'Delivery Location', width: 10 },
  { key: 'po_number', label: 'PO #', width: 6.5 },
  { key: 'notes', label: 'Notes', width: 14 },
  { key: 'tasks', label: 'Tasks', width: 9.5 },
]
const ACTIONS_WIDTH = 5
const SPEC_WIDTH = COLUMNS[0].width
const TABLE_WIDTH = COLUMNS.reduce((n, c) => n + c.width, ACTIONS_WIDTH)
const SPAN = COLUMNS.length + 1

export interface SortState {
  key: ColumnKey
  dir: 'asc' | 'desc'
}

type SortValue = string | number | null

function sortValue(key: ColumnKey, item: ProcurementItem, openTasks: number): SortValue {
  switch (key) {
    case 'status':
      return PROCUREMENT_STATUSES.indexOf(itemStatus(item))
    case 'lead_time':
      return item.lead_time_value === null ? null : item.lead_time_value * (item.lead_time_unit === 'weeks' ? 7 : 1)
    case 'est_delivery':
      return estDelivery(item)
    case 'tasks':
      return openTasks
    default: {
      const value = item[key]
      return typeof value === 'string' ? value.trim().toLowerCase() || null : value
    }
  }
}

/** Sorts a copy of one project's items by a column; blanks go last in either direction. Equal values keep their order. */
export function sortItems(
  items: ProcurementItem[],
  sort: SortState | null,
  openTasks: (itemId: string) => number,
): ProcurementItem[] {
  if (!sort) return items
  const factor = sort.dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const x = sortValue(sort.key, a, openTasks(a.id))
    const y = sortValue(sort.key, b, openTasks(b.id))
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    const order =
      typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
    return order * factor
  })
}

export interface ProcurementGroup {
  project: Project
  /** Items to show: filtered and sorted. */
  items: ProcurementItem[]
  /** All of the project's items (what the header counts when no filter is on). */
  total: number
  /** Late / at-risk items across the whole project. */
  attention: number
}

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

const tdBase = 'border-b border-legacy-blue-light/15 px-1 py-0.5 align-top'

export function ProcurementTable({
  groups,
  collapsed,
  filtersActive,
  sort,
  onSort,
  today,
  taskLinks,
  vendors,
  locations,
  highlightId,
  rowErrors,
  currentProfileId,
  nameFor,
  quickAddRefs,
  onToggleGroup,
  onRequestAdd,
  onCreate,
  onPatch,
  onDelete,
  onAddTask,
}: {
  groups: ProcurementGroup[]
  collapsed: Set<string>
  filtersActive: boolean
  sort: SortState | null
  onSort: (key: ColumnKey) => void
  today: string
  taskLinks: Record<string, LinkedTask[]>
  vendors: string[]
  locations: string[]
  highlightId: string | null
  /** Per-item message after a save failed and was reverted. */
  rowErrors: Record<string, string>
  currentProfileId: string | null
  nameFor: (profileId: string) => string
  /** The quick-add inputs by project id, so "+ Add Item" can focus one. */
  quickAddRefs: MutableRefObject<Map<string, HTMLInputElement>>
  onToggleGroup: (projectId: string) => void
  /** "+ Add Item" in a group header: expand the group and focus its quick-add row. */
  onRequestAdd: (projectId: string) => void
  onCreate: (projectId: string, description: string) => Promise<boolean>
  onPatch: (item: ProcurementItem, fields: ProcurementItemFields) => void
  onDelete: (item: ProcurementItem) => void
  onAddTask: (item: ProcurementItem) => void
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [popover, setPopover] = useState<{ item: ProcurementItem; anchor: DOMRect } | null>(null)

  function row(item: ProcurementItem) {
    const status = itemStatus(item)
    const est = estDelivery(item)
    const reasons = attentionReasons(item, today)
    const attention = reasons.length > 0
    const open = taskLinks[item.id] ?? []
    const highlighted = highlightId === item.id
    const bg = highlighted ? 'bg-[#fff1b8]' : 'bg-white'
    const patch = (fields: ProcurementItemFields) => onPatch(item, fields)
    const name = item.description

    return (
      <tr key={item.id} id={`proc-item-${item.id}`} className="scroll-mt-24">
        <td
          className={`${tdBase} sticky left-0 z-10 transition-colors duration-700 ${bg}`}
        >
          <TextCell value={item.spec_number} onCommit={(v) => patch({ spec_number: v })} label={`Spec # for ${name}`} />
        </td>
        <td
          style={{ left: `${SPEC_WIDTH}rem` }}
          className={`${tdBase} sticky z-10 border-r border-r-legacy-blue-light/25 transition-colors duration-700 ${bg}`}
        >
          <div className="flex items-center gap-1">
            {attention && (
              <span
                role="img"
                aria-label={`Needs attention: ${reasons.join('; ')}`}
                title={reasons.join('\n')}
                className="h-2 w-2 shrink-0 rounded-full bg-legacy-red"
              />
            )}
            <TextCell
              value={item.description}
              required
              onCommit={(v) => v !== null && patch({ description: v })}
              label={`Description of ${name}`}
            />
            {rowErrors[item.id] && (
              <span
                role="alert"
                title={rowErrors[item.id]}
                className="shrink-0 rounded-full bg-legacy-red px-1.5 text-[10px] font-bold leading-4 text-white"
              >
                !
              </span>
            )}
          </div>
        </td>
        <td className={`${tdBase} transition-colors duration-700 ${highlighted ? bg : ''}`}>
          <TextCell value={item.tag} onCommit={(v) => patch({ tag: v })} label={`Tag for ${name}`} />
        </td>
        <td className={`${tdBase} transition-colors duration-700 ${highlighted ? bg : ''} pt-1.5`}>
          <StatusPill status={status} />
        </td>
        {(
          [
            ['submitted_date', 'Submitted'],
            ['approved_date', 'Approved'],
            ['ordered_date', 'Ordered'],
          ] as const
        ).map(([field, label]) => (
          <td key={field} className={`${tdBase} transition-colors duration-700 ${highlighted ? bg : ''}`}>
            <DateCell value={item[field]} onCommit={(v) => patch({ [field]: v })} label={`${label} date for ${name}`} />
          </td>
        ))}
        <td className={`${tdBase} transition-colors duration-700 ${highlighted ? bg : ''}`}>
          <LeadTimeCell
            value={item.lead_time_value}
            unit={item.lead_time_unit}
            onValue={(v) => patch({ lead_time_value: v })}
            onUnit={(v) => patch({ lead_time_unit: v })}
            label={name}
          />
        </td>
        <td
          className={`${tdBase} pt-1.5 transition-colors duration-700 ${
            attention ? 'bg-legacy-red/10' : highlighted ? bg : ''
          }`}
          title={attention ? reasons.join('\n') : undefined}
        >
          <span className={`px-1.5 ${attention ? 'font-semibold text-legacy-red' : 'text-legacy-blue-dark'}`}>
            {est ? fmt(est) : ''}
          </span>
        </td>
        <td className={`${tdBase} transition-colors duration-700 ${highlighted ? bg : ''}`}>
          <DateCell
            value={item.required_on_site}
            onCommit={(v) => patch({ required_on_site: v })}
            label={`Required on site date for ${name}`}
          />
        </td>
        <td className={`${tdBase} transition-colors duration-700 ${highlighted ? bg : ''}`}>
          <DateCell value={item.delivered_date} onCommit={(v) => patch({ delivered_date: v })} label={`Delivered date for ${name}`} />
        </td>
        <td className={`${tdBase} transition-colors duration-700 ${highlighted ? bg : ''}`}>
          <TextCell
            value={item.vendor}
            list="procurement-vendors"
            onCommit={(v) => patch({ vendor: v })}
            label={`Vendor for ${name}`}
          />
        </td>
        <td className={`${tdBase} transition-colors duration-700 ${highlighted ? bg : ''}`}>
          <TextCell value={item.vendor_rep} onCommit={(v) => patch({ vendor_rep: v })} label={`Vendor rep for ${name}`} />
        </td>
        <td className={`${tdBase} transition-colors duration-700 ${highlighted ? bg : ''}`}>
          <TextCell
            value={item.delivery_location}
            list="procurement-locations"
            onCommit={(v) => patch({ delivery_location: v })}
            label={`Delivery location for ${name}`}
          />
        </td>
        <td className={`${tdBase} transition-colors duration-700 ${highlighted ? bg : ''}`}>
          <TextCell value={item.po_number} onCommit={(v) => patch({ po_number: v })} label={`PO # for ${name}`} />
        </td>
        <td className={`${tdBase} transition-colors duration-700 ${highlighted ? bg : ''}`}>
          <NotesCell value={item.notes} onCommit={(v) => patch({ notes: v })} label={`Notes for ${name}`} />
        </td>
        <td className={`${tdBase} pt-1 transition-colors duration-700 ${highlighted ? bg : ''}`}>
          <div className="flex items-center gap-1.5 px-1">
            <button
              type="button"
              onClick={() => onAddTask(item)}
              title="Add a follow-up task for this item"
              className="whitespace-nowrap rounded-full border border-legacy-blue-light/30 px-2 py-0.5 text-[11px] font-medium text-legacy-blue-dark hover:border-legacy-blue-dark"
            >
              + Task
            </button>
            {open.length > 0 && (
              <button
                type="button"
                onClick={(e) => setPopover({ item, anchor: e.currentTarget.getBoundingClientRect() })}
                aria-haspopup="dialog"
                aria-label={`${open.length} open task${open.length === 1 ? '' : 's'} for ${name}`}
                className="whitespace-nowrap rounded-full bg-legacy-blue-light/15 px-2 py-0.5 text-[11px] font-medium text-legacy-blue-dark hover:bg-legacy-blue-light/25"
              >
                {open.length} open
              </button>
            )}
          </div>
        </td>
        <td className={`${tdBase} pt-1.5 text-center transition-colors duration-700 ${highlighted ? bg : ''}`}>
          {confirmingId === item.id ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px]">
              <button
                type="button"
                onClick={() => {
                  setConfirmingId(null)
                  onDelete(item)
                }}
                className="font-semibold text-legacy-red hover:underline"
              >
                Delete
              </button>
              <button type="button" onClick={() => setConfirmingId(null)} className="text-legacy-blue-light hover:underline">
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingId(item.id)}
              title="Delete this item (linked tasks are kept)"
              aria-label={`Delete ${name}`}
              className="leading-none text-legacy-blue-light hover:text-legacy-red"
            >
              ×
            </button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-legacy-blue-light/25">
      <datalist id="procurement-vendors">
        {vendors.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="procurement-locations">
        {locations.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>

      <table
        className="border-separate border-spacing-0 text-xs text-legacy-blue-dark"
        style={{ tableLayout: 'fixed', width: `${TABLE_WIDTH}rem` }}
      >
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.key} style={{ width: `${c.width}rem` }} />
          ))}
          <col style={{ width: `${ACTIONS_WIDTH}rem` }} />
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((col) => {
              const active = sort?.key === col.key
              const pinned = col.key === 'spec_number' || col.key === 'description'
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  style={col.key === 'description' ? { left: `${SPEC_WIDTH}rem` } : undefined}
                  className={`border-b border-legacy-blue-light/25 bg-[#edf0f4] px-1 py-2 text-left align-bottom text-[11px] font-semibold uppercase tracking-wide text-legacy-blue-light ${
                    pinned ? 'sticky z-20' : ''
                  } ${col.key === 'spec_number' ? 'left-0' : ''} ${col.key === 'description' ? 'border-r border-r-legacy-blue-light/25' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => onSort(col.key)}
                    className={`flex items-center gap-1 px-1.5 text-left uppercase tracking-wide hover:text-legacy-blue-dark ${
                      active ? 'text-legacy-blue-dark' : ''
                    }`}
                  >
                    {col.label}
                    <span aria-hidden className="text-[9px]">
                      {active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              )
            })}
            <th className="border-b border-legacy-blue-light/25 bg-[#edf0f4]" />
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const { project } = group
            const isCollapsed = collapsed.has(project.id)
            const countText = filtersActive
              ? `${group.items.length} of ${group.total}`
              : `${group.total} item${group.total === 1 ? '' : 's'}`
            return (
              <Fragment key={project.id}>
                <tr>
                  <td
                    colSpan={SPAN}
                    onClick={() => onToggleGroup(project.id)}
                    className="cursor-pointer border-b border-legacy-blue-light/20 bg-legacy-blue-light/10 px-3 py-1.5"
                  >
                    {/* Stays in view while the table scrolls sideways. */}
                    <div className="sticky left-3 flex w-max items-center gap-2.5">
                      <button
                        type="button"
                        aria-expanded={!isCollapsed}
                        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.name}`}
                        className="text-legacy-blue-light"
                      >
                        <span aria-hidden className={`inline-block text-xs transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>
                          ▸
                        </span>
                      </button>
                      <span className="text-xs font-semibold text-legacy-blue-dark">
                        {project.job_number && <span className="mr-1.5 font-normal text-legacy-blue-light">{project.job_number}</span>}
                        {project.name}
                      </span>
                      <span className="text-xs text-legacy-blue-light">{countText}</span>
                      {group.attention > 0 && (
                        <span className="rounded-full border border-legacy-red px-2 py-0.5 text-[11px] font-medium text-legacy-red">
                          {group.attention} late / at risk
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRequestAdd(project.id)
                        }}
                        className="rounded-full bg-legacy-blue-dark px-2.5 py-0.5 text-[11px] font-medium text-white hover:opacity-90"
                      >
                        + Add Item
                      </button>
                    </div>
                  </td>
                </tr>
                {!isCollapsed && (
                  <>
                    {group.items.length === 0 && (
                      <tr>
                        <td colSpan={SPAN} className="border-b border-legacy-blue-light/15 py-2">
                          <div className="sticky left-3 w-max px-3 text-legacy-blue-light">No items yet</div>
                        </td>
                      </tr>
                    )}
                    {group.items.map(row)}
                    <tr>
                      <td colSpan={SPAN} className="border-b border-legacy-blue-light/15 py-1.5">
                        <QuickAdd
                          projectId={project.id}
                          registerInput={(el) => {
                            if (el) quickAddRefs.current.set(project.id, el)
                            else quickAddRefs.current.delete(project.id)
                          }}
                          onCreate={onCreate}
                        />
                      </td>
                    </tr>
                  </>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      {popover && (
        <TaskPopover
          anchor={popover.anchor}
          tasks={taskLinks[popover.item.id] ?? []}
          nameFor={nameFor}
          currentProfileId={currentProfileId}
          onAddTask={() => onAddTask(popover.item)}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  )
}

/** The "type a description, press Enter" row at the bottom of a group. Stays focused for the next item. */
function QuickAdd({
  projectId,
  registerInput,
  onCreate,
}: {
  projectId: string
  registerInput: (el: HTMLInputElement | null) => void
  onCreate: (projectId: string, description: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  async function submit() {
    if (busy) return
    if (!draft.trim()) {
      setMessage('Description is required')
      return
    }
    setBusy(true)
    setMessage(null)
    const ok = await onCreate(projectId, draft.trim())
    setBusy(false)
    if (ok) setDraft('')
    else setMessage('Couldn’t add the item — try again')
    inputRef.current?.focus()
  }

  return (
    <div className="sticky left-3 flex w-max items-center gap-3 px-3">
      <input
        ref={(el) => {
          inputRef.current = el
          registerInput(el)
        }}
        type="text"
        value={draft}
        // Read-only (not disabled) while saving, so focus stays put for the next item.
        readOnly={busy}
        onChange={(e) => {
          setDraft(e.target.value)
          setMessage(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
        }}
        placeholder="+ Add an item — type a description, press Enter"
        aria-label="New item description"
        aria-invalid={message !== null}
        className={`w-96 rounded border px-2 py-1 text-xs text-legacy-blue-dark focus:outline-none ${
          message ? 'border-legacy-red' : 'border-legacy-blue-light/30 focus:border-legacy-blue-dark'
        }`}
      />
      {message && (
        <span role="alert" className="text-xs text-legacy-red">
          {message}
        </span>
      )}
    </div>
  )
}
