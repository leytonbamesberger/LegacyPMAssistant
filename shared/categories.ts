/**
 * The 6 compliance-check categories, their scoring weights, and display
 * labels — shared so the server (scoring) and client (results table) can't
 * drift apart. No imports, so both tsconfigs compile it without either one's
 * module-resolution rules applying (see shared/csi.ts for the same note).
 */

export type CategoryStatus = 'Pass' | 'Fail' | 'Caution' | 'N/A'

export interface CategoryResult {
  status: CategoryStatus
  notes: string
}

export const CATEGORY_KEYS = [
  'manufacturer_model',
  'sizing',
  'certifications',
  'performance_data',
  'accessories',
  'misc',
] as const

export type CategoryKey = (typeof CATEGORY_KEYS)[number]

export const CATEGORY_META: Record<CategoryKey, { label: string; weight: number }> = {
  manufacturer_model: { label: 'Manufacturer/Model', weight: 5 },
  sizing: { label: 'Sizing', weight: 5 },
  certifications: { label: 'Certifications', weight: 4 },
  performance_data: { label: 'Performance Data', weight: 4 },
  accessories: { label: 'Accessories', weight: 3 },
  misc: { label: 'Misc', weight: 1 },
}
