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
}

interface ProjectsResponse {
  projects: Project[]
}

interface SyncResponse extends ProjectsResponse {
  syncOk: boolean
  syncError: string | null
  syncedAt: string
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
  return apiFetch<SyncResponse>(instance, account, '/api/projects/sync', {
    method: 'POST',
  })
}

export async function setProjectStarred(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
  starred: boolean,
): Promise<boolean> {
  const body = await apiFetch<{ starred: boolean }>(
    instance,
    account,
    '/api/projects/star',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, starred }),
    },
  )
  return body?.starred === starred
}
