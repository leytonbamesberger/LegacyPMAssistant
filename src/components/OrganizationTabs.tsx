import { NavLink, useLocation } from 'react-router-dom'

const TABS = [
  { to: '/organization/tasks', label: 'Tasks' },
  { to: '/organization/flow', label: 'FLOW' },
  { to: '/organization/overview', label: 'Overview' },
]

/**
 * Secondary nav row: the Tasks / FLOW / Overview tabs exist only under
 * Organization — on any other section (Tools, ...) this renders nothing.
 */
export function OrganizationTabs() {
  const { pathname } = useLocation()
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
