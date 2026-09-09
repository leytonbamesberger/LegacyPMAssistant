import { useEffect, useRef, useState } from 'react'
import { useMsal } from '@azure/msal-react'

/**
 * Top-right profile element for the Home header: circular avatar placeholder +
 * display name from the Microsoft account, with a dropdown.
 *
 * Dropdown items for this pass:
 * - "Connect Procore" — disabled placeholder, no-op (wired up later).
 * - "Sign out" — MSAL logout redirect.
 */
export function ProfileMenu() {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const displayName = account?.name ?? account?.username ?? 'Account'
  const initials = getInitials(displayName)

  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function signOut() {
    void instance.logoutRedirect({ postLogoutRedirectUri: '/login' })
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-white transition hover:bg-white/10"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-xs font-semibold">
          {initials}
        </span>
        <span className="hidden text-sm font-medium sm:block">{displayName}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-2 w-56 overflow-hidden rounded-lg border border-legacy-blue-light/20 bg-white py-1 shadow-lg"
        >
          <div className="border-b border-legacy-blue-light/15 px-3 py-2">
            <p className="truncate text-sm font-medium text-legacy-blue-dark">
              {displayName}
            </p>
            {account?.username && (
              <p className="truncate text-xs text-legacy-blue-light">
                {account.username}
              </p>
            )}
          </div>

          <button
            type="button"
            disabled
            title="Procore connection will be enabled in a later step."
            className="flex w-full cursor-not-allowed items-center justify-between px-3 py-2 text-sm text-legacy-blue-light/60"
            role="menuitem"
          >
            Connect Procore
            <span className="text-[10px] uppercase tracking-wide">Soon</span>
          </button>

          <button
            type="button"
            onClick={signOut}
            className="w-full px-3 py-2 text-left text-sm text-legacy-blue-dark transition hover:bg-legacy-blue-light/10"
            role="menuitem"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
