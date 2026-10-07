import { useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { startProcoreConnect } from '../lib/procore'
import { useProcore } from '../contexts/ProcoreContext'

/**
 * The centered first-run message for the Tasks, FLOW and Overview tabs, shown in place of their empty
 * content while the user has no Added projects:
 * - not connected to Procore: "Sign in to Procore to get started" + the same OAuth flow as the
 *   profile menu's Connect Procore;
 * - connected: "Add a project from the Projects list to get started."
 *
 * Only ever rendered after the first-load gate, so Procore's state is known by then. Once a project is
 * Added the pages stop rendering this, whatever happens to the connection afterward.
 */
export function ProcoreEmptyState() {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { status } = useProcore()
  const [busy, setBusy] = useState(false)

  async function connect() {
    if (!account || busy) return
    setBusy(true)
    await startProcoreConnect(instance, account) // navigates away on success
    setBusy(false)
  }

  if (status?.connected) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center px-4 py-12 text-center">
        <p className="text-base text-legacy-blue-dark">Add a project from the Projects list to get started.</p>
      </div>
    )
  }

  const unavailable = !status?.configured
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <h2 className="text-lg font-semibold text-legacy-blue-dark">Sign in to Procore to get started</h2>
      <p className="max-w-md text-sm text-legacy-blue-light">
        Connect your Procore account, then add your projects from the Projects list on the left.
      </p>
      <button
        type="button"
        onClick={() => void connect()}
        disabled={busy || unavailable}
        title={unavailable ? 'Procore sign-in isn’t set up on the server yet.' : undefined}
        className="mt-1 rounded-full bg-legacy-blue-dark px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Opening Procore…' : 'Sign in to Procore'}
      </button>
    </div>
  )
}
