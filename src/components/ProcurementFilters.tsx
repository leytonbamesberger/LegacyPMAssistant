import { addDaysISO } from '../lib/dates'
import {
  estDelivery,
  itemStatus,
  needsAttention,
  PROCUREMENT_STATUSES,
  type ProcurementItem,
  type ProcurementStatus,
} from '../lib/procurement'
import type { Project } from '../lib/projects'

export type DeliveryWindow = '' | 'overdue' | 'next7' | 'next14' | 'month'

export interface ProcurementFilterState {
  search: string
  /** Job number or name — narrows which of the view's projects show. */
  job: string
  statuses: ProcurementStatus[]
  attention: boolean
  vendor: string
  location: string
  window: DeliveryWindow
  openTasks: boolean
}

export const NO_PROCUREMENT_FILTERS: ProcurementFilterState = {
  search: '',
  job: '',
  statuses: [],
  attention: false,
  vendor: '',
  location: '',
  window: '',
  openTasks: false,
}

const WINDOW_LABEL: Record<Exclude<DeliveryWindow, ''>, string> = {
  overdue: 'Overdue',
  next7: 'Next 7 days',
  next14: 'Next 14 days',
  month: 'This month',
}

/** Any filter that narrows items (the Job box only narrows projects). */
export function itemFiltersActive(f: ProcurementFilterState): boolean {
  return (
    f.search.trim() !== '' ||
    f.statuses.length > 0 ||
    f.attention ||
    f.vendor !== '' ||
    f.location !== '' ||
    f.window !== '' ||
    f.openTasks
  )
}

export const anyFilterActive = (f: ProcurementFilterState) => itemFiltersActive(f) || f.job.trim() !== ''

export function projectMatchesJob(project: Project, job: string): boolean {
  const q = job.trim().toLowerCase()
  return !q || `${project.job_number ?? ''} ${project.name}`.toLowerCase().includes(q)
}

const same = (a: string | null, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Delivery windows look at the estimate of items still on their way: a delivered item has nothing
 * left to be overdue or upcoming, and an item with no estimate has no date to place.
 */
function inWindow(item: ProcurementItem, window: Exclude<DeliveryWindow, ''>, today: string): boolean {
  const est = estDelivery(item)
  if (item.delivered_date || !est) return false
  if (window === 'overdue') return est < today
  if (window === 'month') return est.slice(0, 7) === today.slice(0, 7)
  return est >= today && est <= addDaysISO(today, window === 'next7' ? 7 : 14)
}

export function itemMatchesFilters(
  item: ProcurementItem,
  f: ProcurementFilterState,
  ctx: { today: string; openTaskCount: number },
): boolean {
  const q = f.search.trim().toLowerCase()
  if (q) {
    const haystack = [item.description, item.tag, item.spec_number, item.vendor, item.vendor_rep, item.po_number]
    if (!haystack.some((v) => (v ?? '').toLowerCase().includes(q))) return false
  }
  if (f.statuses.length > 0 && !f.statuses.includes(itemStatus(item))) return false
  if (f.attention && !needsAttention(item, ctx.today)) return false
  if (f.vendor && !same(item.vendor, f.vendor)) return false
  if (f.location && !same(item.delivery_location, f.location)) return false
  if (f.window && !inWindow(item, f.window, ctx.today)) return false
  if (f.openTasks && ctx.openTaskCount === 0) return false
  return true
}

/** Distinct non-blank values (case-insensitive; the first spelling seen wins), alphabetical. */
export function distinctValues(items: ProcurementItem[], field: 'vendor' | 'delivery_location'): string[] {
  const seen = new Map<string, string>()
  for (const item of items) {
    const value = item[field]?.trim()
    if (value && !seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

const input =
  'rounded-md border border-legacy-blue-light/30 px-2 py-1 text-xs text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none'

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
        active
          ? 'border-legacy-blue-dark bg-legacy-blue-dark text-white'
          : 'border-legacy-blue-light/30 text-legacy-blue-dark hover:border-legacy-blue-dark'
      }`}
    >
      {children}
    </button>
  )
}

/** The one filter row above the log, plus Collapse all / Expand all. Filters live in page state only (reset on reload). */
export function ProcurementFilters({
  filters,
  onChange,
  vendors,
  locations,
  onCollapseAll,
  onExpandAll,
}: {
  filters: ProcurementFilterState
  onChange: (next: ProcurementFilterState) => void
  vendors: string[]
  locations: string[]
  onCollapseAll: () => void
  onExpandAll: () => void
}) {
  const set = <K extends keyof ProcurementFilterState>(key: K, value: ProcurementFilterState[K]) =>
    onChange({ ...filters, [key]: value })
  const toggleStatus = (status: ProcurementStatus) =>
    set('statuses', filters.statuses.includes(status) ? filters.statuses.filter((s) => s !== status) : [...filters.statuses, status])

  return (
    <div className="rounded-lg border border-legacy-blue-light/25 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filters.search}
          onChange={(e) => set('search', e.target.value)}
          placeholder="Search description, tag, spec #, vendor, PO #…"
          aria-label="Search the procurement log"
          className={`${input} w-72`}
        />
        <input
          type="search"
          value={filters.job}
          onChange={(e) => set('job', e.target.value)}
          placeholder="Job # or project name"
          aria-label="Filter by project"
          className={`${input} w-44`}
        />
        <select
          value={filters.vendor}
          onChange={(e) => set('vendor', e.target.value)}
          aria-label="Filter by vendor"
          className={`${input} max-w-[10rem]`}
        >
          <option value="">All vendors</option>
          {vendors.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={filters.location}
          onChange={(e) => set('location', e.target.value)}
          aria-label="Filter by delivery location"
          className={`${input} max-w-[10rem]`}
        >
          <option value="">All locations</option>
          {locations.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={filters.window}
          onChange={(e) => set('window', e.target.value as DeliveryWindow)}
          aria-label="Filter by estimated delivery"
          className={input}
        >
          <option value="">Est. delivery: any</option>
          {(Object.keys(WINDOW_LABEL) as Exclude<DeliveryWindow, ''>[]).map((w) => (
            <option key={w} value={w}>
              {WINDOW_LABEL[w]}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-legacy-blue-light">Status</span>
        {PROCUREMENT_STATUSES.map((status) => (
          <Toggle key={status} active={filters.statuses.includes(status)} onClick={() => toggleStatus(status)}>
            {status}
          </Toggle>
        ))}
        <span className="mx-1 h-4 w-px bg-legacy-blue-light/25" aria-hidden />
        <Toggle active={filters.attention} onClick={() => set('attention', !filters.attention)}>
          Needs attention
        </Toggle>
        <Toggle active={filters.openTasks} onClick={() => set('openTasks', !filters.openTasks)}>
          Has open tasks
        </Toggle>
        {anyFilterActive(filters) && (
          <button
            type="button"
            onClick={() => onChange(NO_PROCUREMENT_FILTERS)}
            className="text-xs font-medium text-legacy-blue-light underline underline-offset-2 hover:text-legacy-blue-dark"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto flex items-center gap-3 text-xs">
          <button type="button" onClick={onCollapseAll} className="font-medium text-legacy-blue-dark hover:underline">
            Collapse all
          </button>
          <button type="button" onClick={onExpandAll} className="font-medium text-legacy-blue-dark hover:underline">
            Expand all
          </button>
        </span>
      </div>
    </div>
  )
}
