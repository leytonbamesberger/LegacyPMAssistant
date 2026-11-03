import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import { useProfile } from './ProfileContext'
import { useUnsavedWork } from './UnsavedWorkContext'

const SELECTED_PROJECT_KEY = 'legacy-pm:selectedProjectId'
// v2: projects gained `initiated`; v3: `service_id`. Bumping the key means a cache written before a field
// existed is ignored, instead of showing every project as "needs initiating" / "has no service salesman"
// for the moment before the first fetch lands.
const PROJECTS_CACHE_PREFIX = 'legacy-pm:projects:v3:'

interface PendingSwitch {
  /** The project being switched to, or null to deselect. Wrapped so "null" is
   * distinguishable from "no pending switch at all". */
  project: Project | null
}

interface ProjectContextValue {
  projects: Project[]
  selectedProject: Project | null
  loading: boolean
  /** The first project-list fetch has finished (successfully or not) — cached rows alone don't count. */
  loaded: boolean
  /** That first fetch failed. */
  loadError: boolean
  /** Re-runs the initial project-list fetch (no Procore sync). */
  retryLoad: () => Promise<void>
  syncing: boolean
  syncError: string | null
  /** Attempts to select a project, guarding against unsaved work first. */
  selectProject: (project: Project | null) => void
  /** Manually re-trigger a Procore sync ("Refresh Projects"). */
  refreshProjects: () => Promise<void>
  /** Re-reads the project list from our own database (no Procore call) — e.g. after initiation changes a project. */
  reloadProjects: () => Promise<void>
  /**
   * Adds / removes a project. A Service user adding a project that has no service salesman doesn't add it
   * yet: it becomes `pendingClaim` and the "Meet with the owner/client" modal asks for the optional due date.
   */
  toggleStar: (project: Project) => Promise<void>
  /**
   * Adds a project (never removes it, even if it is already Added) — the Available Projects tab's Add. Same
   * Service claim flow as toggleStar.
   */
  addProject: (project: Project) => Promise<void>
  /** The project a Service user is about to claim (Add is waiting on the modal), or null. */
  pendingClaim: Project | null
  /** The modal's Add Project: adds the project and claims it, with the task's optional due date. */
  confirmClaim: (dueDate: string | null) => Promise<void>
  /** The modal's Cancel: aborts the whole Add. */
  cancelClaim: () => void
  /**
   * Bumps once the server has recorded an Add/remove. Adding a project creates
   * its flow task server-side, so task lists refetch on this (not on the
   * optimistic flip, which would race the request).
   */
  addedVersion: number
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

/**
 * Cached per signed-in user (keyed by the stable MSAL account id, since a real
 * `profiles` row doesn't exist client-side until ProfileContext's own async
 * fetch resolves — using the account id lets this read happen synchronously,
 * before any network round trip, so cards paint on the very first render
 * instead of an empty-then-populated flash on every page load).
 */
function readStoredProjects(accountId: string | undefined): Project[] {
  if (!accountId) return []
  try {
    const raw = localStorage.getItem(PROJECTS_CACHE_PREFIX + accountId)
    return raw ? (JSON.parse(raw) as Project[]) : []
  } catch {
    return []
  }
}

function writeStoredProjects(accountId: string | undefined, projects: Project[]) {
  if (!accountId) return
  try {
    localStorage.setItem(PROJECTS_CACHE_PREFIX + accountId, JSON.stringify(projects))
  } catch {
    // Storage can be unavailable (private browsing, quota). Just means the
    // next load falls back to the normal fetch-then-populate flow.
  }
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { hasUnsavedWork } = useUnsavedWork()
  const { profile } = useProfile()

  // Lazily seeded from localStorage so, on a reload, previously-seen cards paint
  // immediately instead of an empty grid while the network round trip is in flight.
  const [projects, setProjects] = useState<Project[]>(() => readStoredProjects(account?.homeAccountId))
  const [selectedId, setSelectedId] = useState<string | null>(readStoredProjectId)
  const [loading, setLoading] = useState(() => readStoredProjects(account?.homeAccountId).length === 0)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null)
  const [addedVersion, setAddedVersion] = useState(0)
  const [pendingClaim, setPendingClaim] = useState<Project | null>(null)

  // Keep the cache in sync with whatever's shown, regardless of which code path
  // changed it (initial fetch, Procore sync, star toggle + its revert, ...) —
  // one place to update rather than threading a write through every setter.
  useEffect(() => {
    writeStoredProjects(account?.homeAccountId, projects)
  }, [account?.homeAccountId, projects])

  // The first fetch of the project list from our own database (never a Procore call).
  const loadId = useRef(0)
  const loadProjectList = useCallback(async () => {
    if (!account) return
    const id = ++loadId.current
    setLoadError(false)
    // Only show the loading state when there's nothing cached to show yet
    // (this device's first-ever load for this user) — otherwise the cached
    // cards stay on screen while this refetch happens quietly behind them.
    if (readStoredProjects(account.homeAccountId).length === 0) setLoading(true)
    const fresh = await fetchProjects(instance, account)
    if (id !== loadId.current) return
    if (fresh) setProjects(fresh)
    setLoadError(fresh === null)
    setLoading(false)
    setLoaded(true)
  }, [instance, account])

  // On mount (once authenticated): show cached projects immediately, then
  // sync with Procore in the background without blocking anything above.
  useEffect(() => {
    if (!account) return
    let cancelled = false

    void (async () => {
      await loadProjectList()
      if (cancelled) return

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
  }, [instance, account, loadProjectList])

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

  const reloadProjects = useCallback(async () => {
    if (!account) return
    const fresh = await fetchProjects(instance, account)
    if (fresh) setProjects(fresh)
  }, [instance, account])

  // The one place an Add / un-Add is recorded. `claimDueDate` is only used when a Service user's Add ends up
  // claiming the project's service salesman slot (see the pending-claim modal).
  const applyStar = useCallback(
    async (project: Project, nextStarred: boolean, claimDueDate: string | null) => {
      if (!account) return
      // A Service user adding a project with no salesman becomes it: show that at once (the project leaves
      // Available Projects). Un-adding never changes the salesman.
      const claiming = nextStarred && profile?.title === 'service' && !project.service_id && !!profile.id
      // Optimistic update — revert if the server call fails.
      setProjects((prev) =>
        prev.map((p) =>
          p.id === project.id
            ? { ...p, isStarred: nextStarred, service_id: claiming ? (profile?.id ?? null) : p.service_id }
            : p,
        ),
      )
      const { ok, claimed } = await apiSetProjectStarred(instance, account, project.id, nextStarred, claimDueDate)
      if (!ok) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === project.id ? { ...p, isStarred: !nextStarred, service_id: project.service_id } : p,
          ),
        )
        return
      }
      setAddedVersion((v) => v + 1)
      // The server decides who got the slot (someone may have claimed it first): take its answer.
      if (claiming || claimed) void reloadProjects()
    },
    [instance, account, profile?.id, profile?.title, reloadProjects],
  )

  const addProject = useCallback(
    async (project: Project) => {
      if (profile?.title === 'service' && !project.service_id) {
        setPendingClaim(project)
        return
      }
      await applyStar(project, true, null)
    },
    [profile?.title, applyStar],
  )

  const toggleStar = useCallback(
    async (project: Project) => {
      if (project.isStarred) await applyStar(project, false, null)
      else await addProject(project)
    },
    [applyStar, addProject],
  )

  const confirmClaim = useCallback(
    async (dueDate: string | null) => {
      const project = pendingClaim
      setPendingClaim(null)
      if (project) await applyStar(project, true, dueDate)
    },
    [pendingClaim, applyStar],
  )

  const cancelClaim = useCallback(() => setPendingClaim(null), [])

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      selectedProject,
      loading,
      loaded,
      loadError,
      retryLoad: loadProjectList,
      syncing,
      syncError,
      selectProject,
      refreshProjects,
      reloadProjects,
      toggleStar,
      addProject,
      pendingClaim,
      confirmClaim,
      cancelClaim,
      addedVersion,
      pendingSwitch,
      confirmPendingSwitch,
      cancelPendingSwitch,
    }),
    [
      projects,
      selectedProject,
      loading,
      loaded,
      loadError,
      loadProjectList,
      syncing,
      syncError,
      selectProject,
      refreshProjects,
      reloadProjects,
      toggleStar,
      addProject,
      pendingClaim,
      confirmClaim,
      cancelClaim,
      addedVersion,
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
