export type CadenceUnit = 'day' | 'week' | 'month'

const DAY_MS = 24 * 60 * 60 * 1000

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

/** First-of-month date string (YYYY-MM-DD, UTC) for the month containing `date`. */
export function monthStartFor(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10)
}

/**
 * Default flow-report period: day-of-month <= 14 defaults to last month (still
 * time to finish it), >= 15 defaults to this month.
 */
export function defaultFlowReportMonth(now: Date = new Date()): string {
  if (now.getUTCDate() <= 14) {
    return monthStartFor(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))
  }
  return monthStartFor(now)
}

/** Last calendar day of the month containing `isoDate` (YYYY-MM-DD in, YYYY-MM-DD out). */
export function lastDayOfMonth(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/** First day of the month after the one containing `isoDate`. */
export function nextMonthStart(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
}

/**
 * `isoDate` + one recurrence step. Day/week are exact. Month keeps the day of
 * month (clamped to the target month's length) — except a date that IS the last
 * day of its month stays "last day of the month" (Jan 31 -> Feb 28 -> Mar 31),
 * so end-of-month schedules (the Budget items, the flow due date) don't drift.
 */
export function addCadence(isoDate: string, value: number, unit: CadenceUnit): string {
  const [y, m, d] = isoDate.split('-').map(Number)

  if (unit === 'month') {
    const wasLastDay = d === daysInMonth(y, m)
    const target = new Date(Date.UTC(y, m - 1 + value, 1))
    const ty = target.getUTCFullYear()
    const tm = target.getUTCMonth() + 1
    const dim = daysInMonth(ty, tm)
    const day = wasLastDay ? dim : Math.min(d, dim)
    return new Date(Date.UTC(ty, tm - 1, day)).toISOString().slice(0, 10)
  }

  const step = unit === 'week' ? value * 7 : value
  return new Date(Date.UTC(y, m - 1, d) + step * DAY_MS).toISOString().slice(0, 10)
}
