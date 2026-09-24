import { useEffect, useRef, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { ProcoreConnectionItem } from './ProcoreConnectionItem'
import { useProfile } from '../contexts/ProfileContext'

/**
 * Top-right profile element for the Home header: circular avatar placeholder +
 * display name from the Microsoft account, with a dropdown.
 *
 * Dropdown items:
 * - Procore connection (connect / disconnect / unavailable) — see
 *   `ProcoreConnectionItem`.
 * - "Sign out" — MSAL logout redirect.
 */
export function ProfileMenu() {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const displayName = account?.name ?? account?.username ?? 'Account'
  const initials = getInitials(displayName)
  const { profile, setTitle } = useProfile()
  const needsTitle = profile !== null && profile.title === null

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
        <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-xs font-semibold">
          {initials}
          {needsTitle && (
            <span
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-legacy-red ring-2 ring-legacy-blue-dark"
              aria-hidden
            />
          )}
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

          <RoleMenuItem title={profile?.title ?? null} onSetTitle={setTitle} />

          <ProcoreConnectionItem />

          <div className="my-1 border-t border-legacy-blue-light/15" />

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

const TITLE_LABEL: Record<'pm' | 'apm', string> = {
  pm: 'Project Manager',
  apm: 'Assistant PM',
}

/**
 * Self-reported role, used only to feed the star -> auto-assign logic on
 * projects (see supabase/schema.sql) — not a permission tier. Required on
 * first login (shown highlighted, un-dismissable until set); editable at any
 * time afterward via the same two buttons.
 */
function RoleMenuItem({
  title,
  onSetTitle,
}: {
  title: 'pm' | 'apm' | null
  onSetTitle: (title: 'pm' | 'apm') => Promise<void>
}) {
  const [saving, setSaving] = useState(false)

  async function pick(next: 'pm' | 'apm') {
    if (next === title || saving) return
    setSaving(true)
    await onSetTitle(next)
    setSaving(false)
  }

  return (
    <div
      className={`px-3 py-2 ${title === null ? 'bg-legacy-red/5' : ''}`}
      role="menuitem"
    >
      <p className="mb-1.5 text-xs font-medium text-legacy-blue-light">
        {title === null ? 'Set your role to continue' : 'Your role'}
      </p>
      <div className="flex gap-1.5">
        {(['pm', 'apm'] as const).map((option) => (
          <button
            key={option}
            type="button"
            disabled={saving}
            onClick={() => void pick(option)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 ${
              title === option
                ? 'bg-legacy-blue-dark text-white'
                : 'border border-legacy-blue-light/30 text-legacy-blue-dark hover:border-legacy-blue-dark'
            }`}
          >
            {TITLE_LABEL[option]}
          </button>
        ))}
      </div>
    </div>
  )
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
