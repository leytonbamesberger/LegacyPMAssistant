import type { ReactNode } from 'react'
import { ProfileMenu } from './ProfileMenu'
import { Sidebar } from './Sidebar'
import { UnsavedWorkGuardModal } from './UnsavedWorkGuardModal'

/**
 * Shared chrome for every protected page: header + project sidebar. Rendered
 * once by `ProtectedRoute`, so `Home` and every future tool page just render
 * their own content into it.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="shrink-0 bg-legacy-blue-dark">
        <div className="flex items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold tracking-tight text-white">
            Legacy PM Assistant
          </span>
          <ProfileMenu />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      <UnsavedWorkGuardModal />
    </div>
  )
}
