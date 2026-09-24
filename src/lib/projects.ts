import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch } from './apiClient'

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
