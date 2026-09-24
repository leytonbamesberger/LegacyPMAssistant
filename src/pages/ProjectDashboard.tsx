import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { Link } from 'react-router-dom'
import { useProject } from '../contexts/ProjectContext'
import { useProfile } from '../contexts/ProfileContext'
import {
  fetchChecklistStatus,
  logWeeklyChecklistItem,
  setChecklistItemDone,
  type ProjectChecklistStatus,
} from '../lib/checklist'
import {
  fetchCurrentFlowReports,
  saveFlowReportDraft,
  submitFlowReport,
  type FlowReport,
  type FlowReportAnswers,
} from '../lib/flowReports'
import { updateProject, type Project } from '../lib/projects'
import {
  createTask,
  deleteTask,
  fetchTasks,
  setTaskStatus,
  type NewTaskInput,
  type Task,
} from '../lib/tasks'
import { ProjectCard } from '../components/ProjectCard'
import { FlowReportsSection } from '../components/FlowReportsSection'
import { MyTasksSection } from '../components/MyTasksSection'

export function ProjectDashboard() {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { projects, refreshProjects } = useProject()
  const { profile, directory, nameFor } = useProfile()

  const starredProjects = useMemo(() => projects.filter((p) => p.isStarred), [projects])
  const starredIds = useMemo(() => starredProjects.map((p) => p.id), [starredProjects])
  const starredIdsKey = starredIds.join(',')

  const [checklistByProject, setChecklistByProject] = useState<
    Record<string, ProjectChecklistStatus>
  >({})
  const [checklistLoading, setChecklistLoading] = useState(true)

  const [flowReports, setFlowReports] = useState<FlowReport[]>([])
  const [flowReportsLoading, setFlowReportsLoading] = useState(true)

  const [tasks, setTasks] = useState<Task[]>([])

  const loadChecklist = useCallback(async () => {
    if (!account || starredIds.length === 0) {
      setChecklistByProject({})
      setChecklistLoading(false)
      return
    }
    setChecklistLoading(true)
    const statuses = await fetchChecklistStatus(instance, account, starredIds)
    if (statuses) {
      setChecklistByProject(Object.fromEntries(statuses.map((s) => [s.projectId, s])))
    }
    setChecklistLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, account, starredIdsKey])

  const loadFlowReports = useCallback(async () => {
    if (!account || starredIds.length === 0) {
      setFlowReports([])
      setFlowReportsLoading(false)
      return
    }
    setFlowReportsLoading(true)
    const reports = await fetchCurrentFlowReports(instance, account, starredIds)
    if (reports) setFlowReports(reports)
    setFlowReportsLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, account, starredIdsKey])

  const loadTasks = useCallback(async () => {
    if (!account) return
    const result = await fetchTasks(instance, account)
    if (result) setTasks(result)
  }, [instance, account])

  useEffect(() => {
    void loadChecklist()
  }, [loadChecklist])

  useEffect(() => {
    void loadFlowReports()
  }, [loadFlowReports])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  async function handleToggleChecklistItem(
    projectId: string,
    checklistItemId: string,
    done: boolean,
  ) {
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
    if (!ok) void loadChecklist()
  }

  async function handleLogWeeklyItem(projectId: string, checklistItemId: string) {
    if (!account) return
    const ok = await logWeeklyChecklistItem(instance, account, projectId, checklistItemId)
    if (ok) void loadChecklist()
  }

  async function handleReassign(
    project: Project,
    field: 'pm_id' | 'apm_id',
    profileId: string | null,
  ) {
    if (!account) return
    const ok = await updateProject(instance, account, project.id, { [field]: profileId })
    if (ok) void refreshProjects()
  }

  async function handleSaveFlowReport(
    projectId: string,
    month: string,
    answers: FlowReportAnswers,
    dueDate: string | null,
  ) {
    if (!account) return
    const report = await saveFlowReportDraft(instance, account, projectId, month, answers, dueDate)
    if (report) {
      setFlowReports((prev) => prev.map((r) => (r.project_id === projectId ? report : r)))
    }
  }

  async function handleSubmitFlowReport(
    projectId: string,
    month: string,
    answers: FlowReportAnswers,
    dueDate: string | null,
  ) {
    if (!account) return
    const report = await submitFlowReport(instance, account, projectId, month, answers, dueDate)
    if (report) {
      setFlowReports((prev) => prev.map((r) => (r.project_id === projectId ? report : r)))
    }
  }

  const flowStatusByProject = useMemo(
    () => Object.fromEntries(flowReports.map((r) => [r.project_id, r.status])),
    [flowReports],
  )

  const openTasksByProject = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const task of tasks) {
      if (task.status !== 'open' || task.assigned_to !== profile?.id || !task.project_id) continue
      ;(map[task.project_id] ??= []).push(task)
    }
    return map
  }, [tasks, profile])

  async function handleCreateTask(fields: NewTaskInput) {
    if (!account) return
    const task = await createTask(instance, account, fields)
    if (task) setTasks((prev) => [...prev, task])
  }

  async function handleSetTaskStatus(taskId: string, status: 'open' | 'done') {
    if (!account) return
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)))
    const ok = await setTaskStatus(instance, account, taskId, status)
    if (!ok) void loadTasks()
  }

  async function handleDeleteTask(taskId: string) {
    if (!account) return
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    const ok = await deleteTask(instance, account, taskId)
    if (!ok) void loadTasks()
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <Link to="/tools" className="text-xs text-legacy-blue-light hover:underline">
        ← Back to Tools
      </Link>
      <h1 className="mt-1 text-xl font-semibold text-legacy-blue-dark">Project Dashboard</h1>
      <p className="mt-1 text-sm text-legacy-blue-light">
        Checklist and flow report status for your starred projects.
      </p>

      {starredProjects.length === 0 ? (
        <p className="mt-8 text-sm text-legacy-blue-light">
          No starred projects yet. Star a project from the sidebar to see it here.
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {starredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              checklist={checklistByProject[project.id]}
              flowReportStatus={flowStatusByProject[project.id]}
              myOpenTasks={openTasksByProject[project.id] ?? []}
              directory={directory}
              nameFor={nameFor}
              onToggleChecklistItem={(itemId, done) =>
                void handleToggleChecklistItem(project.id, itemId, done)
              }
              onLogWeeklyItem={(itemId) => void handleLogWeeklyItem(project.id, itemId)}
              onReassign={(field, profileId) => void handleReassign(project, field, profileId)}
              onCompleteTask={(taskId) => void handleSetTaskStatus(taskId, 'done')}
            />
          ))}
        </div>
      )}
      {(checklistLoading || flowReportsLoading) && starredProjects.length > 0 && (
        <p className="mt-4 text-xs text-legacy-blue-light">Loading status…</p>
      )}

      <FlowReportsSection
        reports={flowReports}
        projects={starredProjects}
        onSave={handleSaveFlowReport}
        onSubmit={handleSubmitFlowReport}
      />

      <MyTasksSection
        tasks={tasks}
        projects={projects}
        directory={directory}
        nameFor={nameFor}
        currentProfileId={profile?.id ?? null}
        onCreate={handleCreateTask}
        onSetStatus={handleSetTaskStatus}
        onDelete={handleDeleteTask}
      />
    </div>
  )
}
