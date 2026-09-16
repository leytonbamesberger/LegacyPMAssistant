import { createHash } from 'node:crypto'
import { SupabaseClient } from '@supabase/supabase-js'
import { normalizeCsiCode } from '../shared/csi.js'
import { getValidAccessToken } from './procore.js'
import {
  downloadBinary,
  listSpecificationSections,
  RawProcoreSpecSection,
} from './procoreApi.js'
import { extractPdfText } from './pdf.js'
import { callAnthropicTool, textContentBlock } from './ai/anthropicClient.js'
import { PROMPT_MODEL_CONFIG } from './ai/modelConfig.js'
import { logAiUsage } from './ai/usageLog.js'
import {
  SPEC_EXTRACTION_PROMPT,
  SPEC_EXTRACTION_SCHEMA,
  SpecExtractionResult,
} from './prompts/specExtraction.js'
import {
  SPEC_SPLIT_PROMPT,
  SPEC_SPLIT_SCHEMA,
  SpecSplitResult,
} from './prompts/specSplit.js'

/** Listing shape — no `raw_text`, so the picker's fetch stays small. Only
 * `getOrExtractChecklist` reads the raw text, via its own narrower query. */
export interface SpecSectionSummary {
  id: string
  project_id: string
  csi_code: string
  csi_code_display: string | null
  title: string | null
  procore_version: string | null
  synced_at: string
}

export interface SyncSpecsResult {
  ok: boolean
  error?: string
  sectionCount: number
}

const CODE_RE = /(\d{2})[\s.-]?(\d{2})[\s.-]?(\d{2})/
// Matches "SECTION 22 13 13" style headers to count how many sections a
// combined chunk of text actually contains.
const SECTION_HEADER_RE = /\bsection\s+\d{2}[\s.-]?\d{2}[\s.-]?\d{2}\b/gi

function contentVersion(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function pickFirst(raw: RawProcoreSpecSection, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

/** A code from the item's own metadata (or, failing that, its title), if one is recognizable. */
function extractOwnCode(raw: RawProcoreSpecSection): { code: string; display: string } | null {
  const metaField = pickFirst(raw, ['number', 'csi_code', 'section_number', 'code'])
  if (metaField) {
    const match = metaField.match(CODE_RE)
    if (match) return { code: normalizeCsiCode(match[0]), display: metaField.trim() }
  }
  const titleField = pickFirst(raw, ['title', 'name', 'description'])
  if (titleField) {
    const match = titleField.match(CODE_RE)
    if (match) return { code: normalizeCsiCode(match[0]), display: match[0] }
  }
  return null
}

function extractTitle(raw: RawProcoreSpecSection): string | null {
  return pickFirst(raw, ['title', 'name', 'description'])
}

function extractInlineText(raw: RawProcoreSpecSection): string | null {
  const text = pickFirst(raw, ['text', 'body', 'content', 'raw_text'])
  return text && text.trim().length > 40 ? text : null
}

function extractFileUrl(raw: RawProcoreSpecSection): string | null {
  const direct = pickFirst(raw, ['url', 'file_url', 'document_url', 'download_url'])
  if (direct?.startsWith('http')) return direct
  const doc = raw.document
  if (doc && typeof doc === 'object') {
    const nested = pickFirst(doc as RawProcoreSpecSection, ['url', 'file_url'])
    if (nested?.startsWith('http')) return nested
  }
  return null
}

async function resolveItemText(
  raw: RawProcoreSpecSection,
  accessToken: string,
): Promise<string | null> {
  const inline = extractInlineText(raw)
  if (inline) return inline

  const fileUrl = extractFileUrl(raw)
  if (!fileUrl) return null

  try {
    const bytes = await downloadBinary(fileUrl, accessToken)
    const text = await extractPdfText(bytes)
    return text.trim() ? text : null
  } catch (err) {
    console.warn(`[specs] could not extract text from ${fileUrl}:`, err)
    return null
  }
}

async function splitCombinedText(
  text: string,
  profileId: string,
  admin: SupabaseClient,
): Promise<{ csi_section: string; title: string | null; text: string }[]> {
  const config = PROMPT_MODEL_CONFIG.specSplit
  const { data, inputTokens, outputTokens } = await callAnthropicTool<SpecSplitResult>({
    model: config.model,
    effort: config.effort,
    system: SPEC_SPLIT_PROMPT,
    content: [textContentBlock(text)],
    toolName: 'record_sections',
    toolDescription: 'Record the split-out specification sections.',
    toolSchema: SPEC_SPLIT_SCHEMA,
  })
  await logAiUsage(admin, {
    submittalCheckId: null,
    profileId,
    promptType: 'specSplit',
    model: config.model,
    inputTokens,
    outputTokens,
  })
  return data.sections
}

/**
 * Sync a project's Procore specifications into `spec_sections`. Uses the
 * caller's own Procore token. Adaptive per item: if it already carries a
 * single recognizable CSI code and its text doesn't look like it contains
 * multiple "SECTION xx xx xx" headers, it's stored directly; otherwise a
 * cheap Haiku pass (`specSplit`) splits it into per-section chunks first.
 * Staleness is tracked by content hash, not a Procore-specific version field
 * (see the note on `RawProcoreSpecSection`), so this works regardless of
 * exactly which "last modified" field Procore's response actually uses.
 */
export async function syncProjectSpecs(
  admin: SupabaseClient,
  profileId: string,
  projectId: string,
): Promise<SyncSpecsResult> {
  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('procore_project_id, procore_company_id')
    .eq('id', projectId)
    .maybeSingle()
  if (projectError) return { ok: false, error: projectError.message, sectionCount: 0 }
  if (!project) return { ok: false, error: 'Unknown project', sectionCount: 0 }

  let accessToken: string | null
  try {
    accessToken = await getValidAccessToken(admin, profileId)
  } catch (err) {
    console.warn('[specs] could not get a Procore access token:', err)
    return { ok: false, error: 'Procore token refresh failed', sectionCount: 0 }
  }
  if (!accessToken) {
    return { ok: false, error: 'Procore is not connected for this user', sectionCount: 0 }
  }

  let rawSections: RawProcoreSpecSection[]
  try {
    rawSections = await listSpecificationSections(
      accessToken,
      project.procore_project_id as number,
      project.procore_company_id as number,
    )
  } catch (err) {
    console.warn('[specs] listSpecificationSections failed:', err)
    return { ok: false, error: 'Could not reach Procore', sectionCount: 0 }
  }

  const rowsToUpsert: {
    project_id: string
    csi_code: string
    csi_code_display: string | null
    title: string | null
    raw_text: string
    procore_version: string
    synced_at: string
  }[] = []

  for (const raw of rawSections) {
    const text = await resolveItemText(raw, accessToken)
    if (!text) continue

    const ownCode = extractOwnCode(raw)
    const headerMatches = text.match(SECTION_HEADER_RE)
    const looksSegmented = ownCode !== null && (headerMatches?.length ?? 0) <= 1

    if (looksSegmented && ownCode) {
      rowsToUpsert.push({
        project_id: projectId,
        csi_code: ownCode.code,
        csi_code_display: ownCode.display,
        title: extractTitle(raw),
        raw_text: text,
        procore_version: contentVersion(text),
        synced_at: new Date().toISOString(),
      })
      continue
    }

    try {
      const parts = await splitCombinedText(text, profileId, admin)
      for (const part of parts) {
        const normalized = normalizeCsiCode(part.csi_section)
        if (!normalized) continue
        rowsToUpsert.push({
          project_id: projectId,
          csi_code: normalized,
          csi_code_display: part.csi_section,
          title: part.title,
          raw_text: part.text,
          procore_version: contentVersion(part.text),
          synced_at: new Date().toISOString(),
        })
      }
    } catch (err) {
      console.warn('[specs] splitCombinedText failed for one document:', err)
    }
  }

  if (rowsToUpsert.length === 0) {
    return { ok: true, sectionCount: 0 }
  }

  const { error: upsertError } = await admin
    .from('spec_sections')
    .upsert(rowsToUpsert, { onConflict: 'project_id,csi_code' })
  if (upsertError) {
    console.warn('[specs] upsert failed:', upsertError.message)
    return { ok: false, error: 'Could not save synced specs', sectionCount: 0 }
  }

  return { ok: true, sectionCount: rowsToUpsert.length }
}

export async function getSpecSectionsForProject(
  admin: SupabaseClient,
  projectId: string,
): Promise<SpecSectionSummary[]> {
  const { data, error } = await admin
    .from('spec_sections')
    .select('id, project_id, csi_code, csi_code_display, title, procore_version, synced_at')
    .eq('project_id', projectId)
    .order('csi_code')
  if (error) throw new Error(error.message)
  return (data ?? []) as SpecSectionSummary[]
}

/**
 * Look up (or extract-and-cache) the requirement checklist for one project +
 * CSI section. A cached checklist is reused only while its `source_spec_version`
 * still matches the current `spec_sections.procore_version` (content hash) —
 * otherwise it's re-extracted from the current spec text.
 */
export async function getOrExtractChecklist(
  admin: SupabaseClient,
  profileId: string,
  submittalCheckId: string | null,
  projectId: string,
  csiCode: string,
): Promise<{ checklist: SpecExtractionResult } | { error: string }> {
  const { data: section, error: sectionError } = await admin
    .from('spec_sections')
    .select('raw_text, procore_version')
    .eq('project_id', projectId)
    .eq('csi_code', csiCode)
    .maybeSingle()
  if (sectionError) return { error: sectionError.message }
  if (!section) return { error: `No cached spec text for CSI section ${csiCode}` }

  const { data: cached, error: cachedError } = await admin
    .from('spec_checklists')
    .select('checklist, source_spec_version')
    .eq('project_id', projectId)
    .eq('csi_code', csiCode)
    .maybeSingle()
  if (cachedError) return { error: cachedError.message }

  if (cached && cached.source_spec_version === section.procore_version) {
    return { checklist: cached.checklist as SpecExtractionResult }
  }

  const config = PROMPT_MODEL_CONFIG.specExtraction
  let result: SpecExtractionResult
  let inputTokens = 0
  let outputTokens = 0
  try {
    const called = await callAnthropicTool<SpecExtractionResult>({
      model: config.model,
      effort: config.effort,
      system: SPEC_EXTRACTION_PROMPT,
      content: [textContentBlock(section.raw_text as string)],
      toolName: 'record_requirements',
      toolDescription: 'Record the extracted specification requirements.',
      toolSchema: SPEC_EXTRACTION_SCHEMA,
    })
    result = called.data
    inputTokens = called.inputTokens
    outputTokens = called.outputTokens
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  await logAiUsage(admin, {
    submittalCheckId,
    profileId,
    promptType: 'specExtraction',
    model: config.model,
    inputTokens,
    outputTokens,
  })

  const { error: upsertError } = await admin.from('spec_checklists').upsert(
    {
      project_id: projectId,
      csi_code: csiCode,
      checklist: result,
      source_spec_version: section.procore_version,
      extracted_at: new Date().toISOString(),
    },
    { onConflict: 'project_id,csi_code' },
  )
  if (upsertError) console.warn('[specs] checklist cache upsert failed:', upsertError.message)

  return { checklist: result }
}
