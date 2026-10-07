import type { CadenceUnit } from '../../shared/period'
import {
  setupDatesState,
  type RecurringConfig,
  type SetupConfig,
  type WizardItem,
} from '../lib/wizardItems'

/**
 * The date-collecting steps of the initiation wizard, shared with the Edit Project modal so a Setup /
 * Recurring item added later is asked for exactly what initiation asks.
 */

export const inputClass =
  'rounded border border-legacy-blue-light/30 px-2 py-1 text-sm text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none'

/** Setup step columns: the name takes the slack; Done and date/TBD are fixed so controls align across rows. */
const SETUP_GRID = 'grid grid-cols-[minmax(0,1fr)_3rem_14rem] items-center gap-x-3'

/**
 * Setup due dates: one "Setup complete by" date for the non-meeting items (tracked as a bundle) with a
 * Done box each, then the meetings with Done + a meeting date + TBD. `requireDate` makes "Setup complete
 * by" mandatory even when everything is ticked Done (Edit Project: an added item always needs a date).
 */
export function SetupDatesStep({
  intro,
  items,
  getSetup,
  patchSetup,
  completeBy,
  onCompleteBy,
  requireDate = false,
}: {
  intro: string
  items: WizardItem[]
  getSetup: (key: string) => SetupConfig
  patchSetup: (key: string, patch: Partial<SetupConfig>) => void
  completeBy: string
  onCompleteBy: (date: string) => void
  requireDate?: boolean
}) {
  const { bundle, meetings, completeByRequired } = setupDatesState(items, getSetup, completeBy, requireDate)

  return (
    <div className="space-y-3">
      <p className="text-sm text-legacy-blue-light">{intro}</p>
      {items.length === 0 && <p className="py-3 text-sm text-legacy-blue-light">No Setup items selected.</p>}

      {(bundle.length > 0 || completeByRequired) && (
        <label className="block text-xs font-medium text-legacy-blue-dark">
          Setup complete by
          {completeByRequired ? (
            <span className="ml-1 text-legacy-red" title="Required">
              *
            </span>
          ) : (
            <span className="ml-1 font-normal text-legacy-blue-light">(optional — everything is complete)</span>
          )}
          <input
            type="date"
            value={completeBy}
            onChange={(e) => onCompleteBy(e.target.value)}
            aria-required={completeByRequired}
            className={`${inputClass} mt-1 block w-[9.5rem]`}
          />
        </label>
      )}

      {bundle.length > 0 && (
        <div>
          <div className={`${SETUP_GRID} text-xs font-medium text-legacy-blue-light`}>
            <span />
            <span className="text-center">Done</span>
            <span />
          </div>
          <ul className="divide-y divide-legacy-blue-light/15 border-t border-legacy-blue-light/15">
            {bundle.map((item) => (
              <li key={item.key} className={`${SETUP_GRID} py-2`}>
                <span className="min-w-0 break-words text-sm text-legacy-blue-dark">{item.name}</span>
                <span className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={getSetup(item.key).complete}
                    onChange={(e) => patchSetup(item.key, { complete: e.target.checked })}
                    aria-label={`${item.name} done`}
                    className="h-3.5 w-3.5 accent-legacy-blue-dark"
                  />
                </span>
                <span />
              </li>
            ))}
          </ul>
        </div>
      )}

      {meetings.length > 0 && (
        <div>
          <div className={`${SETUP_GRID} text-xs font-medium text-legacy-blue-light`}>
            <span className="text-legacy-blue-dark">Meetings</span>
            <span className="text-center">Done</span>
            <span>Meeting date</span>
          </div>
          <ul className="divide-y divide-legacy-blue-light/15 border-t border-legacy-blue-light/15">
            {meetings.map((item) => {
              const cfg = getSetup(item.key)
              return (
                <li key={item.key} className={`${SETUP_GRID} py-2`}>
                  <span className="min-w-0 break-words text-sm text-legacy-blue-dark">{item.name}</span>
                  <span className="flex justify-center">
                    <input
                      type="checkbox"
                      checked={cfg.complete}
                      onChange={(e) => patchSetup(item.key, { complete: e.target.checked })}
                      aria-label={`${item.name} done`}
                      className="h-3.5 w-3.5 accent-legacy-blue-dark"
                    />
                  </span>
                  <span className="flex items-center gap-3">
                    <input
                      type="date"
                      value={cfg.date}
                      disabled={cfg.tbd}
                      onChange={(e) => patchSetup(item.key, { date: e.target.value })}
                      aria-label={`${item.name} date`}
                      className={`${inputClass} w-[9.5rem] shrink-0 disabled:bg-legacy-blue-light/10`}
                    />
                    <label className="flex items-center gap-1.5 text-xs text-legacy-blue-dark">
                      <input
                        type="checkbox"
                        checked={cfg.tbd}
                        onChange={(e) =>
                          patchSetup(item.key, { tbd: e.target.checked, date: e.target.checked ? '' : cfg.date })
                        }
                        className="h-3.5 w-3.5 accent-legacy-blue-dark"
                      />
                      TBD
                    </label>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Recurring schedule: when each item first comes due (a date) and how often it repeats. */
export function RecurringScheduleStep({
  intro,
  items,
  getRecurring,
  patchRecurring,
}: {
  intro: string
  items: WizardItem[]
  getRecurring: (item: WizardItem) => RecurringConfig
  patchRecurring: (item: WizardItem, patch: Partial<RecurringConfig>) => void
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm text-legacy-blue-light">{intro}</p>
      {items.length === 0 && <p className="py-3 text-sm text-legacy-blue-light">No Recurring items selected.</p>}
      <ul className="divide-y divide-legacy-blue-light/15">
        {items.map((item) => {
          const cfg = getRecurring(item)
          return (
            <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-[12rem] flex-1 text-sm text-legacy-blue-dark">{item.name}</span>
              <input
                type="date"
                value={cfg.startDate}
                onChange={(e) => patchRecurring(item, { startDate: e.target.value })}
                aria-label={`${item.name} start date`}
                className={`${inputClass} w-[9.5rem]`}
              />
              <span className="flex items-center gap-1 text-xs text-legacy-blue-dark">
                every
                <input
                  type="number"
                  min={1}
                  value={cfg.value}
                  onChange={(e) => patchRecurring(item, { value: e.target.value })}
                  aria-label={`${item.name} cadence`}
                  className={`${inputClass} w-14`}
                />
                <select
                  value={cfg.unit}
                  onChange={(e) => patchRecurring(item, { unit: e.target.value as CadenceUnit })}
                  aria-label={`${item.name} cadence unit`}
                  className={inputClass}
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
    </div>
  )
}
