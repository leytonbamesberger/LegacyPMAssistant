import { useIsAuthenticated } from '@azure/msal-react'
import { useMsal } from '@azure/msal-react'
import { InteractionStatus } from '@azure/msal-browser'
import { Navigate, Outlet } from 'react-router-dom'
import { UnsavedWorkProvider } from '../contexts/UnsavedWorkContext'
import { ProfileProvider } from '../contexts/ProfileContext'
import { ProjectProvider } from '../contexts/ProjectContext'
import { FlowReportProvider } from '../contexts/FlowReportContext'
import { AppReadyProvider } from '../contexts/AppReadyContext'
import { ProcoreProvider } from '../contexts/ProcoreContext'
import { AppShell } from './AppShell'
import { RoleGate } from './RoleGate'

/**
 * Gate for authenticated-only routes. Redirects to /login when there is no
 * active Microsoft session. Waits for MSAL to finish any in-flight redirect
 * handling before deciding, so we don't bounce the user mid-login.
 *
 * Used as a layout route (pages render through <Outlet />), so the providers
 * below mount ONCE and survive navigation between protected pages — the
 * first-load gate (AppReadyProvider) therefore only ever shows on the initial load.
 *
 * Once authenticated, wraps the page in the shared project/flow-report
 * contexts and the `AppShell` chrome (header + sidebar) — every protected
 * route gets this for free. `FlowReportProvider` lives here (not inside a
 * single page) so every entry point (Tasks page, calendar) opens the same
 * flow report modal and sees the same status.
 */
export function ProtectedRoute() {
  const isAuthenticated = useIsAuthenticated()
  const { inProgress } = useMsal()

  if (inProgress !== InteractionStatus.None && !isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-legacy-blue-light">
        Signing in…
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return (
    <UnsavedWorkProvider>
      <ProfileProvider>
        <ProjectProvider>
          <FlowReportProvider>
            <ProcoreProvider>
              <AppReadyProvider>
                <RoleGate>
                  <AppShell>
                    <Outlet />
                  </AppShell>
                </RoleGate>
              </AppReadyProvider>
            </ProcoreProvider>
          </FlowReportProvider>
        </ProjectProvider>
      </ProfileProvider>
    </UnsavedWorkProvider>
  )
}
