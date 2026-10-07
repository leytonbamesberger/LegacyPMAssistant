import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMsal } from '@azure/msal-react'
import {
  ensureProfile,
  fetchProfileDirectory,
  updateProfileTitle,
  type Profile,
  type ProfileDirectoryEntry,
} from '../lib/profiles'

interface ProfileContextValue {
  /** The signed-in user's own profile row. Null until loaded. */
  profile: Profile | null
  /** Every profile in the company (id/display_name/title), for names + assignment pickers. */
  directory: ProfileDirectoryEntry[]
  loading: boolean
  /** The profile or directory request failed (as opposed to still loading). */
  error: boolean
  /** Re-runs the initial profile + directory load. */
  reload: () => Promise<void>
  /** Saves the caller's role; false if it couldn't be saved. */
  setTitle: (title: 'pm' | 'apm') => Promise<boolean>
  /** display_name for any profile id, falling back to something non-blank. */
  nameFor: (profileId: string | null) => string
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { instance, accounts } = useMsal()
  const account = accounts[0]

  const [profile, setProfile] = useState<Profile | null>(null)
  const [directory, setDirectory] = useState<ProfileDirectoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Only the newest load may write state (a Retry can overlap a slow first attempt).
  const loadId = useRef(0)
  const reload = useCallback(async () => {
    if (!account) return
    const id = ++loadId.current
    setLoading(true)
    setError(false)
    const [ownProfile, dir] = await Promise.all([
      ensureProfile(instance, account),
      fetchProfileDirectory(instance, account),
    ])
    if (id !== loadId.current) return
    setProfile(ownProfile)
    setDirectory(dir ?? [])
    // Either request failing means the app can't render names/assignments correctly.
    setError(ownProfile === null || dir === null)
    setLoading(false)
  }, [instance, account])

  useEffect(() => {
    void reload()
  }, [reload])

  const setTitle = useCallback(
    async (title: 'pm' | 'apm') => {
      if (!account) return false
      const updated = await updateProfileTitle(instance, account, title)
      if (!updated) return false
      setProfile(updated)
      setDirectory((prev) => prev.map((p) => (p.id === updated.id ? { ...p, title: updated.title } : p)))
      return true
    },
    [instance, account],
  )

  const nameFor = useCallback(
    (profileId: string | null) => {
      if (!profileId) return 'Unassigned'
      return directory.find((p) => p.id === profileId)?.display_name ?? 'Unknown'
    },
    [directory],
  )

  const value = useMemo<ProfileContextValue>(
    () => ({ profile, directory, loading, error, reload, setTitle, nameFor }),
    [profile, directory, loading, error, reload, setTitle, nameFor],
  )

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) {
    throw new Error('useProfile must be used within a ProfileProvider')
  }
  return ctx
}
