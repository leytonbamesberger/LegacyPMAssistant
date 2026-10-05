import { useState } from 'react'
import type { ReactNode } from 'react'
import { CalendarIcon } from './icons'
import { CalendarPanel } from './CalendarPanel'
import { HeaderNav } from './HeaderNav'
import { OrganizationTabs } from './OrganizationTabs'
import { ProfileMenu } from './ProfileMenu'
import { Sidebar } from './Sidebar'
import { UnsavedWorkGuardModal } from './UnsavedWorkGuardModal'

/**
 * Shared chrome for every protected page: header + project sidebar. Rendered
 * once by `ProtectedRoute`, so `Home` and every future tool page just render
 * their own content into it.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [calendarOpen, setCalendarOpen] = useState(false)

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* Fixed h-16 (not py-4-driven) so the slide-out panels can offset below it with a
          matching top-16 — the header stays visible/clickable while a panel is open. */}
      <header className="z-30 h-16 shrink-0 bg-legacy-blue-dark">
        <div className="flex h-full items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <span className="text-lg font-semibold tracking-tight text-white">
              Legacy PM Assistant
            </span>
            <HeaderNav />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCalendarOpen((v) => !v)}
              title="Calendar"
              aria-label="Toggle calendar"
              className="rounded-full p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              <CalendarIcon className="h-5 w-5" />
            </button>
            <ProfileMenu />
          </div>
        </div>
      </header>

      <OrganizationTabs />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      <UnsavedWorkGuardModal />
      <CalendarPanel open={calendarOpen} onClose={() => setCalendarOpen(false)} />
    </div>
  )
}
