import { SupabaseClient } from '@supabase/supabase-js'
import { getValidAccessToken } from './procore.js'
import { listCompanies, listProjectsForCompany, RawProcoreProject } from './procoreApi.js'

export interface ProjectRecord {
  id: string
  procore_project_id: number
  procore_company_id: number
  job_number: string | null
  name: string
  procore_active: boolean
  is_active: boolean
  last_synced_at: string
  created_at: string
}

export interface ProjectWithStar extends ProjectRecord {
  isStarred: boolean
}

export interface SyncResult {
  ok: boolean
  error?: string
  syncedCount: number
}

/** Procore's exact field name for job number/active isn't fully pinned down
 * from docs alone — read several plausible candidates defensively instead of
 * assuming one, so a naming difference degrades to "blank" rather than crashing. */
function pickJobNumber(raw: RawProcoreProject): string | null {
  for (const key of ['project_number', 'job_number', 'number']) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function pickName(raw: RawProcoreProject): string {
  for (const key of ['display_name', 'name']) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return 'Untitled project'
}

function pickActive(raw: RawProcoreProject): boolean {
  if (typeof raw.active === 'boolean') return raw.active
  if (typeof raw.is_active === 'boolean') return raw.is_active
  if (typeof raw.status === 'string') return raw.status.toLowerCase() !== 'inactive'
  return true
}

/**
 * Sync the caller's Procore projects into the shared `projects` cache: list
 * every company the user's token can see, list each company's projects,
 * upsert them (matched on `procore_project_id`), then soft-delete any
 * previously-cached project not seen in this run.
 *
 * Uses the CALLER's own Procore OAuth token (refreshed if needed) — there is
 * no service-account fallback, so a user who hasn't connected Procore (or
 * whose refresh token has died) gets a graceful failure, not a crash.
 */
export async function syncProjects(
  admin: SupabaseClient,
  profileId: string,
): Promise<SyncResult> {
  let accessToken: string | null
  try {
    accessToken = await getValidAccessToken(admin, profileId)
  } catch (err) {
    console.warn('[projects] could not get a Procore access token:', err)
    return { ok: false, error: 'Procore token refresh failed', syncedCount: 0 }
  }
  if (!accessToken) {
    return { ok: false, error: 'Procore is not connected for this user', syncedCount: 0 }
  }

  let companies: Awaited<ReturnType<typeof listCompanies>>
  try {
    companies = await listCompanies(accessToken)
  } catch (err) {
    console.warn('[projects] listCompanies failed:', err)
    return { ok: false, error: 'Could not reach Procore', syncedCount: 0 }
  }

  const seenProcoreIds = new Set<number>()
  const rows: Omit<ProjectRecord, 'id' | 'created_at'>[] = []
  let anyCompanySucceeded = false

  for (const company of companies) {
    let projects: RawProcoreProject[]
    try {
      projects = await listProjectsForCompany(accessToken, company.id)
      anyCompanySucceeded = true
    } catch (err) {
      // Best-effort across companies — one bad company shouldn't sink the sync.
      console.warn(`[projects] listProjectsForCompany(${company.id}) failed:`, err)
      continue
    }

    for (const raw of projects) {
      const procoreProjectId = Number(raw.id)
      if (!procoreProjectId) continue
      seenProcoreIds.add(procoreProjectId)
      rows.push({
        procore_project_id: procoreProjectId,
        procore_company_id: company.id,
        job_number: pickJobNumber(raw),
        name: pickName(raw),
        procore_active: pickActive(raw),
        is_active: true,
        last_synced_at: new Date().toISOString(),
      })
    }
  }

  if (!anyCompanySucceeded && companies.length > 0) {
    return { ok: false, error: 'Could not fetch projects from Procore', syncedCount: 0 }
  }

  if (rows.length > 0) {
    const { error } = await admin
      .from('projects')
      .upsert(rows, { onConflict: 'procore_project_id' })
    if (error) {
      console.warn('[projects] upsert failed:', error.message)
      return { ok: false, error: 'Could not save synced projects', syncedCount: 0 }
    }
  }

  // Soft-delete anything cached that this sync didn't see again.
  if (seenProcoreIds.size > 0) {
    const { error } = await admin
      .from('projects')
      .update({ is_active: false })
      .eq('is_active', true)
      .not('procore_project_id', 'in', `(${[...seenProcoreIds].join(',')})`)
    if (error) console.warn('[projects] soft-delete pass failed:', error.message)
  }

  return { ok: true, syncedCount: rows.length }
}

/** Active projects, each flagged with whether this profile has starred it. */
export async function getProjectsForProfile(
  admin: SupabaseClient,
  profileId: string,
): Promise<ProjectWithStar[]> {
  const [projectsResult, starredResult] = await Promise.all([
    admin.from('projects').select('*').eq('is_active', true).order('name'),
    admin.from('user_starred_projects').select('project_id').eq('profile_id', profileId),
  ])
  if (projectsResult.error) throw new Error(projectsResult.error.message)
  if (starredResult.error) throw new Error(starredResult.error.message)

  const starredIds = new Set(
    (starredResult.data ?? []).map((row) => row.project_id as string),
  )
  return (projectsResult.data ?? []).map((project) => ({
    ...(project as ProjectRecord),
    isStarred: starredIds.has((project as ProjectRecord).id),
  }))
}

export async function setProjectStarred(
  admin: SupabaseClient,
  profileId: string,
  projectId: string,
  starred: boolean,
): Promise<void> {
  if (starred) {
    const { error } = await admin
      .from('user_starred_projects')
      .upsert(
        { profile_id: profileId, project_id: projectId },
        { onConflict: 'profile_id,project_id' },
      )
    if (error) throw new Error(error.message)
  } else {
    const { error } = await admin
      .from('user_starred_projects')
      .delete()
      .eq('profile_id', profileId)
      .eq('project_id', projectId)
    if (error) throw new Error(error.message)
  }
}
