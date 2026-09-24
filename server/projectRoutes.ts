import { ApiResult } from './http.js'
import { resolveProfile } from './auth.js'
import {
  getProjectsForProfile,
  ProjectEditableFields,
  setProjectStarred,
  syncProjects,
  updateProject,
} from './projects.js'

async function loadProjectsResult(
  admin: Parameters<typeof getProjectsForProfile>[0],
  profileId: string,
): Promise<ApiResult> {
  try {
    const projects = await getProjectsForProfile(admin, profileId)
    return { status: 200, json: { projects } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not load projects',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/**
 * GET /api/projects  (MSAL-authenticated)
 * Returns the cached project list immediately — never triggers a Procore
 * call itself, so the UI can render cached data with zero latency. The
 * client separately (and non-blockingly) POSTs { action: 'sync' }.
 */
export async function handleProjectsList(
  authorizationHeader: string | undefined,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error
  return loadProjectsResult(resolved.admin, resolved.profileId)
}

/**
 * The 'sync' action of POST /api/projects (MSAL-authenticated).
 * Pulls the caller's Procore projects (via their own OAuth token) into the
 * shared cache, then returns the refreshed list either way — sync failure
 * (Procore not connected, token dead, Procore unreachable) is reported in
 * `syncOk`/`syncError` alongside the still-valid cached `projects`, never as
 * an HTTP error, so the UI can show a subtle warning instead of breaking.
 */
export async function handleProjectsSync(
  authorizationHeader: string | undefined,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const sync = await syncProjects(resolved.admin, resolved.profileId)
  if (!sync.ok) {
    console.warn('[projects] sync failed:', sync.error)
  }

  const listResult = await loadProjectsResult(resolved.admin, resolved.profileId)
  if (listResult.status !== 200) return listResult

  return {
    status: 200,
    json: {
      ...(listResult.json as object),
      syncOk: sync.ok,
      syncError: sync.ok ? null : (sync.error ?? 'Sync failed'),
      syncedAt: new Date().toISOString(),
    },
  }
}

/**
 * The 'star' action of POST /api/projects (MSAL-authenticated).
 * Body: { action: 'star', projectId: string, starred: boolean }
 */
export async function handleProjectsStar(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { projectId, starred } = (body ?? {}) as {
    projectId?: unknown
    starred?: unknown
  }
  if (typeof projectId !== 'string' || typeof starred !== 'boolean') {
    return {
      status: 400,
      json: { error: '"projectId" (string) and "starred" (boolean) are required' },
    }
  }

  try {
    await setProjectStarred(resolved.admin, resolved.profileId, projectId, starred)
    return { status: 200, json: { starred } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not update star',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

const PROJECT_STATUSES = ['active', 'closing', 'closed'] as const

/**
 * Edits gc/status/pm_id/apm_id/checklist_enabled on a project that already
 * exists from the Procore sync. There is no create/delete here — the project
 * list stays anchored to Procore; this only edits the dashboard-only fields
 * layered on top (see supabase/schema.sql).
 */
export async function handleProjectsUpdate(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const raw = (body ?? {}) as {
    projectId?: unknown
    gc?: unknown
    status?: unknown
    pm_id?: unknown
    apm_id?: unknown
    checklist_enabled?: unknown
  }

  if (typeof raw.projectId !== 'string') {
    return { status: 400, json: { error: '"projectId" (string) is required' } }
  }

  const fields: ProjectEditableFields = {}

  if ('gc' in raw) {
    if (raw.gc !== null && typeof raw.gc !== 'string') {
      return { status: 400, json: { error: '"gc" must be a string or null' } }
    }
    fields.gc = raw.gc
  }
  if ('status' in raw) {
    if (!PROJECT_STATUSES.includes(raw.status as (typeof PROJECT_STATUSES)[number])) {
      return {
        status: 400,
        json: { error: `"status" must be one of: ${PROJECT_STATUSES.join(', ')}` },
      }
    }
    fields.status = raw.status as ProjectEditableFields['status']
  }
  if ('pm_id' in raw) {
    if (raw.pm_id !== null && typeof raw.pm_id !== 'string') {
      return { status: 400, json: { error: '"pm_id" must be a string or null' } }
    }
    fields.pm_id = raw.pm_id
  }
  if ('apm_id' in raw) {
    if (raw.apm_id !== null && typeof raw.apm_id !== 'string') {
      return { status: 400, json: { error: '"apm_id" must be a string or null' } }
    }
    fields.apm_id = raw.apm_id
  }
  if ('checklist_enabled' in raw) {
    if (typeof raw.checklist_enabled !== 'boolean') {
      return { status: 400, json: { error: '"checklist_enabled" must be a boolean' } }
    }
    fields.checklist_enabled = raw.checklist_enabled
  }

  if (Object.keys(fields).length === 0) {
    return { status: 400, json: { error: 'No editable fields provided' } }
  }

  try {
    await updateProject(resolved.admin, raw.projectId, fields)
    return { status: 200, json: { ok: true } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not update project',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/**
 * POST /api/projects — action dispatch: { action: 'sync' | 'star' | 'update', ... }.
 * One file/handler per verb regardless of action count, to stay well under
 * Vercel's Hobby-plan 12-Serverless-Function cap (see vercelAdapter.ts).
 */
export async function handleProjectsPost(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const { action } = (body ?? {}) as { action?: unknown }
  switch (action) {
    case 'sync':
      return handleProjectsSync(authorizationHeader)
    case 'star':
      return handleProjectsStar(authorizationHeader, body)
    case 'update':
      return handleProjectsUpdate(authorizationHeader, body)
    default:
      return {
        status: 400,
        json: { error: '"action" must be "sync", "star", or "update"' },
      }
  }
}
