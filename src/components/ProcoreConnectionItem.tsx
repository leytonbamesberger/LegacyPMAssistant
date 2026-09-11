import { useCallback, useEffect, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import {
  disconnectProcore,
  getProcoreStatus,
  startProcoreConnect,
  type ProcoreStatus,
} from '../lib/procore'

/**
 * Procore connection row inside the profile dropdown. Shows one of:
 * - unavailable (server has no Procore credentials)
 * - "Connect Procore" (starts the OAuth flow)
 * - "Procore connected" + "Disconnect"
 */
export function ProcoreConnectionItem() {
  const { instance, accounts } = useMsal()
  const account = accounts[0]

  const [status, setStatus] = useState<ProcoreStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!account) {
      setLoading(false)
      return
    }
    setLoading(true)
    setStatus(await getProcoreStatus(instance, account))
    setLoading(false)
  }, [instance, account])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function connect() {
    if (!account) return
    setBusy(true)
    await startProcoreConnect(instance, account) // navigates away on success
    setBusy(false)
  }

  async function disconnect() {
    if (!account) return
    setBusy(true)
    const ok = await disconnectProcore(instance, account)
    setBusy(false)
    if (ok) await refresh()
  }

  if (loading) {
    return <Row muted>Checking Procore…</Row>
  }

  if (!status || !status.configured) {
    // These are two different failures — don't collapse them into one message.
    // "Could not check" means the /api/procore/status call itself never got a
    // real response back (see the console for the [api] log with the reason).
    // "Missing on the server" means the call succeeded and named the gap.
    const missing = status?.missingVars
    const title = !status
      ? 'Could not check Procore status — see the browser console for [api] errors.'
      : missing?.length
        ? `Missing on the server: ${missing.join(', ')}`
        : 'Server says Procore is unconfigured but did not say why — check /api/procore/status directly.'
    return (
      <Row muted title={title}>
        <span>Connect Procore</span>
        <span className="text-[10px] uppercase tracking-wide">
          {!status ? 'Check failed' : 'Unavailable'}
        </span>
      </Row>
    )
  }

  if (status.connected) {
    return (
      <div className="px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm text-legacy-blue-dark">
          <span
            className="h-1.5 w-1.5 rounded-full bg-legacy-blue-dark"
            aria-hidden
          />
          Procore connected
        </p>
        <button
          type="button"
          onClick={disconnect}
          disabled={busy}
          className="mt-0.5 text-xs text-legacy-red hover:underline disabled:opacity-60"
        >
          {busy ? 'Disconnecting…' : 'Disconnect'}
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={connect}
      disabled={busy}
      role="menuitem"
      className="w-full px-3 py-2 text-left text-sm text-legacy-blue-dark transition hover:bg-legacy-blue-light/10 disabled:opacity-60"
    >
      {busy ? 'Opening Procore…' : 'Connect Procore'}
    </button>
  )
}

function Row({
  children,
  muted,
  title,
}: {
  children: React.ReactNode
  muted?: boolean
  title?: string
}) {
  return (
    <div
      title={title}
      className={`flex w-full items-center justify-between px-3 py-2 text-sm ${
        muted ? 'text-legacy-blue-light/60' : 'text-legacy-blue-dark'
      }`}
    >
      {children}
    </div>
  )
}
