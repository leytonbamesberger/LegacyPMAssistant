import { SupabaseClient } from '@supabase/supabase-js'
import { normalizeCsiCode } from '../shared/csi.js'
import { CATEGORY_KEYS, CATEGORY_META, CategoryResult, CategoryKey } from '../shared/categories.js'
import { getConfidenceThreshold } from './appConfig.js'
import {
  callAnthropicTool,
  pdfContentBlock,
  textContentBlock,
} from './ai/anthropicClient.js'
import { PROMPT_MODEL_CONFIG } from './ai/modelConfig.js'
import { logAiUsage } from './ai/usageLog.js'
import {
  SPEC_IDENTIFICATION_PROMPT,
  SPEC_IDENTIFICATION_SCHEMA,
  SpecIdentificationResult,
} from './prompts/specIdentification.js'
import {
  COMPLIANCE_CHECK_PROMPT,
  COMPLIANCE_CHECK_SCHEMA,
  ComplianceCheckResult,
} from './prompts/complianceCheck.js'
import { getOrExtractChecklist } from './specs.js'
import { createSubmittalUploadUrl, downloadSubmittalFile, submittalStoragePath } from './storage.js'

export interface SubmittalCheckRecord {
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

export interface CreateSubmittalInput {
  projectId: string
  filename: string
  /** Manual "Spec Section (Optional)" pick, raw form — normalized before storing. */
  csiSection?: string
}

export interface CreateSubmittalResult {
  submittalCheckId: string
  uploadPath: string
  uploadToken: string
}

export async function createSubmittalCheck(
  admin: SupabaseClient,
  profileId: string,
  input: CreateSubmittalInput,
): Promise<CreateSubmittalResult> {
  const csiSection = input.csiSection ? normalizeCsiCode(input.csiSection) : null

  const { data: row, error } = await admin
    .from('submittal_checks')
    .insert({
      project_id: input.projectId,
      profile_id: profileId,
      filename: input.filename,
      status: 'pending',
      csi_section: csiSection,
      section_source: csiSection ? 'user_selected' : null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  const path = submittalStoragePath(input.projectId, row.id as string)
  const { token } = await createSubmittalUploadUrl(admin, path)

  const { error: pathError } = await admin
    .from('submittal_checks')
    .update({ file_path: path })
    .eq('id', row.id)
  if (pathError) console.warn('[submittals] could not save file_path:', pathError.message)

  return { submittalCheckId: row.id as string, uploadPath: path, uploadToken: token }
}

export async function getSubmittalCheck(
  admin: SupabaseClient,
  id: string,
): Promise<SubmittalCheckRecord | null> {
  const { data, error } = await admin
    .from('submittal_checks')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as SubmittalCheckRecord) ?? null
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
  | { kind: 'completed'; check: SubmittalCheckRecord }
  | { kind: 'failed'; error: string }

export interface RunSubmittalOptions {
  /** From the low-confidence picker, or "rerun with a different section". */
  csiSectionOverride?: string
  /** The upload form's "treat bundled items as one submittal" checkbox. */
  treatAsSingleSubmittal?: boolean
}

function computeScore(categories: Record<CategoryKey, CategoryResult>): number | null {
  let numerator = 0
  let denominator = 0
  for (const key of CATEGORY_KEYS) {
    const status = categories[key]?.status
    if (!status || status === 'N/A') continue
    const weight = CATEGORY_META[key].weight
    const mapped = status === 'Pass' ? 2 : status === 'Caution' ? 1 : 0
    numerator += mapped * weight
    denominator += 2 * weight
  }
  return denominator === 0 ? null : (numerator / denominator) * 100
}

async function markFailed(
  admin: SupabaseClient,
  id: string,
  message: string,
): Promise<RunSubmittalResult> {
  await admin
    .from('submittal_checks')
    .update({ status: 'failed', error_message: message })
    .eq('id', id)
  return { kind: 'failed', error: message }
}

/**
 * Run (or continue) the submittal-check pipeline for an already-uploaded
 * file. Never auto-retries on an AI failure — throws are caught once and the
 * row is marked `failed`, surfaced for a manual retry.
 */
export async function runSubmittalCheck(
  admin: SupabaseClient,
  profileId: string,
  submittalCheckId: string,
  options: RunSubmittalOptions = {},
): Promise<RunSubmittalResult> {
  const check = await getSubmittalCheck(admin, submittalCheckId)
  if (!check) return { kind: 'failed', error: 'Submittal check not found' }
  if (!check.file_path) return { kind: 'failed', error: 'No uploaded file for this check' }

  let pdfBytes: Uint8Array
  try {
    pdfBytes = await downloadSubmittalFile(admin, check.file_path)
  } catch (err) {
    return markFailed(admin, submittalCheckId, `Could not read uploaded file: ${err instanceof Error ? err.message : String(err)}`)
  }
  const pdfBase64 = Buffer.from(pdfBytes).toString('base64')

  let csiSection = options.csiSectionOverride
    ? normalizeCsiCode(options.csiSectionOverride)
    : check.csi_section
  let sectionSource: 'ai_detected' | 'user_selected' | null = options.csiSectionOverride
    ? 'user_selected'
    : check.section_source
  let sectionConfidence: number | null = check.section_confidence

  if (!csiSection) {
    const idConfig = PROMPT_MODEL_CONFIG.specIdentification
    let idResult: SpecIdentificationResult
    try {
      const called = await callAnthropicTool<SpecIdentificationResult>({
        model: idConfig.model,
        effort: idConfig.effort,
        system: SPEC_IDENTIFICATION_PROMPT,
        content: [
          pdfContentBlock(pdfBase64),
          textContentBlock(
            `User has indicated: treat as single submittal = ${Boolean(options.treatAsSingleSubmittal)}.`,
          ),
        ],
        toolName: 'record_classification',
        toolDescription: 'Record the submittal classification.',
        toolSchema: SPEC_IDENTIFICATION_SCHEMA,
      })
      idResult = called.data
      await logAiUsage(admin, {
        submittalCheckId,
        profileId,
        promptType: 'specIdentification',
        model: idConfig.model,
        inputTokens: called.inputTokens,
        outputTokens: called.outputTokens,
      })
    } catch (err) {
      return markFailed(admin, submittalCheckId, err instanceof Error ? err.message : String(err))
    }

    if (idResult.multi_product && !idResult.treat_as_single_submittal) {
      await admin
        .from('submittal_checks')
        .update({ status: 'multi_product' })
        .eq('id', submittalCheckId)
      return { kind: 'multi_product', explanation: idResult.multi_product_explanation }
    }

    const threshold = await getConfidenceThreshold(admin)
    if (idResult.confidence < threshold) {
      return {
        kind: 'needs_section_selection',
        predictedSection: idResult.predicted_csi_section,
        predictedTitle: idResult.predicted_section_title,
        confidence: idResult.confidence,
        reasoning: idResult.reasoning,
      }
    }

    if (!idResult.predicted_csi_section) {
      return {
        kind: 'needs_section_selection',
        predictedSection: null,
        predictedTitle: null,
        confidence: idResult.confidence,
        reasoning: idResult.reasoning,
      }
    }

    csiSection = normalizeCsiCode(idResult.predicted_csi_section)
    sectionSource = 'ai_detected'
    sectionConfidence = idResult.confidence

    // Persist the resolved section now, before the (separately billed)
    // checklist/compliance steps run — if one of those fails, a manual retry
    // sees `check.csi_section` already set and skips re-running identification.
    await admin
      .from('submittal_checks')
      .update({
        csi_section: csiSection,
        section_source: sectionSource,
        section_confidence: sectionConfidence,
      })
      .eq('id', submittalCheckId)
  }

  const checklistResult = await getOrExtractChecklist(
    admin,
    profileId,
    submittalCheckId,
    check.project_id,
    csiSection,
  )
  if ('error' in checklistResult) {
    return markFailed(admin, submittalCheckId, checklistResult.error)
  }

  const complianceConfig = PROMPT_MODEL_CONFIG.complianceCheck
  let complianceResult: ComplianceCheckResult
  try {
    const called = await callAnthropicTool<ComplianceCheckResult>({
      model: complianceConfig.model,
      effort: complianceConfig.effort,
      system: COMPLIANCE_CHECK_PROMPT,
      content: [
        pdfContentBlock(pdfBase64),
        textContentBlock(`Checklist:\n${JSON.stringify(checklistResult.checklist)}`),
      ],
      toolName: 'record_compliance',
      toolDescription: 'Record the compliance check results.',
      toolSchema: COMPLIANCE_CHECK_SCHEMA,
      maxTokens: 2048,
    })
    complianceResult = called.data
    await logAiUsage(admin, {
      submittalCheckId,
      profileId,
      promptType: 'complianceCheck',
      model: complianceConfig.model,
      inputTokens: called.inputTokens,
      outputTokens: called.outputTokens,
    })
  } catch (err) {
    return markFailed(admin, submittalCheckId, err instanceof Error ? err.message : String(err))
  }

  const scorePercent = computeScore(complianceResult.categories)
  // A simple, tunable-by-eye margin above the pass threshold: AI-detected
  // sections that only just cleared the bar still get flagged for a human
  // glance, even though the pipeline proceeded automatically.
  const threshold = await getConfidenceThreshold(admin)
  const lowConfidenceWarning =
    sectionSource === 'ai_detected' &&
    sectionConfidence !== null &&
    sectionConfidence < threshold + 10

  const { data: updated, error: updateError } = await admin
    .from('submittal_checks')
    .update({
      status: 'completed',
      csi_section: csiSection,
      category_results: complianceResult.categories,
      score_percent: scorePercent,
      section_confidence: sectionConfidence,
      section_source: sectionSource,
      low_confidence_warning: lowConfidenceWarning,
      error_message: null,
    })
    .eq('id', submittalCheckId)
    .select('*')
    .single()
  if (updateError) return markFailed(admin, submittalCheckId, updateError.message)

  return { kind: 'completed', check: updated as SubmittalCheckRecord }
}
