import { getProcoreConfig, ProcoreConfig } from './config.js'

export interface ProcoreCompany {
  id: number
  name: string
  is_active?: boolean
}

/**
 * A raw Procore project resource. Field names are best-effort from Procore's
 * public docs — verified against `name` and `project_number`, but Procore's
 * status/active field name isn't fully pinned down. Read defensively (see
 * `server/projects.ts`) rather than assuming an exact shape.
 */
export type RawProcoreProject = Record<string, unknown>

async function procoreGet<T>(
  path: string,
  accessToken: string,
  config: ProcoreConfig,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(`${config.apiBase}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...extraHeaders,
    },
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `Procore API ${path} returned ${res.status}: ${text.slice(0, 500)}`,
    )
  }
  return text ? (JSON.parse(text) as T) : ({} as T)
}

/** Companies the token's user has access to. Usually just one for a sub. */
export async function listCompanies(
  accessToken: string,
  config = getProcoreConfig(),
): Promise<ProcoreCompany[]> {
  return procoreGet<ProcoreCompany[]>('/rest/v1.0/companies', accessToken, config)
}

/**
 * Projects within one company. Procore requires the company id as BOTH a
 * query param and the `Procore-Company-Id` header.
 */
export async function listProjectsForCompany(
  accessToken: string,
  companyId: number,
  config = getProcoreConfig(),
): Promise<RawProcoreProject[]> {
  return procoreGet<RawProcoreProject[]>(
    `/rest/v1.0/projects?company_id=${companyId}`,
    accessToken,
    config,
    { 'Procore-Company-Id': String(companyId) },
  )
}
