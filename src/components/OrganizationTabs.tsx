import { NavLink, useLocation } from 'react-router-dom'
import { useProfile } from '../contexts/ProfileContext'

const PM_TABS = [
  { to: '/organization/tasks', label: 'Tasks' },
  { to: '/organization/flow', label: 'FLOW' },
  { to: '/organization/overview', label: 'Overview' },
  { to: '/organization/procurement', label: 'Procurement' },
]

// Service users: Available Projects replaces FLOW, and there is no Procurement tab.
const SERVICE_TABS = [
  { to: '/organization/tasks', label: 'Tasks' },
  { to: '/organization/available', label: 'Available Projects' },
  { to: '/organization/overview', label: 'Overview' },
]

/**
 * Secondary nav row: the Tasks / FLOW / Overview / Procurement tabs (Tasks / Available Projects / Overview for a
 * Service user) exist only under
 * Organization — on any other section (Tools, ...) this renders nothing.
 */
export function OrganizationTabs() {
  const { pathname } = useLocation()
  const { profile } = useProfile()
  const TABS = profile?.title === 'service' ? SERVICE_TABS : PM_TABS
  if (!pathname.startsWith('/organization')) return null

  return (
    <nav className="flex shrink-0 justify-center gap-2 border-b border-legacy-blue-light/15 bg-white py-2">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            `rounded-full px-4 py-1.5 text-sm font-medium transition ${
              isActive
                ? 'bg-legacy-blue-dark text-white'
                : 'text-legacy-blue-dark hover:bg-legacy-blue-light/10'
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
