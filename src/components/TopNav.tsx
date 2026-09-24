import { NavLink } from 'react-router-dom'

/**
 * project-organization branch only: the Tools grid isn't part of this demo,
 * so its nav button is hidden (not removed) until this branch merges with
 * the tools work happening on main. Flip back to true to restore it.
 */
const SHOW_TOOLS_TAB = false

const NAV_ITEMS = [
  { to: '/organization', label: 'Organization' },
  ...(SHOW_TOOLS_TAB ? [{ to: '/tools', label: 'Tools' }] : []),
]

/**
 * Section switcher between the Organization dashboard and the Tools grid.
 * Sits below the main header, alongside it — not a replacement for
 * ProfileMenu/auth chrome, which AppShell still owns untouched.
 */
export function TopNav() {
  return (
    <nav className="flex shrink-0 justify-center gap-2 border-b border-legacy-blue-light/15 bg-white py-2">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `rounded-full px-4 py-1.5 text-sm font-medium transition ${
              isActive
                ? 'bg-legacy-blue-dark text-white'
                : 'text-legacy-blue-dark hover:bg-legacy-blue-light/10'
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
