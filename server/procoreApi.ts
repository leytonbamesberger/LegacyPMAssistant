import { getProcoreConfig, ProcoreConfig } from './config.js'
import { fetchWithTimeout } from './fetchTimeout.js'

const PROCORE_TIMEOUT_MS = 20000

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const MAX_429_RETRIES = 2
// Procore's `Retry-After` can be large (its rate-limit windows are per-minute
// or longer); honoring it verbatim across several sequential per-item calls
// can silently stall a sync for minutes with no visible progress. Cap the
// wait so a persistently-limited item fails fast instead of hanging.
const MAX_RETRY_WAIT_MS = 3000

/**
 * A sync can fire one request per spec-section revision, which is enough to
 * trip Procore's rate limit on a project with a few dozen sections. Retries
 * 429s with backoff (honoring `Retry-After` when present, capped) before
 * giving up — logged so a retry-induced delay is visible instead of looking
 * like a hang.
 */
async function procoreGet<T>(
  path: string,
  accessToken: string,
  config: ProcoreConfig,
  extraHeaders: Record<string, string> = {},
  attempt = 0,
): Promise<T> {
  const res = await fetchWithTimeout(
    `${config.apiBase}${path}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...extraHeaders,
      },
    },
    PROCORE_TIMEOUT_MS,
  )

  if (res.status === 429 && attempt < MAX_429_RETRIES) {
    const retryAfterHeader = Number(res.headers.get('retry-after'))
    const requestedMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader * 1000
      : 1000 * 2 ** attempt
    const waitMs = Math.min(requestedMs, MAX_RETRY_WAIT_MS)
    console.warn(
      `[procore] 429 on ${path}, retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_429_RETRIES})`,
    )
    await sleep(waitMs)
    return procoreGet<T>(path, accessToken, config, extraHeaders, attempt + 1)
  }

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
 * `specification_sections` list items carry no document content or URL —
 * only `current_revision_id`. The actual PDF lives on the revision, fetched
 * separately via the v2.1 "show" endpoint. Procore's own reference docs for
 * this endpoint show the response nested under `data.selected_revision`, but
 * the live API actually nests it under `data.current_revision` (confirmed
 * against a real response) — `url` on that object is the pre-signed PDF
 * download URL, blank if the section was created manually with no upload.
 */
export type RawProcoreSpecRevision = Record<string, unknown>

export async function getSpecificationSectionRevision(
  accessToken: string,
  companyId: number,
  projectId: number,
  revisionId: number,
  config = getProcoreConfig(),
): Promise<RawProcoreSpecRevision> {
  const res = await procoreGet<{ data: { current_revision: RawProcoreSpecRevision } }>(
    `/rest/v2.1/companies/${companyId}/projects/${projectId}/specification_section_revisions/${revisionId}`,
    accessToken,
    config,
    { 'Procore-Company-Id': String(companyId) },
  )
  return res.data.current_revision
}

/**
 * Download a binary file. Procore file references are sometimes a pre-signed
 * URL that needs no auth and sometimes an API path that needs the bearer
 * token — try authenticated first, then retry without the header on a 4xx in
 * case the token itself is what caused an otherwise-valid signed URL to
 * reject the request.
 */
const DOWNLOAD_TIMEOUT_MS = 30000

export async function downloadBinary(
  url: string,
  accessToken: string,
): Promise<Uint8Array> {
  const authed = await fetchWithTimeout(
    url,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    DOWNLOAD_TIMEOUT_MS,
  )
  if (authed.ok) return new Uint8Array(await authed.arrayBuffer())

  if (authed.status >= 400 && authed.status < 500) {
    const unauthed = await fetchWithTimeout(url, {}, DOWNLOAD_TIMEOUT_MS)
    if (unauthed.ok) return new Uint8Array(await unauthed.arrayBuffer())
  }

  throw new Error(`Could not download ${url}: HTTP ${authed.status}`)
}
