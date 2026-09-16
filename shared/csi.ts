/**
 * CSI MasterFormat section code normalization — shared by client and server so
 * a code is never compared as a raw string. "22.12.13", "22 1313", "22-12-13",
 * and "221213" all normalize to the same digits-only key.
 *
 * No imports here on purpose: this file is included in both `tsconfig.json`
 * (bundler resolution) and `tsconfig.node.json` (NodeNext, needs `.js`
 * extensions on relative imports) — staying import-free means both configs
 * can compile it without either one's rules applying.
 */

/** Canonical key: digits only. Returns '' for input with no digits at all. */
export function normalizeCsiCode(raw: string): string {
  return raw.replace(/[^0-9]/g, '')
}

export function csiCodesMatch(a: string, b: string): boolean {
  const na = normalizeCsiCode(a)
  const nb = normalizeCsiCode(b)
  return na.length > 0 && na === nb
}

/** MasterFormat division = the first two digits of a normalized code. */
export function csiDivision(normalized: string): string {
  return normalized.slice(0, 2)
}

const DIVISION_NAMES: Record<string, string> = {
  '21': 'Fire Suppression',
  '22': 'Plumbing',
  '23': 'HVAC',
  '25': 'Integrated Automation',
  '26': 'Electrical',
  '27': 'Communications',
  '28': 'Electronic Safety and Security',
}

export function csiDivisionName(normalized: string): string {
  const division = csiDivision(normalized)
  return DIVISION_NAMES[division] ?? `Division ${division || '?'}`
}

/**
 * Format a normalized (digits-only) code back into the conventional
 * "XX XX XX" display form. Anything shorter than 6 digits is grouped in
 * pairs as far as it goes, so partial/unusual codes still render sensibly.
 */
export function formatCsiCode(normalized: string): string {
  const groups = normalized.match(/.{1,2}/g) ?? []
  return groups.join(' ')
}
