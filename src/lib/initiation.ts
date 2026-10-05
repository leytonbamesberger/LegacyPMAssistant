import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch, getIdToken } from './apiClient'
import type { CadenceUnit } from '../../shared/period'

export interface InitiationCatalogItem {
  id: string
  phase: 'setup' | 'recurring'
  name: string
  sort_order: number
  cadence_days: number | null
  cadence_type: 'rolling' | 'calendar_month' | null
  /** The four meeting Setup items, which may be left TBD. */
  is_meeting: boolean
  /** null = shared default; set = this project's own custom item. */
  project_id: string | null
  /** This project previously hid this shared default. */
  excluded: boolean
}

export interface InitiationCatalog {
  items: InitiationCatalogItem[]
  pm_id: string | null
  apm_id: string | null
  initiated: boolean
}

/** A wizard row: an existing catalog item (`itemId`) or a brand-new custom one (`newName`). */
interface ItemRef {
  itemId: string | null
  newName: string | null
}

export interface SetupSelection extends ItemRef {
  isComplete: boolean
  /** The project's "Setup complete by" date: every setup task's due date, meetings included. */
  dueDate: string | null
  /** Meetings only: the date held/scheduled. A date completes the task. */
  meetingDate: string | null
  /** Meetings only: date still to be decided. */
  isTbd: boolean
}

export interface RecurringSelection extends ItemRef {
  startDate: string | null
  timeOfDay: string | null
  cadenceValue: number | null
  cadenceUnit: CadenceUnit | null
}

export interface InitiationPayload {
  projectId: string
  pmId: string | null
  apmId: string | null
  setup: SetupSelection[]
  recurring: RecurringSelection[]
}

export async function fetchInitiationCatalog(
  instance: IPublicClientApplication,
  account: AccountInfo,
  projectId: string,
): Promise<InitiationCatalog | null> {
  return apiFetch<InitiationCatalog>(
    instance,
    account,
    `/api/projects?initiationCatalogFor=${encodeURIComponent(projectId)}`,
  )
}

/**
 * Submits the finished wizard. Unlike most calls this surfaces the server's
 * rejection reason (e.g. "already initiated") so the wizard can show it,
 * instead of collapsing every failure to null.
 */
export async function initiateProject(
  instance: IPublicClientApplication,
  account: AccountInfo,
  payload: InitiationPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const idToken = await getIdToken(instance, account)
  if (!idToken) return { ok: false, error: 'Could not verify your sign-in — try again' }

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ action: 'initiate', ...payload }),
    })
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null
    const message = body?.error ?? `Request failed (${res.status})`
    // Server faults carry the database's own message in `detail` — show it so a failure is diagnosable.
    return { ok: false, error: body?.detail ? `${message} (${body.detail})` : message }
  } catch {
    return { ok: false, error: 'Network error — try again' }
  }
}
