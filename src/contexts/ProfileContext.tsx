import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
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
  setTitle: (title: 'pm' | 'apm') => Promise<void>
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

  useEffect(() => {
    if (!account) return
    let cancelled = false

    void (async () => {
      setLoading(true)
      const [ownProfile, dir] = await Promise.all([
        ensureProfile(instance, account),
        fetchProfileDirectory(instance, account),
      ])
      if (cancelled) return
      setProfile(ownProfile)
      setDirectory(dir ?? [])
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [instance, account])

  const setTitle = useCallback(
    async (title: 'pm' | 'apm') => {
      if (!account) return
      const updated = await updateProfileTitle(instance, account, title)
      if (updated) {
        setProfile(updated)
        setDirectory((prev) =>
          prev.map((p) => (p.id === updated.id ? { ...p, title: updated.title } : p)),
        )
      }
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
    () => ({ profile, directory, loading, setTitle, nameFor }),
    [profile, directory, loading, setTitle, nameFor],
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
