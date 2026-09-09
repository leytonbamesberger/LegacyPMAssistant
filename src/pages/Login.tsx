import { useMsal, useIsAuthenticated } from '@azure/msal-react'
import { Navigate } from 'react-router-dom'
import { loginRequest } from '../lib/msalConfig'

export function Login() {
  const { instance } = useMsal()
  const isAuthenticated = useIsAuthenticated()

  if (isAuthenticated) {
    return <Navigate to="/home" replace />
  }

  function signIn() {
    void instance.loginRedirect(loginRequest)
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
          className="w-full rounded-md bg-legacy-blue-dark px-4 py-2.5 text-sm font-medium text-white transition hover:bg-legacy-blue-dark/90"
        >
          Sign in with Microsoft
        </button>
        <p className="mt-3 text-center text-xs text-legacy-blue-light">
          Use your Legacy Mechanical Microsoft account.
        </p>
      </div>
    </main>
  )
}
