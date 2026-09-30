import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMsal } from '@azure/msal-react'
import {
  addCustomChecklistItem,
  fetchChecklistStatus,
  logChecklistItem,
  removeChecklistItem,
  setChecklistItemDone,
  setChecklistItemSchedule,
  setSetupItemDate,
  type ProjectChecklistStatus,
} from '../lib/checklist'
import { useProject } from './ProjectContext'

interface ChecklistContextValue {
  checklistByProject: Record<string, ProjectChecklistStatus>
  loading: boolean
  toggleItem: (projectId: string, checklistItemId: string, done: boolean) => Promise<void>
  logItem: (projectId: string, checklistItemId: string) => Promise<void>
  addCustomItem: (
    projectId: string,
    name: string,
    cadenceType: 'rolling' | 'calendar_month',
    cadenceDays: number | null,
  ) => Promise<void>
  removeItem: (projectId: string, checklistItemId: string) => Promise<void>
  setSetupDate: (projectId: string, checklistItemId: string, date: string) => Promise<void>
  setSchedule: (projectId: string, checklistItemId: string, date: string | null) => Promise<void>
}

const ChecklistContext = createContext<ChecklistContextValue | null>(null)

/**
 * Single source of truth for starred-project checklist status, shared by the
 * project cards (ProjectDashboard) and the checklist panel (ChecklistPanel) —
 * both read/write through here so a change in one shows up in the other
 * without a page reload.
 */
export function ChecklistProvider({ children }: { children: ReactNode }) {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { projects } = useProject()

  const starredIds = useMemo(() => projects.filter((p) => p.isStarred).map((p) => p.id), [projects])
  const starredIdsKey = starredIds.join(',')

  const [checklistByProject, setChecklistByProject] = useState<Record<string, ProjectChecklistStatus>>({})
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!account || starredIds.length === 0) {
      setChecklistByProject({})
      setLoading(false)
      return
    }
    setLoading(true)
    const statuses = await fetchChecklistStatus(instance, account, starredIds)
    if (statuses) {
      setChecklistByProject(Object.fromEntries(statuses.map((s) => [s.projectId, s])))
    }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, account, starredIdsKey])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggleItem = useCallback(
    async (projectId: string, checklistItemId: string, done: boolean) => {
      if (!account) return
      // Optimistic update.
      setChecklistByProject((prev) => {
        const status = prev[projectId]
        if (!status) return prev
        const patchPhase = (items: ProjectChecklistStatus['setup']) =>
          items.map((s) =>
            s.item.id === checklistItemId
              ? { ...s, done, completedAt: done ? new Date().toISOString() : null }
              : s,
          )
        return {
          ...prev,
          [projectId]: {
            ...status,
            setup: patchPhase(status.setup),
            closeout: patchPhase(status.closeout),
          },
        }
      })
      const ok = await setChecklistItemDone(instance, account, projectId, checklistItemId, done)
      if (!ok) void refresh()
    },
    [instance, account, refresh],
  )

  const logItem = useCallback(
    async (projectId: string, checklistItemId: string) => {
      if (!account) return
      const ok = await logChecklistItem(instance, account, projectId, checklistItemId)
      if (ok) void refresh()
    },
    [instance, account, refresh],
  )

  const addCustomItem = useCallback(
    async (
      projectId: string,
      name: string,
      cadenceType: 'rolling' | 'calendar_month',
      cadenceDays: number | null,
    ) => {
      if (!account) return
      const ok = await addCustomChecklistItem(instance, account, projectId, name, cadenceType, cadenceDays)
      if (ok) void refresh()
    },
    [instance, account, refresh],
  )

  const removeItem = useCallback(
    async (projectId: string, checklistItemId: string) => {
      if (!account) return
      const ok = await removeChecklistItem(instance, account, projectId, checklistItemId)
      if (ok) void refresh()
    },
    [instance, account, refresh],
  )

  const setSetupDate = useCallback(
    async (projectId: string, checklistItemId: string, date: string) => {
      if (!account) return
      const ok = await setSetupItemDate(instance, account, projectId, checklistItemId, date)
      if (ok) void refresh()
    },
    [instance, account, refresh],
  )

  const setSchedule = useCallback(
    async (projectId: string, checklistItemId: string, date: string | null) => {
      if (!account) return
      const ok = await setChecklistItemSchedule(instance, account, projectId, checklistItemId, date)
      if (ok) void refresh()
    },
    [instance, account, refresh],
  )

  const value = useMemo<ChecklistContextValue>(
    () => ({
      checklistByProject,
      loading,
      toggleItem,
      logItem,
      addCustomItem,
      removeItem,
      setSetupDate,
      setSchedule,
    }),
    [checklistByProject, loading, toggleItem, logItem, addCustomItem, removeItem, setSetupDate, setSchedule],
  )

  return <ChecklistContext.Provider value={value}>{children}</ChecklistContext.Provider>
}

export function useChecklist(): ChecklistContextValue {
  const ctx = useContext(ChecklistContext)
  if (!ctx) {
    throw new Error('useChecklist must be used within a ChecklistProvider')
  }
  return ctx
}
