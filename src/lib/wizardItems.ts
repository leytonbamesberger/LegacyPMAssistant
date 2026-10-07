import type { CadenceUnit } from '../../shared/period'

/**
 * State shared by the initiation wizard and the Edit Project modal for the date-collecting steps
 * (see components/WizardSteps.tsx).
 */

/** One checklist row: a catalog item, or a custom one not saved yet (itemId null). */
export interface WizardItem {
  key: string
  itemId: string | null
  name: string
  /** Meeting items (checklist_items.is_meeting) may be left TBD. */
  isMeeting: boolean
  defaultCadence: { value: number; unit: CadenceUnit }
}

export interface SetupConfig {
  complete: boolean
  date: string
  tbd: boolean
}

export interface RecurringConfig {
  startDate: string
  value: string
  unit: CadenceUnit
}

export const EMPTY_SETUP: SetupConfig = { complete: false, date: '', tbd: false }

export function toWizardItem(item: {
  id: string
  name: string
  is_meeting?: boolean
  cadence_days: number | null
}): WizardItem {
  const days = item.cadence_days
  return {
    key: item.id,
    itemId: item.id,
    name: item.name,
    isMeeting: item.is_meeting === true,
    defaultCadence:
      days && days % 7 === 0
        ? { value: days / 7, unit: 'week' }
        : days
          ? { value: days, unit: 'day' }
          : { value: 1, unit: 'week' },
  }
}

export function emptyRecurring(item: WizardItem): RecurringConfig {
  return { startDate: '', value: String(item.defaultCadence.value), unit: item.defaultCadence.unit }
}

/**
 * The Setup date rules, in one place. A meeting is satisfied by ONE of: a date, TBD, or Done (a date or
 * Done completes it; TBD leaves it open). "Setup complete by" is needed while anything is still open — a
 * non-meeting item not Done, or a TBD meeting — and always when `requireDate` is set.
 */
export function setupDatesState(
  items: WizardItem[],
  getSetup: (key: string) => SetupConfig,
  completeBy: string,
  requireDate = false,
) {
  const bundle = items.filter((i) => !i.isMeeting)
  const meetings = items.filter((i) => i.isMeeting)
  const meetingComplete = (key: string) => {
    const cfg = getSetup(key)
    return cfg.complete || cfg.date !== ''
  }
  const completeByRequired =
    requireDate || bundle.some((i) => !getSetup(i.key).complete) || meetings.some((i) => !meetingComplete(i.key))
  const valid =
    (!completeByRequired || completeBy !== '') &&
    meetings.every((item) => meetingComplete(item.key) || getSetup(item.key).tbd)
  return { bundle, meetings, meetingComplete, completeByRequired, valid }
}

export function recurringScheduleValid(items: WizardItem[], getRecurring: (item: WizardItem) => RecurringConfig): boolean {
  return items.every((item) => {
    const cfg = getRecurring(item)
    return cfg.startDate !== '' && Number(cfg.value) > 0
  })
}
