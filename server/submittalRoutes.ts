import { ApiResult } from './http.js'
import { resolveProfile } from './auth.js'
import {
  createSubmittalCheck,
  getSubmittalCheck,
  runSubmittalCheck,
} from './submittals.js'

/**
 * POST /api/submittals — body { projectId, filename, csiSection? }
 * Creates the row and returns a scoped Storage upload token; the browser
 * uploads the PDF directly to Storage (see src/lib/submittals.ts), then calls
 * /api/submittals/run.
 */
export async function handleCreateSubmittal(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { projectId, filename, csiSection } = (body ?? {}) as {
    projectId?: unknown
    filename?: unknown
    csiSection?: unknown
  }
  if (typeof projectId !== 'string' || typeof filename !== 'string') {
    return {
      status: 400,
      json: { error: '"projectId" and "filename" (strings) are required' },
    }
  }

  try {
    const result = await createSubmittalCheck(resolved.admin, resolved.profileId, {
      projectId,
      filename,
      csiSection: typeof csiSection === 'string' ? csiSection : undefined,
    })
    return { status: 200, json: result }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not create submittal check',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/**
 * POST /api/submittals/run — body { submittalCheckId, csiSectionOverride?, treatAsSingleSubmittal? }
 * Runs (or continues, with a manually chosen section) the pipeline. Never
 * auto-retries — a failure comes back as `{ kind: 'failed', error }` for the
 * client to offer a manual Retry.
 */
export async function handleRunSubmittal(
  authorizationHeader: string | undefined,
  body: unknown,
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  const { submittalCheckId, csiSectionOverride, treatAsSingleSubmittal } = (body ?? {}) as {
    submittalCheckId?: unknown
    csiSectionOverride?: unknown
    treatAsSingleSubmittal?: unknown
  }
  if (typeof submittalCheckId !== 'string') {
    return { status: 400, json: { error: '"submittalCheckId" (string) is required' } }
  }

  try {
    const result = await runSubmittalCheck(resolved.admin, resolved.profileId, submittalCheckId, {
      csiSectionOverride: typeof csiSectionOverride === 'string' ? csiSectionOverride : undefined,
      treatAsSingleSubmittal: treatAsSingleSubmittal === true,
    })
    return { status: 200, json: result }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Submittal check run failed unexpectedly',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/** GET /api/submittals/get?id=X */
export async function handleGetSubmittal(
  authorizationHeader: string | undefined,
  query: { id?: string },
): Promise<ApiResult> {
  const resolved = await resolveProfile(authorizationHeader)
  if ('error' in resolved) return resolved.error

  if (!query.id) {
    return { status: 400, json: { error: '"id" query param is required' } }
  }

  try {
    const check = await getSubmittalCheck(resolved.admin, query.id)
    if (!check) return { status: 404, json: { error: 'Not found' } }
    return { status: 200, json: { check } }
  } catch (err) {
    return {
      status: 500,
      json: {
        error: 'Could not load submittal check',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
}
