import { useState } from 'react'
import { useMsal, useIsAuthenticated } from '@azure/msal-react'
import { InteractionStatus, BrowserAuthError } from '@azure/msal-browser'
import { Navigate } from 'react-router-dom'
import { loginRequest } from '../lib/msalConfig'

export function Login() {
  const { instance, inProgress } = useMsal()
  const isAuthenticated = useIsAuthenticated()
  const [error, setError] = useState<string | null>(null)

  if (isAuthenticated) {
    return <Navigate to="/home" replace />
  }

  const busy = inProgress !== InteractionStatus.None

  async function signIn() {
    setError(null)
    try {
      await instance.loginRedirect(loginRequest)
    } catch (err) {
      // A previous redirect that never finished leaves this flag set; clearing
      // MSAL's cache lets the user retry without closing the tab.
      if (
        err instanceof BrowserAuthError &&
        err.errorCode === 'interaction_in_progress'
      ) {
        await instance.clearCache()
        setError('Previous sign-in didn’t finish. Please click Sign in again.')
        return
      }
      console.error('[login] loginRedirect failed:', err)
      setError('Could not start sign-in. Check the console for details.')
    }
  }

  return (
    <main className="flex min-h-full flex-col items-center justify-center bg-white px-4">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-legacy-blue-dark">
        Legacy PM Assistant
      </h1>

      <div className="w-full max-w-sm rounded-xl border border-legacy-blue-light/20 p-8">
        <button
          type="button"
          onClick={signIn}
          disabled={busy}
          className="w-full rounded-md bg-legacy-blue-dark px-4 py-2.5 text-sm font-medium text-white transition hover:bg-legacy-blue-dark/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in with Microsoft'}
        </button>
        <p className="mt-3 text-center text-xs text-legacy-blue-light">
          Use your Legacy Mechanical Microsoft account.
        </p>
        {error && (
          <p className="mt-3 text-center text-xs text-legacy-red">{error}</p>
        )}
      </div>
    </main>
  )
}
