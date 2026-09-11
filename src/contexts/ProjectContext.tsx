import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { useMsal } from '@azure/msal-react'
import {
  fetchProjects,
  setProjectStarred as apiSetProjectStarred,
  syncProjects as apiSyncProjects,
  type Project,
} from '../lib/projects'
import { useUnsavedWork } from './UnsavedWorkContext'

const SELECTED_PROJECT_KEY = 'legacy-pm:selectedProjectId'

interface PendingSwitch {
  /** The project being switched to, or null to deselect. Wrapped so "null" is
   * distinguishable from "no pending switch at all". */
  project: Project | null
}

interface ProjectContextValue {
  projects: Project[]
  selectedProject: Project | null
  loading: boolean
  syncing: boolean
  syncError: string | null
  /** Attempts to select a project, guarding against unsaved work first. */
  selectProject: (project: Project | null) => void
  /** Manually re-trigger a Procore sync ("Refresh Projects"). */
  refreshProjects: () => Promise<void>
  toggleStar: (project: Project) => Promise<void>
  /** Non-null while the unsaved-work confirmation modal should be showing. */
  pendingSwitch: PendingSwitch | null
  confirmPendingSwitch: () => void
  cancelPendingSwitch: () => void
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

function readStoredProjectId(): string | null {
  try {
    return localStorage.getItem(SELECTED_PROJECT_KEY)
  } catch {
    return null
  }
}

function writeStoredProjectId(id: string | null) {
  try {
    if (id) localStorage.setItem(SELECTED_PROJECT_KEY, id)
    else localStorage.removeItem(SELECTED_PROJECT_KEY)
  } catch {
    // Storage can be unavailable (private browsing, quota). Selection just
    // won't survive a refresh — not worth surfacing to the user.
  }
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { hasUnsavedWork } = useUnsavedWork()

  const [projects, setProjects] = useState<Project[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(readStoredProjectId)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null)

  // On mount (once authenticated): show cached projects immediately, then
  // sync with Procore in the background without blocking anything above.
  useEffect(() => {
    if (!account) return
    let cancelled = false

    void (async () => {
      setLoading(true)
      const cached = await fetchProjects(instance, account)
      if (!cancelled && cached) setProjects(cached)
      setLoading(false)

      setSyncing(true)
      const result = await apiSyncProjects(instance, account)
      if (cancelled) return
      if (result) {
        setProjects(result.projects)
        setSyncError(result.syncOk ? null : result.syncError)
      } else {
        setSyncError('Could not sync projects')
      }
      setSyncing(false)
    })()

    return () => {
      cancelled = true
    }
  }, [instance, account])

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  )

  const applySelection = useCallback((project: Project | null) => {
    setSelectedId(project?.id ?? null)
    writeStoredProjectId(project?.id ?? null)
  }, [])

  const selectProject = useCallback(
    (project: Project | null) => {
      const targetId = project?.id ?? null
      if (hasUnsavedWork && targetId !== selectedId) {
        setPendingSwitch({ project })
        return
      }
      applySelection(project)
    },
    [hasUnsavedWork, selectedId, applySelection],
  )

  const confirmPendingSwitch = useCallback(() => {
    if (pendingSwitch) applySelection(pendingSwitch.project)
    setPendingSwitch(null)
  }, [pendingSwitch, applySelection])

  const cancelPendingSwitch = useCallback(() => setPendingSwitch(null), [])

  const refreshProjects = useCallback(async () => {
    if (!account) return
    setSyncing(true)
    const result = await apiSyncProjects(instance, account)
    if (result) {
      setProjects(result.projects)
      setSyncError(result.syncOk ? null : result.syncError)
    } else {
      setSyncError('Could not sync projects')
    }
    setSyncing(false)
  }, [instance, account])

  const toggleStar = useCallback(
    async (project: Project) => {
      if (!account) return
      const nextStarred = !project.isStarred
      // Optimistic update — revert if the server call fails.
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, isStarred: nextStarred } : p)),
      )
      const ok = await apiSetProjectStarred(instance, account, project.id, nextStarred)
      if (!ok) {
        setProjects((prev) =>
          prev.map((p) => (p.id === project.id ? { ...p, isStarred: !nextStarred } : p)),
        )
      }
    },
    [instance, account],
  )

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      selectedProject,
      loading,
      syncing,
      syncError,
      selectProject,
      refreshProjects,
      toggleStar,
      pendingSwitch,
      confirmPendingSwitch,
      cancelPendingSwitch,
    }),
    [
      projects,
      selectedProject,
      loading,
      syncing,
      syncError,
      selectProject,
      refreshProjects,
      toggleStar,
      pendingSwitch,
      confirmPendingSwitch,
      cancelPendingSwitch,
    ],
  )

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  )
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext)
  if (!ctx) {
    throw new Error('useProject must be used within a ProjectProvider')
  }
  return ctx
}
