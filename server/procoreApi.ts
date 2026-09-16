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

/**
 * A raw Procore specification-section resource. UNVERIFIED against a live
 * response — Procore's public reference for this endpoint is a JS-rendered
 * page I could not fetch during development. `server/specs.ts` reads this
 * defensively (several candidate field names, and an adaptive check for
 * whether Procore already segmented it per-section vs handed back a combined
 * document) rather than assuming one shape. If a real sync comes back empty
 * or wrong, log the raw response and adjust the candidate lists there.
 */
export type RawProcoreSpecSection = Record<string, unknown>

export async function listSpecificationSections(
  accessToken: string,
  projectId: number,
  companyId: number,
  config = getProcoreConfig(),
): Promise<RawProcoreSpecSection[]> {
  return procoreGet<RawProcoreSpecSection[]>(
    `/rest/v1.0/specification_sections?project_id=${projectId}`,
    accessToken,
    config,
    { 'Procore-Company-Id': String(companyId) },
  )
}

/**
 * Download a binary file. Procore file references are sometimes a pre-signed
 * URL that needs no auth and sometimes an API path that needs the bearer
 * token — try authenticated first, then retry without the header on a 4xx in
 * case the token itself is what caused an otherwise-valid signed URL to
 * reject the request.
 */
export async function downloadBinary(
  url: string,
  accessToken: string,
): Promise<Uint8Array> {
  const authed = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (authed.ok) return new Uint8Array(await authed.arrayBuffer())

  if (authed.status >= 400 && authed.status < 500) {
    const unauthed = await fetch(url)
    if (unauthed.ok) return new Uint8Array(await unauthed.arrayBuffer())
  }

  throw new Error(`Could not download ${url}: HTTP ${authed.status}`)
}
