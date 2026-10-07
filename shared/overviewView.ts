/**
 * A user's Overview "Choose a View" selection, stored on `profiles.overview_view`. No imports: used by
 * src/ and server/.
 *
 * The Overview shows the UNION of everything selected, de-duplicated:
 *  - `mine`        every project the user has Added (live — a newly Added project appears at once)
 *  - `pm_ids`      every project whose PM is one of these people (follows PM reassignment)
 *  - `project_ids` individually picked projects
 */
export interface OverviewView {
  mine: boolean
  pm_ids: string[]
  project_ids: string[]
}

/** What a user with no saved view gets (and what the database column defaults to): Added projects only. */
export const DEFAULT_OVERVIEW_VIEW: OverviewView = { mine: true, pm_ids: [], project_ids: [] }

const MAX_PICKS = 1000

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0))].slice(0, MAX_PICKS)
}

/** Coerces anything (a stored jsonb value, a request body) into a well-formed view; junk falls back to the default. */
export function normalizeOverviewView(raw: unknown): OverviewView {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_OVERVIEW_VIEW, pm_ids: [], project_ids: [] }
  const r = raw as Record<string, unknown>
  return {
    mine: typeof r.mine === 'boolean' ? r.mine : true,
    pm_ids: ids(r.pm_ids),
    project_ids: ids(r.project_ids),
  }
}
