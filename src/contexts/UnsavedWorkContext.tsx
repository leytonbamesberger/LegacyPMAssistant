import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

interface UnsavedWorkContextValue {
  hasUnsavedWork: boolean
  /** Short label for what would be lost, e.g. "submittal check in progress". */
  description: string | null
  setUnsavedWork: (hasWork: boolean, description?: string) => void
}

const UnsavedWorkContext = createContext<UnsavedWorkContextValue | null>(null)

/**
 * Lets any tool register "I have work in progress that isn't saved yet".
 * Nothing sets this today — it exists so `ProjectContext` can guard project
 * switches against it once a tool starts using it.
 */
export function UnsavedWorkProvider({ children }: { children: ReactNode }) {
  const [hasUnsavedWork, setHasUnsavedWork] = useState(false)
  const [description, setDescription] = useState<string | null>(null)

  const setUnsavedWork = useCallback((hasWork: boolean, desc?: string) => {
    setHasUnsavedWork(hasWork)
    setDescription(hasWork ? (desc ?? null) : null)
  }, [])

  const value = useMemo(
    () => ({ hasUnsavedWork, description, setUnsavedWork }),
    [hasUnsavedWork, description, setUnsavedWork],
  )

  return (
    <UnsavedWorkContext.Provider value={value}>
      {children}
    </UnsavedWorkContext.Provider>
  )
}

export function useUnsavedWork(): UnsavedWorkContextValue {
  const ctx = useContext(UnsavedWorkContext)
  if (!ctx) {
    throw new Error('useUnsavedWork must be used within an UnsavedWorkProvider')
  }
  return ctx
}
