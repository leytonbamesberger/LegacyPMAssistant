import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch } from './apiClient'
import { supabase } from './supabaseClient'

export interface SpecSection {
  id: string
  project_id: string
  csi_code: string
  csi_code_display: string | null
  title: string | null
  procore_version: string | null
  synced_at: string
}

interface SpecsResponse {
  sections: SpecSection[]
}

interface SpecsSyncResponse extends SpecsResponse {
  syncOk: boolean
  syncError: string | null
  syncedAt: string
}

export async function fetchProjectSpecs(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
): Promise<SpecSection[] | null> {
  const body = await apiFetch<SpecsResponse>(
    instance,
    account,
    `/api/specs?projectId=${encodeURIComponent(projectId)}`,
  )
  return body?.sections ?? null
}

export async function syncProjectSpecs(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
): Promise<SpecsSyncResponse | null> {
  return apiFetch<SpecsSyncResponse>(instance, account, '/api/specs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId }),
  })
}

export type CategoryStatus = 'Pass' | 'Fail' | 'Caution' | 'N/A'

export interface CategoryResult {
  status: CategoryStatus
  notes: string
}

export type CategoryKey =
  | 'manufacturer_model'
  | 'sizing'
  | 'certifications'
  | 'performance_data'
  | 'accessories'
  | 'misc'

export interface SubmittalCheck {
  id: string
  project_id: string
  profile_id: string
  csi_section: string | null
  filename: string | null
  file_path: string | null
  status: 'pending' | 'completed' | 'failed' | 'multi_product'
  category_results: Record<CategoryKey, CategoryResult> | null
  score_percent: number | null
  section_confidence: number | null
  section_source: 'ai_detected' | 'user_selected' | null
  low_confidence_warning: boolean
  error_message: string | null
  created_at: string
}

export type RunSubmittalResult =
  | {
      kind: 'needs_section_selection'
      predictedSection: string | null
      predictedTitle: string | null
      confidence: number
      reasoning: string
    }
  | { kind: 'multi_product'; explanation: string | null }
  | { kind: 'completed'; check: SubmittalCheck }
  | { kind: 'failed'; error: string }

/** Step 1: create the row + get a scoped Storage upload token. */
export async function createSubmittal(
  instance: IPublicClientApplication,
  account: AccountInfo,
  input: { projectId: string; filename: string; csiSection?: string },
): Promise<{ submittalCheckId: string; uploadPath: string; uploadToken: string } | null> {
  return apiFetch(instance, account, '/api/submittals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

/**
 * Step 2: upload the PDF bytes directly to Storage using the signed token
 * from `createSubmittal` — the anon client is safe here because the *token*
 * (not the anon key's own permissions) authorizes this one write.
 */
export async function uploadSubmittalFile(
  path: string,
  token: string,
  file: File,
): Promise<boolean> {
  const { error } = await supabase.storage.from('submittals').uploadToSignedUrl(path, token, file)
  if (error) console.error('[submittals] upload failed:', error.message)
  return !error
}

/** Step 3: run (or continue) the pipeline. */
export async function runSubmittal(
  instance: IPublicClientApplication,
  account: AccountInfo,
  input: {
    submittalCheckId: string
    csiSectionOverride?: string
    treatAsSingleSubmittal?: boolean
  },
): Promise<RunSubmittalResult | null> {
  return apiFetch(instance, account, '/api/submittals/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function getSubmittal(
  instance: IPublicClientApplication,
  account: AccountInfo,
  id: string,
): Promise<SubmittalCheck | null> {
  const body = await apiFetch<{ check: SubmittalCheck }>(
    instance,
    account,
    `/api/submittals?id=${encodeURIComponent(id)}`,
  )
  return body?.check ?? null
}
