import { ApiResult } from './http.js'
import { resolveProfile } from './auth.js'
import {
  getCurrentFlowReportsForProjects,
  saveFlowReportDraft,
  submitFlowReport,
  type FlowReportAnswers,
} from './flowReports.js'

/** GET /api/flow-reports?projectIds=a,b,c — this month's report status for each project. */
export async function handleFlowReportsList(
  authorizationHeader: string | undefined,
  query: { projectIds?: string },
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const projectIds = (query.projectIds ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  if (projectIds.length === 0) {
    return { status: 400, json: { error: '"projectIds" query param is required' } }
  }

  try {
    const reports = await getCurrentFlowReportsForProjects(resolved.admin, projectIds)
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
  | { projectId: string; month: string; answers: FlowReportAnswers; dueDate: string | null }
  | { error: ApiResult } {
  const raw = (body ?? {}) as {
    projectId?: unknown
    month?: unknown
    answers?: unknown
    dueDate?: unknown
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
  if (raw.dueDate !== undefined && raw.dueDate !== null && typeof raw.dueDate !== 'string') {
    return { error: { status: 400, json: { error: '"dueDate" must be a string or null' } } }
  }

  return {
    projectId: raw.projectId,
    month: raw.month,
    answers: (raw.answers ?? {}) as FlowReportAnswers,
    dueDate: (raw.dueDate ?? null) as string | null,
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
      parsed.dueDate,
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
      parsed.dueDate,
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

/**
 * POST /api/flow-reports — action dispatch: { action: 'save' | 'submit', ... }.
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
    default:
      return { status: 400, json: { error: '"action" must be "save" or "submit"' } }
  }
}
