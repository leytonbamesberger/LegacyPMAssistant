import type { ReactNode } from 'react'
import type { CadenceUnit } from '../../shared/period'
import type { EditDatesPayload, ProjectEditCatalog } from '../lib/projects'
import { inputClass } from './WizardSteps'

/**
 * The Dates tab of the Edit Project modal. Holds the editable form values (`DatesState`) and the pure
 * helpers the modal needs: starting values, validation, and the payload of only what changed.
 *
 * Open items are editable; completed ones are read-only — except meetings, whose date can always be
 * changed (a date completes the meeting, clearing it reopens the meeting).
 */

export interface DatesState {
  setupDue: string
  /** Meeting date per meeting task id ('' = none / TBD). */
  meetings: Record<string, string>
  recurring: Record<string, { dueDate: string; value: string; unit: CadenceUnit }>
  closeout: Record<string, string>
}

export function initialDatesState(catalog: ProjectEditCatalog): DatesState {
  const { dates } = catalog
  return {
    setupDue: catalog.setupDueDate ?? '',
    meetings: Object.fromEntries(dates.meetings.map((m) => [m.taskId, m.meetingDate ?? ''])),
    recurring: Object.fromEntries(
      dates.recurring.map((r) => [
        r.taskId,
        { dueDate: r.dueDate ?? '', value: String(r.cadenceValue), unit: r.cadenceUnit },
      ]),
    ),
    closeout: Object.fromEntries(dates.closeout.map((c) => [c.taskId, c.dueDate ?? ''])),
  }
}

const wholeNumber = (value: string) => /^\d+$/.test(value) && Number(value) > 0

/** Blank due dates and non-positive cadences can't be saved. `removed` = items this edit takes off the project. */
export function datesValid(catalog: ProjectEditCatalog, state: DatesState, removed: Set<string>): boolean {
  if (catalog.setupDueDate !== null && state.setupDue === '') return false
  const recurringOk = catalog.dates.recurring.every((r) => {
    if (removed.has(r.itemId)) return true
    const cfg = state.recurring[r.taskId]
    return !!cfg && cfg.dueDate !== '' && wholeNumber(cfg.value)
  })
  const closeoutOk = catalog.dates.closeout.every((c) => c.complete || (state.closeout[c.taskId] ?? '') !== '')
  return recurringOk && closeoutOk
}

/** Only what differs from the catalog; empty lists / undefined when nothing changed. */
export function datesPayload(catalog: ProjectEditCatalog, state: DatesState, removed: Set<string>): EditDatesPayload {
  const { dates } = catalog
  return {
    setupDueDate:
      catalog.setupDueDate !== null && state.setupDue !== catalog.setupDueDate ? state.setupDue : undefined,
    meetings: dates.meetings.flatMap((m) => {
      const next = state.meetings[m.taskId] || null
      return next !== m.meetingDate ? [{ taskId: m.taskId, meetingDate: next }] : []
    }),
    recurring: dates.recurring.flatMap((r) => {
      const cfg = state.recurring[r.taskId]
      if (!cfg || removed.has(r.itemId)) return []
      const edit: EditDatesPayload['recurring'][number] = { taskId: r.taskId }
      if (cfg.dueDate !== (r.dueDate ?? '')) edit.dueDate = cfg.dueDate
      if (Number(cfg.value) !== r.cadenceValue || cfg.unit !== r.cadenceUnit) {
        edit.cadenceValue = Number(cfg.value)
        edit.cadenceUnit = cfg.unit
      }
      return edit.dueDate !== undefined || edit.cadenceValue !== undefined ? [edit] : []
    }),
    closeout: dates.closeout.flatMap((c) =>
      !c.complete && state.closeout[c.taskId] !== (c.dueDate ?? '')
        ? [{ taskId: c.taskId, dueDate: state.closeout[c.taskId] }]
        : [],
    ),
  }
}

export function hasDateChanges(p: EditDatesPayload): boolean {
  return p.setupDueDate !== undefined || p.meetings.length + p.recurring.length + p.closeout.length > 0
}

const invalidClass = 'border-legacy-red focus:border-legacy-red'

export function EditDatesTab({
  catalog,
  state,
  onChange,
  removed,
}: {
  catalog: ProjectEditCatalog
  state: DatesState
  onChange: (next: DatesState) => void
  /** Item ids this edit takes off the project (their rows are shown but locked). */
  removed: Set<string>
}) {
  const { dates } = catalog
  const showSetup = catalog.setupDueDate !== null
  const nothing = !showSetup && dates.meetings.length + dates.recurring.length + dates.closeout.length === 0

  return (
    <div className="space-y-5">
      {nothing && <p className="text-sm text-legacy-blue-light">This project has no dates to edit yet.</p>}

      {showSetup && (
        <section>
          <SectionTitle>Setup</SectionTitle>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <label htmlFor="edit-setup-due" className="text-sm text-legacy-blue-dark">
              Setup complete by
            </label>
            <input
              id="edit-setup-due"
              type="date"
              value={state.setupDue}
              onChange={(e) => onChange({ ...state, setupDue: e.target.value })}
              className={`${inputClass} w-[9.5rem] ${state.setupDue === '' ? invalidClass : ''}`}
            />
          </div>
          <p className="mt-1 text-xs text-legacy-blue-light">
            Applies to every open Setup item, including open meetings. Completed items keep their dates.
          </p>
        </section>
      )}

      {dates.meetings.length > 0 && (
        <section>
          <SectionTitle>Meetings</SectionTitle>
          <ul className="mt-1 divide-y divide-legacy-blue-light/15">
            {dates.meetings.map((m) => {
              const value = state.meetings[m.taskId] ?? ''
              return (
                <li key={m.taskId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="min-w-[12rem] flex-1 text-sm text-legacy-blue-dark">{m.name}</span>
                  <input
                    type="date"
                    value={value}
                    onChange={(e) => onChange({ ...state, meetings: { ...state.meetings, [m.taskId]: e.target.value } })}
                    aria-label={`${m.name} date`}
                    className={`${inputClass} w-[9.5rem]`}
                  />
                  <span className="w-16 text-xs text-legacy-blue-light">
                    {value === '' ? (m.complete ? 'Done' : 'TBD') : ''}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-legacy-blue-light">
            Entering a date completes the meeting and puts it on the calendar; clearing it reopens the meeting.
          </p>
        </section>
      )}

      {dates.recurring.length > 0 && (
        <section>
          <SectionTitle>Recurring items</SectionTitle>
          <ul className="mt-1 divide-y divide-legacy-blue-light/15">
            {dates.recurring.map((r) => {
              const cfg = state.recurring[r.taskId]
              if (!cfg) return null
              const gone = removed.has(r.itemId)
              const patch = (p: Partial<typeof cfg>) =>
                onChange({ ...state, recurring: { ...state.recurring, [r.taskId]: { ...cfg, ...p } } })
              return (
                <li key={r.taskId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="min-w-[12rem] flex-1 text-sm text-legacy-blue-dark">
                    {r.name}
                    {gone && <span className="ml-1.5 text-xs text-legacy-red">(will be removed)</span>}
                  </span>
                  <input
                    type="date"
                    value={cfg.dueDate}
                    disabled={gone}
                    onChange={(e) => patch({ dueDate: e.target.value })}
                    aria-label={`${r.name} next due date`}
                    className={`${inputClass} w-[9.5rem] disabled:opacity-40 ${!gone && cfg.dueDate === '' ? invalidClass : ''}`}
                  />
                  <span className="flex items-center gap-1 text-xs text-legacy-blue-dark">
                    every
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={cfg.value}
                      disabled={gone}
                      onChange={(e) => patch({ value: e.target.value })}
                      aria-label={`${r.name} cadence`}
                      className={`${inputClass} w-14 disabled:opacity-40 ${!gone && !wholeNumber(cfg.value) ? invalidClass : ''}`}
                    />
                    <select
                      value={cfg.unit}
                      disabled={gone}
                      onChange={(e) => patch({ unit: e.target.value as CadenceUnit })}
                      aria-label={`${r.name} cadence unit`}
                      className={`${inputClass} disabled:opacity-40`}
                    >
                      <option value="day">days</option>
                      <option value="week">weeks</option>
                      <option value="month">months</option>
                    </select>
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-legacy-blue-light">
            The date is the next time each item is due; later ones follow it by the cadence, so changing it
            shifts the whole schedule. A new cadence applies from the next instance on.
          </p>
        </section>
      )}

      {dates.closeout.length > 0 && (
        <section>
          <SectionTitle>Closeout</SectionTitle>
          <ul className="mt-1 divide-y divide-legacy-blue-light/15">
            {dates.closeout.map((c) => {
              const value = state.closeout[c.taskId] ?? ''
              return (
                <li key={c.taskId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="min-w-[12rem] flex-1 text-sm text-legacy-blue-dark">
                    {c.name}
                    {c.complete && <span className="ml-1.5 text-xs text-legacy-blue-light">(complete)</span>}
                  </span>
                  {c.complete ? (
                    <span className="w-[9.5rem] px-2 text-sm text-legacy-blue-light">{c.dueDate ?? '—'}</span>
                  ) : (
                    <input
                      type="date"
                      value={value}
                      onChange={(e) => onChange({ ...state, closeout: { ...state.closeout, [c.taskId]: e.target.value } })}
                      aria-label={`${c.name} due date`}
                      className={`${inputClass} w-[9.5rem] ${value === '' ? invalidClass : ''}`}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-legacy-blue-light">{children}</h3>
}
