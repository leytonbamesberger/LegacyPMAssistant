import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch, getIdToken } from './apiClient'
import type { RecurringSelection, SetupSelection } from './initiation'

export interface Project {
  id: string
  procore_project_id: number
  procore_company_id: number
  job_number: string | null
  name: string
  procore_active: boolean
  is_active: boolean
  last_synced_at: string
  isStarred: boolean
  gc: string | null
  status: 'active' | 'closing' | 'closed'
  pm_id: string | null
  apm_id: string | null
  checklist_enabled: boolean
  /** Set once by the initiation wizard; gates Setup/Recurring tasks and Overview inclusion. */
  initiated: boolean
}

export interface ProjectEditableFields {
  gc?: string | null
  status?: 'active' | 'closing' | 'closed'
  pm_id?: string | null
  apm_id?: string | null
  checklist_enabled?: boolean
}

interface ProjectsResponse {
  projects: Project[]
}

interface SyncResponse extends ProjectsResponse {
  syncOk: boolean
  syncError: string | null
  syncedAt: string
}

function postProjectsAction<T>(
  instance: IPublicClientApplication,
  account: AccountInfo,
  body: Record<string, unknown>,
): Promise<T | null> {
  return apiFetch<T>(instance, account, '/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Cached project list — fast, never itself talks to Procore. */
export async function fetchProjects(
  instance: IPublicClientApplication,
  account: AccountInfo,
): Promise<Project[] | null> {
  const body = await apiFetch<ProjectsResponse>(instance, account, '/api/projects')
  return body?.projects ?? null
}

/** Pulls fresh data from Procore (via the user's own token) and returns the refreshed list. */
export async function syncProjects(
  instance: IPublicClientApplication,
  account: AccountInfo,
): Promise<SyncResponse | null> {
  return postProjectsAction<SyncResponse>(instance, account, { action: 'sync' })
}

/**
 * Stars/unstars a project. If the caller is a `pm`/`apm` and the project has
 * no pm_id/apm_id yet, this also claims that slot server-side (see
 * autoAssignOnStar in server/projects.ts) — re-fetch the project list
 * afterward to pick up any resulting pm_id/apm_id change.
 */
export async function setProjectStarred(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  starred: boolean,
): Promise<boolean> {
  const body = await postProjectsAction<{ starred: boolean }>(instance, account, {
    action: 'star',
    projectId,
    starred,
  })
  return body?.starred === starred
}

/** Edits gc/status/pm_id/apm_id/checklist_enabled on an existing project. */
export async function updateProject(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  fields: ProjectEditableFields,
): Promise<boolean> {
  const body = await postProjectsAction<{ ok: boolean }>(instance, account, {
    action: 'update',
    projectId,
    ...fields,
  })
  return body?.ok === true
}

// ---------------------------------------------------------------------------------------------
// Edit Project / Closeout Project
// ---------------------------------------------------------------------------------------------

export interface EditCatalogItem {
  id: string
  phase: 'setup' | 'recurring'
  name: string
  sort_order: number
  cadence_days: number | null
  cadence_type: 'rolling' | 'calendar_month' | null
  is_meeting: boolean
  /** null = shared default; set = this project's own custom item. */
  project_id: string | null
  /** included = the project has it now; excluded = it hid it; new = neither (added to the catalog later). */
  state: 'included' | 'excluded' | 'new'
  /** A Setup item whose task is complete: can't be unchecked. */
  locked: boolean
}

export interface CloseoutCatalogItem {
  id: string
  name: string
  sort_order: number
  /** The project already has a closeout task for it. */
  selected: boolean
  /** That task is complete: can't be unchecked. */
  locked: boolean
  dueDate: string | null
}

export interface ProjectEditCatalog {
  project: {
    id: string
    initiated: boolean
    status: 'active' | 'closing' | 'closed'
    pm_id: string | null
    apm_id: string | null
  }
  items: EditCatalogItem[]
  /** Existing open Setup due date ("Setup complete by"), to prefill items added later. */
  setupDueDate: string | null
  closeout: CloseoutCatalogItem[]
}

export function fetchProjectEditCatalog(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
): Promise<ProjectEditCatalog | null> {
  return apiFetch<ProjectEditCatalog>(instance, account, `/api/projects?editCatalogFor=${encodeURIComponent(projectId)}`)
}

export interface EditProjectPayload {
  projectId: string
  /** Omitted = unchanged; null = cleared. */
  pmId?: string | null
  apmId?: string | null
  /** Included items to take off the project. */
  removeItemIds: string[]
  /** Newly (re)included items with their dates (same shape the initiation wizard sends). */
  addSetup: SetupSelection[]
  addRecurring: RecurringSelection[]
}

export interface CloseoutPayload {
  projectId: string
  items: { itemId: string; dueDate: string }[]
  /** Only honoured the first time. */
  stopRecurring: boolean
}

type ActionResult = { ok: true } | { ok: false; error: string }

/** Like the wizard's submit: surfaces the server's reason ("already complete", the database's detail) instead of collapsing to null. */
async function postProjectAction(
  instance: IPublicClientApplication,
  account: AccountInfo,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const idToken = await getIdToken(instance, account)
  if (!idToken) return { ok: false, error: 'Could not verify your sign-in — try again' }
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    })
    if (res.ok) return { ok: true }
    const err = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null
    const message = err?.error ?? `Request failed (${res.status})`
    return { ok: false, error: err?.detail ? `${message} (${err.detail})` : message }
  } catch {
    return { ok: false, error: 'Network error — try again' }
  }
}

export function editProject(
  instance: IPublicClientApplication,
  account: AccountInfo,
  payload: EditProjectPayload,
): Promise<ActionResult> {
  return postProjectAction(instance, account, { action: 'edit-project', ...payload })
}

export function closeoutProject(
  instance: IPublicClientApplication,
  account: AccountInfo,
  payload: CloseoutPayload,
): Promise<ActionResult> {
  return postProjectAction(instance, account, { action: 'closeout', ...payload })
}

