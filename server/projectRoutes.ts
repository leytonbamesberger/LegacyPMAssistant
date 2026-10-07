import { ApiResult } from './http.js'
import { resolveProfile } from './auth.js'
import {
  getProjectsForProfile,
  ProjectEditableFields,
  setProjectStarred,
  syncProjects,
  updateProject,
} from './projects.js'
import { getInitiationCatalog } from './checklist.js'
import { getOverview, saveOverviewView } from './overview.js'
import {
  closeoutProject,
  editProject,
  getProjectEditCatalog,
  parseCloseoutPayload,
  parseEditPayload,
} from './projectEdit.js'
import { initiateProject, parseInitiationPayload } from './initiation.js'
import { TaskRuleError } from './tasks.js'

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
 *
 * GET /api/projects?initiationCatalogFor=<projectId> instead returns that
 * project's Setup/Recurring checklist catalog for the initiation wizard.
 *
 * GET /api/projects?overview=1 instead returns the caller's Overview grid
 * (see server/overview.ts).
 *
 * GET /api/projects?editCatalogFor=<projectId> instead returns what the Edit Project and Closeout
 * Project modals need (see server/projectEdit.ts).
 */
export async function handleProjectsList(
  authorizationHeader: string | undefined,
  query: { initiationCatalogFor?: string; overview?: string; editCatalogFor?: string } = {},
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  if (query.overview) {
    try {
      return { status: 200, json: await getOverview(resolved.admin, resolved.profileId) }
    } catch (err) {
      return {
        status: 500,
        json: {
          error: 'Could not load the overview',
          detail: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  if (query.editCatalogFor) {
    try {
      return { status: 200, json: await getProjectEditCatalog(resolved.admin, query.editCatalogFor) }
    } catch (err) {
      if (err instanceof TaskRuleError) return { status: err.status, json: { error: err.message } }
      return {
        status: 500,
        json: {
          error: 'Could not load the project',
          detail: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  if (query.initiationCatalogFor) {
    try {
      const catalog = await getInitiationCatalog(resolved.admin, query.initiationCatalogFor)
      return { status: 200, json: catalog }
    } catch (err) {
      return {
        status: 500,
        json: {
          error: 'Could not load the initiation checklist',
          detail: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  return loadProjectsResult(resolved.admin, resolved.profileId)
}

/** The 'initiate' action of POST /api/projects — body is the wizard's InitiationPayload (see server/initiation.ts). */
async function handleProjectsInitiate(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  try {
    await initiateProject(resolved.admin, resolved.profileId, parseInitiationPayload(body))
    return { status: 200, json: { ok: true } }
  } catch (err) {
    if (err instanceof TaskRuleError) {
      return { status: err.status, json: { error: err.message } }
    }
    console.error('[projects] initiate failed:', err)
    return {
      status: 500,
      json: {
        error: 'Could not initiate project',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/** The 'overview-view' action of POST /api/projects — body { view: { mine, pm_ids, project_ids } }. Edits only the Overview selection. */
async function handleProjectsOverviewView(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { view } = (body ?? {}) as { view?: unknown }
  if (view === null || typeof view !== 'object') {
    return { status: 400, json: { error: '"view" (object) is required' } }
  }

  try {
    return { status: 200, json: { view: await saveOverviewView(resolved.admin, resolved.profileId, view) } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not save the overview view',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/** Shared by the Edit Project and Closeout Project actions: rule rejections are 4xx, anything else a 500 with the database's reason. */
async function runProjectChange(
  authorizationHeader: string | undefined,
  label: string,
  run: (admin: Parameters<typeof editProject>[0], profileId: string) => Promise<unknown>,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error
  try {
    return { status: 200, json: { ok: true, ...((await run(resolved.admin, resolved.profileId)) as object) } }
  } catch (err) {
    if (err instanceof TaskRuleError) return { status: err.status, json: { error: err.message } }
    console.error(`[projects] ${label} failed:`, err)
    return {
      status: 500,
      json: { error: `Could not ${label}`, detail: err instanceof Error ? err.message : String(err) },
    }
  }
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
 * POST /api/projects — action dispatch: { action: 'sync' | 'star' | 'update' | 'initiate' | 'edit-project' | 'closeout' | 'overview-view', ... }.
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
    case 'initiate':
      return handleProjectsInitiate(authorizationHeader, body)
    case 'overview-view':
      return handleProjectsOverviewView(authorizationHeader, body)
    case 'edit-project':
      return runProjectChange(authorizationHeader, 'save the project', (admin, profileId) =>
        editProject(admin, profileId, parseEditPayload(body)),
      )
    case 'closeout':
      return runProjectChange(authorizationHeader, 'close out the project', (admin, profileId) =>
        closeoutProject(admin, profileId, parseCloseoutPayload(body)),
      )
    default:
      return {
        status: 400,
        json: {
          error:
            '"action" must be "sync", "star", "update", "initiate", "edit-project", "closeout", or "overview-view"',
        },
      }
  }
}
