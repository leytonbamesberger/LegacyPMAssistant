import { useState } from 'react'
import type { ReactNode } from 'react'
import { CalendarIcon, ChecklistPanelIcon } from './icons'
import { CalendarPanel } from './CalendarPanel'
import { ChecklistPanel } from './ChecklistPanel'
import { ProfileMenu } from './ProfileMenu'
import { Sidebar } from './Sidebar'
import { TopNav } from './TopNav'
import { UnsavedWorkGuardModal } from './UnsavedWorkGuardModal'

/**
 * Shared chrome for every protected page: header + project sidebar. Rendered
 * once by `ProtectedRoute`, so `Home` and every future tool page just render
 * their own content into it.
 */
type PanelKind = 'calendar' | 'checklist' | null

export function AppShell({ children }: { children: ReactNode }) {
  // Only one of the two right-side panels at a time — they occupy the same
  // screen space, so opening one while the other is open switches to it
  // instead of stacking on top of it.
  const [activePanel, setActivePanel] = useState<PanelKind>(null)

  function togglePanel(panel: PanelKind) {
    setActivePanel((current) => (current === panel ? null : panel))
  }

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* Fixed h-16 (not py-4-driven) so CalendarPanel/ChecklistPanel can offset below it with a
          matching top-16 — the header stays visible/clickable while either panel is open. */}
      <header className="z-30 h-16 shrink-0 bg-legacy-blue-dark">
        <div className="flex h-full items-center justify-between px-6">
          <span className="text-lg font-semibold tracking-tight text-white">
            Legacy PM Assistant
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => togglePanel('checklist')}
              title="Project Checklist"
              aria-label="Toggle project checklist"
              className="rounded-full p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              <ChecklistPanelIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => togglePanel('calendar')}
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

      <TopNav />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      <UnsavedWorkGuardModal />
      <CalendarPanel open={activePanel === 'calendar'} onClose={() => setActivePanel(null)} />
      <ChecklistPanel open={activePanel === 'checklist'} onClose={() => setActivePanel(null)} />
    </div>
  )
}
