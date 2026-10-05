import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMsal } from '@azure/msal-react'
import { getProcoreStatus, type ProcoreStatus } from '../lib/procore'

interface ProcoreContextValue {
  /** Null while loading, or when the status request itself failed (see `error`). */
  status: ProcoreStatus | null
  loading: boolean
  /** The status request failed — distinct from "Procore isn't configured/connected", which is a successful answer. */
  error: boolean
  refresh: () => Promise<void>
}

const ProcoreContext = createContext<ProcoreContextValue | null>(null)

/** The user's Procore connection state, loaded once for the app shell (the first-load gate waits on it) and shared with the profile menu. */
export function ProcoreProvider({ children }: { children: ReactNode }) {
  const { instance, accounts } = useMsal()
  const account = accounts[0]

  const [status, setStatus] = useState<ProcoreStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const loadId = useRef(0)
  const refresh = useCallback(async () => {
    if (!account) return
    const id = ++loadId.current
    setLoading(true)
    const result = await getProcoreStatus(instance, account)
    if (id !== loadId.current) return
    setStatus(result)
    setError(result === null)
    setLoading(false)
  }, [instance, account])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo(() => ({ status, loading, error, refresh }), [status, loading, error, refresh])
  return <ProcoreContext.Provider value={value}>{children}</ProcoreContext.Provider>
}

export function useProcore(): ProcoreContextValue {
  const ctx = useContext(ProcoreContext)
  if (!ctx) throw new Error('useProcore must be used within a ProcoreProvider')
  return ctx
}
