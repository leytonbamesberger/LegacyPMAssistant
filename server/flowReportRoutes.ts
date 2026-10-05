import { ApiResult, binary } from './http.js'
import { resolveProfile } from './auth.js'
import {
  getAvailableFlowReportMonths,
  getDefaultPeriodFlowReportsForProjects,
  getFlowReportForMonth,
  getFlowReportsForMonth,
  saveFlowReportDraft,
  submitFlowReport,
  type FlowReportAnswers,
} from './flowReports.js'
import { generateFlowReportPdf } from './flowReportPdf.js'
import { FLOW_BUDGET_ITEMS, type FlowBudgetChecklist } from '../shared/flowBudget.js'

function parseProjectIds(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

/**
 * GET /api/flow-reports — several modes, checked in order:
 *   ?projectId=x&month=YYYY-MM-DD    — one project's report for one specific month (the
 *                                       form's month selector, which can reach any month)
 *   ?projectIds=a,b,c&availableMonths=1 — every month with data for these projects (the
 *                                          export tool's month selector)
 *   ?projectIds=a,b,c&month=YYYY-MM-DD  — each project's report for one specific month
 *                                          (the export tool's project-selection screen)
 *   ?projectIds=a,b,c                — default-period report for each project (dashboard summary)
 */
export async function handleFlowReportsList(
  authorizationHeader: string | undefined,
  query: { projectIds?: string; projectId?: string; month?: string; availableMonths?: string },
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  if (query.projectId && query.month) {
    try {
      const report = await getFlowReportForMonth(resolved.admin, query.projectId, query.month)
      return { status: 200, json: { report } }
    } catch (err) {
      return {
        status: 500,
        json: {
          error: 'Could not load flow report',
          detail: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  const projectIds = parseProjectIds(query.projectIds)
  if (projectIds.length === 0) {
    return {
      status: 400,
      json: { error: 'Either "projectIds", or "projectId" + "month", is required' },
    }
  }

  if (query.availableMonths) {
    try {
      const months = await getAvailableFlowReportMonths(resolved.admin, projectIds)
      return { status: 200, json: { months } }
    } catch (err) {
      return {
        status: 500,
        json: {
          error: 'Could not load available months',
          detail: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  try {
    const reports = query.month
      ? await getFlowReportsForMonth(resolved.admin, projectIds, query.month)
      : await getDefaultPeriodFlowReportsForProjects(resolved.admin, projectIds)
    return { status: 200, json: { reports } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not load flow reports',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

function parseFlowReportBody(
  body: unknown,
):
  | {
      projectId: string
      month: string
      answers: FlowReportAnswers
      marginFadeNotes: string | null
      underbilledNotes: string | null
      attn: string | null
      company: string | null
      budget: Partial<FlowBudgetChecklist>
    }
  | { error: ApiResult } {
  const raw = (body ?? {}) as {
    projectId?: unknown
    month?: unknown
    answers?: unknown
    marginFadeNotes?: unknown
    underbilledNotes?: unknown
    attn?: unknown
    company?: unknown
    budget?: unknown
  }
  if (typeof raw.projectId !== 'string' || typeof raw.month !== 'string') {
    return {
      error: {
        status: 400,
        json: { error: '"projectId" and "month" (string) are required' },
      },
    }
  }
  if (raw.answers !== undefined && (typeof raw.answers !== 'object' || raw.answers === null)) {
    return { error: { status: 400, json: { error: '"answers" must be an object' } } }
  }
  if (
    raw.marginFadeNotes !== undefined &&
    raw.marginFadeNotes !== null &&
    typeof raw.marginFadeNotes !== 'string'
  ) {
    return { error: { status: 400, json: { error: '"marginFadeNotes" must be a string or null' } } }
  }
  if (
    raw.underbilledNotes !== undefined &&
    raw.underbilledNotes !== null &&
    typeof raw.underbilledNotes !== 'string'
  ) {
    return { error: { status: 400, json: { error: '"underbilledNotes" must be a string or null' } } }
  }
  if (raw.attn !== undefined && raw.attn !== null && typeof raw.attn !== 'string') {
    return { error: { status: 400, json: { error: '"attn" must be a string or null' } } }
  }
  if (raw.company !== undefined && raw.company !== null && typeof raw.company !== 'string') {
    return { error: { status: 400, json: { error: '"company" must be a string or null' } } }
  }

  // Optional: only the boxes present are written, so an older client that doesn't send `budget`
  // can't wipe a month's ticks.
  const budget: Partial<FlowBudgetChecklist> = {}
  if (raw.budget !== undefined) {
    if (typeof raw.budget !== 'object' || raw.budget === null) {
      return { error: { status: 400, json: { error: '"budget" must be an object of booleans' } } }
    }
    for (const { key } of FLOW_BUDGET_ITEMS) {
      const value = (raw.budget as Record<string, unknown>)[key]
      if (value === undefined) continue
      if (typeof value !== 'boolean') {
        return { error: { status: 400, json: { error: `"budget.${key}" must be a boolean` } } }
      }
      budget[key] = value
    }
  }

  return {
    projectId: raw.projectId,
    month: raw.month,
    answers: (raw.answers ?? {}) as FlowReportAnswers,
    marginFadeNotes: (raw.marginFadeNotes ?? null) as string | null,
    underbilledNotes: (raw.underbilledNotes ?? null) as string | null,
    attn: (raw.attn ?? null) as string | null,
    company: (raw.company ?? null) as string | null,
    budget,
  }
}

/** The 'save' action of POST /api/flow-reports — draft save, never reverts a completed report. */
async function handleFlowReportsSave(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const parsed = parseFlowReportBody(body)
  if ('error' in parsed) return parsed.error

  try {
    const report = await saveFlowReportDraft(
      resolved.admin,
      parsed.projectId,
      parsed.month,
      parsed.answers,
      parsed.marginFadeNotes,
      parsed.underbilledNotes,
      parsed.attn,
      parsed.company,
      parsed.budget,
    )
    return { status: 200, json: { report } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not save flow report',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/** The 'submit' action of POST /api/flow-reports — marks the report completed. */
async function handleFlowReportsSubmit(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const parsed = parseFlowReportBody(body)
  if ('error' in parsed) return parsed.error

  try {
    const report = await submitFlowReport(
      resolved.admin,
      parsed.projectId,
      parsed.month,
      parsed.answers,
      parsed.marginFadeNotes,
      parsed.underbilledNotes,
      parsed.attn,
      parsed.company,
      parsed.budget,
      resolved.profileId,
    )
    return { status: 200, json: { report } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not submit flow report',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/** The 'export-pdf' action of POST /api/flow-reports — body { month, projectIds }. */
async function handleFlowReportsExportPdf(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const raw = (body ?? {}) as { month?: unknown; projectIds?: unknown }
  if (typeof raw.month !== 'string') {
    return { status: 400, json: { error: '"month" (string) is required' } }
  }
  if (!Array.isArray(raw.projectIds) || raw.projectIds.some((id) => typeof id !== 'string')) {
    return { status: 400, json: { error: '"projectIds" (string array) is required' } }
  }
  const projectIds = raw.projectIds as string[]
  if (projectIds.length === 0) {
    return { status: 400, json: { error: '"projectIds" must not be empty' } }
  }

  try {
    const pdf = await generateFlowReportPdf(resolved.admin, projectIds, raw.month, resolved.profileId)
    return binary(pdf, 'application/pdf', `FLOW Report ${raw.month}.pdf`)
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not generate PDF',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/**
 * POST /api/flow-reports — action dispatch: { action: 'save' | 'submit' | 'export-pdf', ... }.
 * See the Hobby-plan function-count note in vercelAdapter.ts.
 */
export async function handleFlowReportsPost(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const { action } = (body ?? {}) as { action?: unknown }
  switch (action) {
    case 'save':
      return handleFlowReportsSave(authorizationHeader, body)
    case 'submit':
      return handleFlowReportsSubmit(authorizationHeader, body)
    case 'export-pdf':
      return handleFlowReportsExportPdf(authorizationHeader, body)
    default:
      return { status: 400, json: { error: '"action" must be "save", "submit", or "export-pdf"' } }
  }
}
