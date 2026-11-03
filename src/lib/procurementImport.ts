import readXlsxFile from 'read-excel-file/browser'
import type { LeadTimeUnit } from './procurement'

/**
 * Reading a project's procurement spreadsheet (the per-project Excel log this tab replaces) into rows ready
 * to import. Everything here is pure except `readProcurementWorkbook`, which only opens the file.
 *
 * The header row is FOUND, not assumed: the sheets keep project information above the table (the headers are
 * on row 5 and the items start on row 6), so the first row in the top of the sheet that has a Description
 * header is the header row. Columns are matched by their header names, so a sheet laid out as
 * Spec # | Description | Tag | Submitted | Approved | Ordered | Lead Time | Est. Shipping | Est. Delivery |
 * Price Esc. Date | Price Esc. % | Vendor | Vendor Rep | Delivery Location | Notes imports as expected.
 * Est. Shipping, Est. Delivery and the price escalation columns are never imported (Est. Delivery is worked
 * out from Ordered + Lead Time here, and nobody uses the others).
 */

export interface ImportItem {
  description: string
  spec_number?: string
  tag?: string
  submitted_date?: string
  approved_date?: string
  ordered_date?: string
  delivered_date?: string
  required_on_site?: string
  lead_time_value?: number
  lead_time_unit?: LeadTimeUnit
  vendor?: string
  vendor_rep?: string
  delivery_location?: string
  po_number?: string
  notes?: string
}

export interface ImportRow {
  /** The row's number in the spreadsheet, for messages. */
  sourceRow: number
  item: ImportItem
  /** Cells that couldn't be read (left blank) — shown in the preview. */
  warnings: string[]
}

export interface ParsedWorkbook {
  sheetName: string
  /** The spreadsheet row the headers were found on. */
  headerRow: number
  rows: ImportRow[]
  /** Rows that had content but no Description. */
  skipped: { sourceRow: number; reason: string }[]
}

export class ImportFormatError extends Error {}

type Cell = string | number | boolean | Date | null | undefined
type Field = Exclude<keyof ImportItem, 'lead_time_unit'> | 'lead_time'

/** How far down the sheet the header row is looked for. */
const HEADER_SEARCH_ROWS = 25

const norm = (value: Cell) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Which field a header names (null = not imported). Order matters: the specific names come first. */
function fieldForHeader(header: Cell): Field | 'ignore' | null {
  const h = norm(header)
  if (!h) return null
  if (h.startsWith('est') || h.startsWith('price')) return 'ignore' // Est. Shipping / Est. Delivery / Price Esc.
  if (h.includes('descr')) return 'description'
  if (h.startsWith('spec')) return 'spec_number'
  if (h === 'tag' || h.startsWith('tag')) return 'tag'
  if (h.includes('submit')) return 'submitted_date'
  if (h.includes('approv')) return 'approved_date'
  if (h.includes('required')) return 'required_on_site'
  if (h.includes('lead')) return 'lead_time'
  if (h.includes('vendor') && h.includes('rep')) return 'vendor_rep'
  if (h.includes('vendor')) return 'vendor'
  if (h.includes('location')) return 'delivery_location'
  if (h.startsWith('delivered')) return 'delivered_date'
  if (h.startsWith('order')) return 'ordered_date'
  if (h === 'po' || h.startsWith('po') ) return 'po_number'
  if (h.includes('note')) return 'notes'
  return null
}

const PLACEHOLDER = /^(tbd|tba|n\/?a|none|pending|-+|—|–)$/i

function blank(cell: Cell): boolean {
  return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '')
}

function text(cell: Cell): string | undefined {
  if (blank(cell)) return undefined
  if (cell instanceof Date) return isoFromDate(cell)
  const value = String(cell).trim()
  return value || undefined
}

const pad = (n: number) => String(n).padStart(2, '0')

function realIso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** The reader returns date cells as UTC-midnight Dates, so the calendar day is read in UTC. */
function isoFromDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Excel's day counter (1900 system) -> ISO date. */
function isoFromSerial(serial: number): string | null {
  if (serial < 20000 || serial > 90000) return null // roughly 1954 – 2146: anything else isn't a date
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000)
  return isoFromDate(date)
}

/** A date cell: a real date, an Excel day number, or text such as 10/21/2026, 10-21-26, 2026-10-21, "Oct 21, 2026". */
function parseDate(cell: Cell): { value: string | null; bad: boolean } {
  if (blank(cell)) return { value: null, bad: false }
  if (cell instanceof Date) return { value: isoFromDate(cell), bad: false }
  if (typeof cell === 'number') {
    const iso = isoFromSerial(cell)
    return { value: iso, bad: iso === null }
  }
  const raw = String(cell).trim()
  if (PLACEHOLDER.test(raw)) return { value: null, bad: false }

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(raw)
  if (m) {
    const iso = realIso(Number(m[1]), Number(m[2]), Number(m[3]))
    return { value: iso, bad: iso === null }
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(raw)
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const iso = realIso(year, Number(m[1]), Number(m[2])) // month first, as the sheets are written
    return { value: iso, bad: iso === null }
  }
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2}|\d{4})$/i.exec(raw)
  if (m) {
    const month = MONTHS.indexOf(m[1].toLowerCase()) + 1
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const iso = month ? realIso(year, month, Number(m[2])) : null
    return { value: iso, bad: iso === null }
  }
  m = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{2}|\d{4})$/i.exec(raw)
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const iso = month ? realIso(year, month, Number(m[1])) : null
    return { value: iso, bad: iso === null }
  }
  return { value: null, bad: true }
}

/**
 * Lead time: a bare number means weeks (the log's default unit); text can say days or weeks ("12 wks",
 * "30 days", "6-8 weeks" — the longer end is kept). A fractional number of weeks becomes whole days.
 */
function parseLeadTime(cell: Cell): { value: number; unit: LeadTimeUnit } | null | 'bad' {
  if (blank(cell)) return null
  const raw = typeof cell === 'number' ? cell : String(cell).trim()
  if (typeof raw === 'string' && PLACEHOLDER.test(raw)) return null

  let amount: number
  let unit: LeadTimeUnit = 'weeks'
  if (typeof raw === 'number') {
    amount = raw
  } else {
    const nums = raw.match(/\d+(?:\.\d+)?/g)
    if (!nums) return 'bad'
    amount = Math.max(...nums.map(Number))
    // The letters after the number decide the unit: d / day / days -> days; w / wk / wks / week(s) -> weeks.
    const letters = raw.toLowerCase().replace(/[^a-z]/g, '')
    if (letters.startsWith('d')) unit = 'days'
    else if (letters && !letters.startsWith('w')) return 'bad'
  }
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000) return 'bad'
  if (Number.isInteger(amount)) return { value: amount, unit }
  return unit === 'weeks'
    ? { value: Math.round(amount * 7), unit: 'days' }
    : { value: Math.round(amount), unit: 'days' }
}

/** Turns one sheet's rows (as the reader returns them) into import rows. Pure. */
export function parseProcurementSheet(sheetName: string, data: Cell[][]): ParsedWorkbook {
  let headerIndex = -1
  for (let i = 0; i < Math.min(data.length, HEADER_SEARCH_ROWS); i++) {
    if (data[i].some((cell) => fieldForHeader(cell) === 'description')) {
      headerIndex = i
      break
    }
  }
  if (headerIndex === -1) {
    throw new ImportFormatError(
      `Couldn’t find the table headers on sheet “${sheetName}” — expected a row with a Description column in the first ${HEADER_SEARCH_ROWS} rows.`,
    )
  }

  const columns = new Map<number, Field>()
  data[headerIndex].forEach((cell, col) => {
    const field = fieldForHeader(cell)
    if (field && field !== 'ignore' && ![...columns.values()].includes(field)) columns.set(col, field)
  })

  const rows: ImportRow[] = []
  const skipped: ParsedWorkbook['skipped'] = []
  for (let i = headerIndex + 1; i < data.length; i++) {
    const cells = data[i]
    const sourceRow = i + 1
    const mapped = [...columns.keys()].map((col) => cells[col])
    if (mapped.every(blank)) continue // a blank (or formulas-only) row

    const item: Partial<ImportItem> = {}
    const warnings: string[] = []
    for (const [col, field] of columns) {
      const cell = cells[col]
      if (blank(cell)) continue
      if (field === 'lead_time') {
        const lead = parseLeadTime(cell)
        if (lead === 'bad') warnings.push(`Lead Time “${String(cell)}” couldn’t be read`)
        else if (lead) {
          item.lead_time_value = lead.value
          item.lead_time_unit = lead.unit
        }
      } else if (field.endsWith('_date') || field === 'required_on_site') {
        const date = parseDate(cell)
        if (date.bad) warnings.push(`${headerLabel(field)} “${String(cell)}” isn’t a date I can read`)
        else if (date.value) (item as Record<string, string>)[field] = date.value
      } else {
        const value = text(cell)
        if (value) (item as Record<string, string>)[field] = value
      }
    }

    if (!item.description) {
      skipped.push({ sourceRow, reason: 'No Description' })
      continue
    }
    rows.push({ sourceRow, item: item as ImportItem, warnings })
  }
  return { sheetName, headerRow: headerIndex + 1, rows, skipped }
}

function headerLabel(field: Field): string {
  return {
    submitted_date: 'Submitted',
    approved_date: 'Approved',
    ordered_date: 'Ordered',
    delivered_date: 'Delivered',
    required_on_site: 'Required on Site',
  }[field as string] ?? field
}

/**
 * Opens an .xlsx and reads the procurement sheet: the only sheet, else the one named like "Procurement",
 * else the first one that has a Description header.
 */
export async function readProcurementWorkbook(file: File): Promise<ParsedWorkbook> {
  let sheets: { sheet: string; data: Cell[][] }[]
  try {
    sheets = (await readXlsxFile(file)) as unknown as { sheet: string; data: Cell[][] }[]
  } catch {
    throw new ImportFormatError('That file couldn’t be opened. Choose an Excel workbook (.xlsx).')
  }
  if (sheets.length === 0) throw new ImportFormatError('That workbook has no sheets.')

  const preferred = [...sheets].sort(
    (a, b) => Number(/procure/i.test(b.sheet)) - Number(/procure/i.test(a.sheet)),
  )
  let firstError: ImportFormatError | null = null
  for (const sheet of preferred) {
    try {
      return parseProcurementSheet(sheet.sheet, sheet.data)
    } catch (err) {
      if (!(err instanceof ImportFormatError)) throw err
      firstError ??= err
    }
  }
  throw firstError as ImportFormatError
}

/** Rows already in the project's log (same Description, Spec # and Tag) — unchecked by default in the preview. */
export const duplicateKey = (item: { description: string; spec_number?: string | null; tag?: string | null }) =>
  [item.description, item.spec_number ?? '', item.tag ?? ''].map((v) => v.trim().toLowerCase()).join('|')
