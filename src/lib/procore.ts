import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'
import { apiFetch } from './apiClient'

export interface ProcoreStatus {
  /** Server has Procore OAuth credentials set. */
  configured: boolean
  /** This user has a stored Procore token. */
  connected: boolean
  connectedAt: string | null
  expiresAt: string | null
  /** Present only when `configured` is false — names of missing server env vars. */
  missingVars?: string[]
}

export async function getProcoreStatus(
  instance: IPublicClientApplication,
  account: AccountInfo,
): Promise<ProcoreStatus | null> {
  return apiFetch<ProcoreStatus>(instance, account, '/api/procore/status')
}

/**
 * Begin the Procore OAuth connect flow: ask the server for the consent URL
 * (which carries a signed `state`), then hand the browser off to Procore.
 * Procore redirects back to `/api/procore/callback`, which stores the tokens
 * and returns the user to `/home?procore=connected`.
 */
export async function startProcoreConnect(
  instance: IPublicClientApplication,
  account: AccountInfo,
): Promise<void> {
  const body = await apiFetch<{ url: string }>(
    instance,
    account,
    '/api/procore/authorize',
    { method: 'POST' },
  )
  if (body?.url) {
    window.location.href = body.url
  }
}

export async function disconnectProcore(
  instance: IPublicClientApplication,
  account: AccountInfo,
): Promise<boolean> {
  const body = await apiFetch<{ connected: boolean }>(
    instance,
    account,
    '/api/procore/disconnect',
    { method: 'POST' },
  )
  return body !== null && body.connected === false
}
