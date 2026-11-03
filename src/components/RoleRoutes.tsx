import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useProfile } from '../contexts/ProfileContext'

/** Route guards by role (a user's role is always set by the time a page renders — see RoleGate). */

/** FLOW, its export page and Procurement are not for Service users: a direct URL lands on Tasks. */
export function HideFromService({ children }: { children: ReactNode }) {
  const { profile } = useProfile()
  if (profile?.title === 'service') return <Navigate to="/organization/tasks" replace />
  return <>{children}</>
}

/** Available Projects is for Service users only; PM and APM users never see it. */
export function ServiceOnly({ children }: { children: ReactNode }) {
  const { profile } = useProfile()
  if (profile && profile.title !== 'service') return <Navigate to="/organization/tasks" replace />
  return <>{children}</>
}
