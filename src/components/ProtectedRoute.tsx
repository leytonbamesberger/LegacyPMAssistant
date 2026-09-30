import type { ReactNode } from 'react'
import { useIsAuthenticated } from '@azure/msal-react'
import { useMsal } from '@azure/msal-react'
import { InteractionStatus } from '@azure/msal-browser'
import { Navigate } from 'react-router-dom'
import { UnsavedWorkProvider } from '../contexts/UnsavedWorkContext'
import { ProfileProvider } from '../contexts/ProfileContext'
import { ProjectProvider } from '../contexts/ProjectContext'
import { ChecklistProvider } from '../contexts/ChecklistContext'
import { FlowReportProvider } from '../contexts/FlowReportContext'
import { AppShell } from './AppShell'

/**
 * Gate for authenticated-only routes. Redirects to /login when there is no
 * active Microsoft session. Waits for MSAL to finish any in-flight redirect
 * handling before deciding, so we don't bounce the user mid-login.
 *
 * Once authenticated, wraps the page in the shared project/checklist/flow-report
 * contexts and the `AppShell` chrome (header + sidebar) — every protected
 * route gets this for free. `ChecklistProvider`/`FlowReportProvider` live here
 * (not inside a single page) so the project cards and the header's checklist
 * panel read/write the same starred-project status.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
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
          <ChecklistProvider>
            <FlowReportProvider>
              <AppShell>{children}</AppShell>
            </FlowReportProvider>
          </ChecklistProvider>
        </ProjectProvider>
      </ProfileProvider>
    </UnsavedWorkProvider>
  )
}
