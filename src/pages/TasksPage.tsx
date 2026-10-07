import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { Link, useNavigate } from 'react-router-dom'
import { useProject } from '../contexts/ProjectContext'
import { useProfile } from '../contexts/ProfileContext'
import { useFlowReport } from '../contexts/FlowReportContext'
import { useAppReady } from '../contexts/AppReadyContext'
import { localToday } from '../lib/dates'
import { defaultFlowReportMonth, lastDayOfMonth } from '../lib/flowReports'
import { buildTaskRows } from '../lib/taskRows'
import {
  createTask,
  deleteTask,
  fetchTasks,
  setMeetingDate,
  setTaskNotes,
  setTaskStatus,
  updateTask,
  type NewTaskInput,
  type Task,
  type TaskStatus,
} from '../lib/tasks'
import type { Project } from '../lib/projects'
import { AddTaskModal } from '../components/AddTaskModal'
import { CloseoutProjectModal } from '../components/CloseoutProjectModal'
import { EditProjectModal } from '../components/EditProjectModal'
import { ProjectBubble } from '../components/ProjectBubble'
import { InitiateProjectModal } from '../components/InitiateProjectModal'
import { ProcoreEmptyState } from '../components/ProcoreEmptyState'
import { NO_TASK_FILTERS, TaskFilters, type TaskFilterState } from '../components/TaskFilters'
import { TaskTable } from '../components/TaskTable'

/**
 * Landing tab under Organization: the pinned "Initiate Project" prompts for
 * Added-but-uninitiated projects (never affected by the filters), then the heading row
 * (title + Add Task), the filters, and the caller's open tasks — by default only what's late or due within a week, with an
 * "Upcoming Tasks" button for the rest. Recurring tasks and each project's Setup
 * collapse into groups, and one computed "FLOW Reports (n)" row stands in for the
 * (no longer stored) flow tasks. Completed tasks live on the Archive.
 */
const UPCOMING_KEY = 'legacy-pm:tasks:showUpcoming'
export function TasksPage() {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { projects, reloadProjects, addedVersion, selectedProject, selectProject } = useProject()
  const { profile, directory, nameFor } = useProfile()
  const { flowReports } = useFlowReport()
  const navigate = useNavigate()
  // The first load already fetched the open list — start from it so the page never opens empty.
  const { initialTasks } = useAppReady()

  const addedProjects = useMemo(() => projects.filter((p) => p.isStarred), [projects])
  const addedIdsKey = addedProjects.map((p) => p.id).join(',')
  const uninitiated = addedProjects.filter((p) => !p.initiated)

  const [filters, setFilters] = useState<TaskFilterState>(NO_TASK_FILTERS)
  const [tasks, setTasks] = useState<Task[]>(() => initialTasks ?? [])
  const [loading, setLoading] = useState(initialTasks === null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])
  // Expanded view lasts for the browser session (survives a trip to the Archive and back).
  const [showUpcoming, setShowUpcoming] = useState(() => {
    try {
      return sessionStorage.getItem(UPCOMING_KEY) === '1'
    } catch {
      return false
    }
  })
  function toggleUpcoming() {
    const next = !showUpcoming
    setShowUpcoming(next)
    try {
      sessionStorage.setItem(UPCOMING_KEY, next ? '1' : '0')
    } catch {
      // Session storage unavailable: the toggle just won't outlive this page.
    }
  }
  const [initiating, setInitiating] = useState<Project | null>(null)
  // Everything pinned above the heading: the selected project's bubble, then the Initiate Project bubbles.
  const pinned = selectedProject !== null || uninitiated.length > 0
  const [addTaskOpen, setAddTaskOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [editingProject, setEditingProject] = useState(false)
  const [closingProject, setClosingProject] = useState(false)

  // Only the newest request may write state, so a slow response to an old filter can't clobber a newer one.
  const requestId = useRef(0)
  const loadTasks = useCallback(async () => {
    if (!account) return
    const id = ++requestId.current
    const result = await fetchTasks(instance, account, { status: 'open', ...filters })
    if (id !== requestId.current) return
    if (result) setTasks(result.tasks)
    setLoadFailed(result === null)
    setLoading(false)
  }, [instance, account, filters])

  // Refetch whenever the filters change or the Added set does.
  useEffect(() => {
    void loadTasks()
  }, [loadTasks, addedIdsKey, addedVersion])

  async function handleStatus(task: Task, status: TaskStatus) {
    if (!account) return
    setTasks((prev) =>
      status === 'complete'
        ? prev.filter((t) => t.id !== task.id) // completed tasks move to the Archive
        : prev.map((t) => (t.id === task.id ? { ...t, status } : t)),
    )
    const result = await setTaskStatus(instance, account, task.id, status)
    // Completing may have spawned the next cycle's row, so re-read rather than patch.
    if (!result || status === 'complete') void loadTasks()
  }

  async function handleDelete(task: Task) {
    if (!account) return
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    const ok = await deleteTask(instance, account, task.id)
    if (!ok) void loadTasks()
  }

  async function handleSaveNotes(task: Task, notes: string | null) {
    if (!account) return
    const updated = await setTaskNotes(instance, account, task.id, notes)
    if (updated) setTasks((prev) => prev.map((t) => (t.id === updated.id ? { ...t, notes: updated.notes } : t)))
  }

  // A meeting row's date input: entering a date completes the task (it leaves this list and lands
  // on the Archive and the calendar).
  async function handleMeetingDate(task: Task, date: string | null) {
    if (!account || !date) return
    const updated = await setMeetingDate(instance, account, task.id, date)
    if (!updated) {
      setToast('Couldn’t save the meeting date — try again.')
      void loadTasks()
      return
    }
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    setToast('Added to calendar')
  }

  async function handleCreate(fields: NewTaskInput): Promise<boolean> {
    if (!account) return false
    const task = await createTask(instance, account, fields)
    if (task) void loadTasks()
    return task !== null
  }

  async function handleUpdate(task: Task, fields: NewTaskInput): Promise<boolean> {
    if (!account) return false
    const updated = await updateTask(instance, account, task.id, fields)
    if (updated) void loadTasks() // the edit can move the row (new date, new assignee, new project)
    return updated !== null
  }

  const filtered =
    filters.projectId !== null || filters.assigneeId !== null || filters.categories.length > 0

  // The computed FLOW row: how many of the caller's Added projects still owe this period's report.
  // flowReports already holds one entry per Added project (a not_started stand-in if none saved),
  // and the flow context patches it the moment a report is saved or submitted, so n stays live.
  const flowInfo = useMemo(() => {
    if (filters.categories.length > 0 && !filters.categories.includes('flow')) return null
    if (filters.assigneeId !== null && filters.assigneeId !== profile?.id) return null
    const owed = flowReports.filter(
      (r) => r.status !== 'completed' && (filters.projectId === null || r.project_id === filters.projectId),
    )
    const month = flowReports[0]?.month ?? defaultFlowReportMonth()
    return { count: owed.length, due: lastDayOfMonth(month) }
  }, [flowReports, filters, profile?.id])

  // First run: nobody has Added a project and there's nothing to list. (A user with no Added projects
  // who still has tasks, e.g. assigned by a teammate, keeps the normal list.)
  const showSignInPrompt =
    addedProjects.length === 0 && !filtered && !loading && !loadFailed && tasks.length === 0

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? null
  const { rows, upcomingCount } = useMemo(
    () =>
      buildTaskRows(tasks, {
        today: localToday(),
        showUpcoming,
        projectName,
        flow: flowInfo,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, showUpcoming, flowInfo, projects],
  )

  return (
    <div className="w-full px-6 py-8">
      {pinned && (
        <div className="space-y-2">
          {selectedProject && (
            <ProjectBubble
              project={selectedProject}
              pmName={selectedProject.pm_id ? nameFor(selectedProject.pm_id) : null}
              apmName={selectedProject.apm_id ? nameFor(selectedProject.apm_id) : null}
              onEdit={() => setEditingProject(true)}
              onCloseout={() => setClosingProject(true)}
              onClear={() => selectProject(null)}
            />
          )}
          {uninitiated.map((project) => (
            <div
              key={project.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-legacy-red/40 bg-legacy-red/5 px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-legacy-blue-dark">
                  {project.job_number ? `${project.job_number} — ` : ''}
                  {project.name}
                </div>
                <div className="text-xs text-legacy-blue-light">
                  Not initiated — set up its checklist and recurring tasks.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInitiating(project)}
                className="shrink-0 rounded-full bg-legacy-red px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90"
              >
                Initiate Project
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={`flex items-start justify-between gap-4 ${pinned ? 'mt-6' : ''}`}>
        <div>
          <h1 className="text-xl font-semibold text-legacy-blue-dark">Tasks</h1>
          <p className="mt-1 text-sm text-legacy-blue-light">
            Everything open that's assigned to or by you.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddTaskOpen(true)}
          className="shrink-0 rounded-full border border-legacy-blue-light/30 px-3 py-1.5 text-xs font-medium text-legacy-blue-dark hover:border-legacy-blue-dark"
        >
          + Add Task
        </button>
      </div>

      {showSignInPrompt ? (
        <ProcoreEmptyState />
      ) : (
        <>
          <div className="mt-6">
            <TaskFilters filters={filters} onChange={setFilters} projects={projects} directory={directory} />
          </div>

          <div className="mt-4">
            <TaskTable
              rows={rows}
              mode="open"
              loading={loading}
              error={loadFailed}
              onRetry={() => void loadTasks()}
              emptyMessage={
                filtered
                  ? showUpcoming
                    ? 'No open tasks match these filters.'
                    : 'Nothing late or due in the next 7 days matches these filters.'
                  : addedProjects.length === 0
                    ? 'No tasks yet. Add a project from the sidebar to get started.'
                    : showUpcoming || upcomingCount === 0
                      ? 'Nothing open right now.'
                      : 'Nothing late or due in the next 7 days.'
              }
              footer={
                <button
                  type="button"
                  onClick={toggleUpcoming}
                  aria-expanded={showUpcoming}
                  className="text-sm font-medium text-legacy-blue-dark underline-offset-2 hover:underline"
                >
                  {showUpcoming ? 'Hide Upcoming Tasks' : 'Upcoming Tasks'}
                </button>
              }
              currentProfileId={profile?.id ?? null}
              projectName={projectName}
              nameFor={nameFor}
              onStatus={(task, status) => void handleStatus(task, status)}
              onDelete={(task) => void handleDelete(task)}
              onEdit={setEditingTask}
              onOpenFlowTab={() => navigate('/organization/flow')}
              onSaveNotes={handleSaveNotes}
              onMeetingDate={(task, date) => void handleMeetingDate(task, date)}
            />
          </div>
        </>
      )}

      <div className="mt-6 text-sm">
        <Link
          to="/organization/tasks/archive"
          className="font-medium text-legacy-blue-light underline-offset-2 hover:text-legacy-blue-dark hover:underline"
        >
          View completed tasks in the Archive →
        </Link>
      </div>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-legacy-blue-dark px-4 py-2 text-sm font-medium text-white shadow-lg"
        >
          {toast}
        </div>
      )}

      {initiating && (
        <InitiateProjectModal
          project={initiating}
          onClose={() => setInitiating(null)}
          onDone={() => {
            // The project flips to initiated (hiding its pinned entry) and its
            // new tasks appear.
            void reloadProjects()
            void loadTasks()
          }}
        />
      )}

      {editingProject && selectedProject && (
        <EditProjectModal
          project={selectedProject}
          onClose={() => setEditingProject(false)}
          onDone={() => {
            // PM/APM and the open tasks' assignees changed: refresh both.
            void reloadProjects()
            void loadTasks()
          }}
        />
      )}

      {closingProject && selectedProject && (
        <CloseoutProjectModal
          project={selectedProject}
          onClose={() => setClosingProject(false)}
          onDone={() => {
            void reloadProjects() // status is now 'closing'
            void loadTasks() // new closeout tasks; recurring ones may be gone
          }}
        />
      )}

      {addTaskOpen && (
        <AddTaskModal
          presetProjectId={null}
          projects={projects}
          directory={directory}
          currentProfileId={profile?.id ?? null}
          onClose={() => setAddTaskOpen(false)}
          onSave={handleCreate}
        />
      )}

      {editingTask && (
        <AddTaskModal
          presetProjectId={null}
          projects={projects}
          directory={directory}
          currentProfileId={profile?.id ?? null}
          editing={editingTask}
          onClose={() => setEditingTask(null)}
          onSave={(fields) => handleUpdate(editingTask, fields)}
        />
      )}
    </div>
  )
}
