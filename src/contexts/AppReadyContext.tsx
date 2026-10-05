import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMsal } from '@azure/msal-react'
import { useLocation } from 'react-router-dom'
import { AppLoadingView } from '../components/AppLoadingView'
import { fetchTasks, type Task } from '../lib/tasks'
import { useProcore } from './ProcoreContext'
import { useProfile } from './ProfileContext'
import { useProject } from './ProjectContext'

/** After this long without everything loading, the spinner gives way to a message + Retry. */
const LOAD_TIMEOUT_MS = 20_000

interface AppReadyContextValue {
  /**
   * The open-tasks list fetched during the first load, so the Tasks page can paint with data on
   * its first render instead of starting empty. Null once the user navigates anywhere else (it
   * would be stale by then) — pages then load for themselves with their own in-page loading state.
   */
  initialTasks: Task[] | null
}

const AppReadyContext = createContext<AppReadyContextValue | null>(null)

type TasksLoad = { status: 'loading' } | { status: 'error' } | { status: 'done'; tasks: Task[] }

/**
 * The single "app ready" gate. Waits for everything the first meaningful render needs —
 * profile + directory, the Added-projects list, the Procore connection state, and the initial
 * Tasks query — and shows the branded loader until then. It latches: once the app has been
 * ready, later reloads and navigation never bring the full-page loader back.
 */
export function AppReadyProvider({ children }: { children: ReactNode }) {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const profile = useProfile()
  const projects = useProject()
  const procore = useProcore()
  const { pathname } = useLocation()

  const [tasksLoad, setTasksLoad] = useState<TasksLoad>({ status: 'loading' })
  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const tasksRequest = useRef(0)
  const loadTasks = useCallback(async () => {
    if (!account) return
    const id = ++tasksRequest.current
    setTasksLoad({ status: 'loading' })
    const result = await fetchTasks(instance, account, { status: 'open' })
    if (id !== tasksRequest.current) return
    setTasksLoad(result ? { status: 'done', tasks: result.tasks } : { status: 'error' })
  }, [instance, account])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  const failed = profile.error || projects.loadError || procore.error || tasksLoad.status === 'error'
  const settled =
    !profile.loading && projects.loaded && !procore.loading && tasksLoad.status !== 'loading'

  useEffect(() => {
    if (!ready && settled && !failed) setReady(true)
  }, [ready, settled, failed])

  // Don't leave anyone on an endless spinner. Restarts on every Retry.
  useEffect(() => {
    if (ready) return
    setTimedOut(false)
    const timer = window.setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [ready, attempt])

  const { reload: reloadProfile } = profile
  const { retryLoad: retryProjects } = projects
  const { refresh: refreshProcore } = procore
  const retry = useCallback(() => {
    setAttempt((n) => n + 1)
    void reloadProfile()
    void retryProjects()
    void refreshProcore()
    void loadTasks()
  }, [loadTasks, reloadProfile, retryProjects, refreshProcore])

  // The prefetched list is only good for the page the app opened on.
  const firstPath = useRef(pathname)
  const [seedExpired, setSeedExpired] = useState(false)
  useEffect(() => {
    if (pathname !== firstPath.current) setSeedExpired(true)
  }, [pathname])

  const value = useMemo<AppReadyContextValue>(
    () => ({
      initialTasks: !seedExpired && tasksLoad.status === 'done' ? tasksLoad.tasks : null,
    }),
    [seedExpired, tasksLoad],
  )

  if (!ready) {
    const error = failed
      ? { message: 'Something went wrong while loading. Check your connection and try again.' }
      : timedOut
        ? { message: 'This is taking longer than expected. Check your connection and try again.' }
        : null
    return <AppLoadingView error={error} onRetry={retry} />
  }

  return <AppReadyContext.Provider value={value}>{children}</AppReadyContext.Provider>
}

export function useAppReady(): AppReadyContextValue {
  const ctx = useContext(AppReadyContext)
  if (!ctx) throw new Error('useAppReady must be used within an AppReadyProvider')
  return ctx
}
