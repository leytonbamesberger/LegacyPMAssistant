import { NavLink } from 'react-router-dom'
import { SHOW_TOOLS_TAB } from '../lib/features'

const NAV_ITEMS = [
  { to: '/organization', label: 'Organization' },
  ...(SHOW_TOOLS_TAB ? [{ to: '/tools', label: 'Tools' }] : []),
]

/**
 * Top-level section switcher, living in the blue header itself. NavLink's
 * default prefix matching keeps "Organization" highlighted on every
 * /organization/* tab.
 */
export function HeaderNav() {
  return (
    <nav className="flex items-center gap-1">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
