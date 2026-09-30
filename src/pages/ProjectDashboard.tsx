import { useEffect, useMemo, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { Link, useLocation } from 'react-router-dom'
import { useProject } from '../contexts/ProjectContext'
import { useProfile } from '../contexts/ProfileContext'
import { useChecklist } from '../contexts/ChecklistContext'
import { useFlowReport } from '../contexts/FlowReportContext'
import { updateProject, type Project } from '../lib/projects'
import {
  completeRecurringTask,
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
import { AddTaskModal } from '../components/AddTaskModal'

export function ProjectDashboard() {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { projects, refreshProjects } = useProject()
  const { profile, directory, nameFor } = useProfile()
  const location = useLocation()

  const starredProjects = useMemo(() => projects.filter((p) => p.isStarred), [projects])

  const {
    checklistByProject,
    loading: checklistLoading,
    toggleItem: handleToggleChecklistItem,
    logItem: handleLogChecklistItem,
    addCustomItem: handleAddCustomChecklistItem,
    removeItem: handleRemoveChecklistItem,
    setSetupDate: handleSetSetupDate,
    setSchedule: handleSetSchedule,
  } = useChecklist()

  const {
    flowReports,
    loading: flowReportsLoading,
    statusByProject: flowStatusByProject,
    openFlowReportModal,
  } = useFlowReport()

  const [tasks, setTasks] = useState<Task[]>([])

  const [addTaskModalProjectId, setAddTaskModalProjectId] = useState<string | null>(null)
  const [addTaskModalOpen, setAddTaskModalOpen] = useState(false)

  async function loadTasks() {
    if (!account) return
    const result = await fetchTasks(instance, account)
    if (result) setTasks(result)
  }

  useEffect(() => {
    void loadTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, account])

  // Deep link from the calendar panel's "Flow Reports Due" entry.
  useEffect(() => {
    if (location.hash !== '#flow-reports' || flowReportsLoading) return
    document.getElementById('flow-reports')?.scrollIntoView({ behavior: 'smooth' })
  }, [location.hash, flowReportsLoading])

  async function handleReassign(
    project: Project,
    field: 'pm_id' | 'apm_id',
    profileId: string | null,
  ) {
    if (!account) return
    const ok = await updateProject(instance, account, project.id, { [field]: profileId })
    if (ok) void refreshProjects()
  }

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

  async function handleCompleteRecurringTask(taskId: string) {
    if (!account) return
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, last_completed_at: new Date().toISOString() } : t)),
    )
    const ok = await completeRecurringTask(instance, account, taskId)
    if (!ok) void loadTasks()
  }

  function completeTask(taskId: string) {
    const task = tasks.find((t) => t.id === taskId)
    if (task?.is_recurring) void handleCompleteRecurringTask(taskId)
    else void handleSetTaskStatus(taskId, 'done')
  }

  async function handleDeleteTask(taskId: string) {
    if (!account) return
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    const ok = await deleteTask(instance, account, taskId)
    if (!ok) void loadTasks()
  }

  function openAddTaskModal(projectId: string | null) {
    setAddTaskModalProjectId(projectId)
    setAddTaskModalOpen(true)
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-legacy-blue-dark">Project Dashboard</h1>
          <p className="mt-1 text-sm text-legacy-blue-light">
            Checklist and flow report status for your starred projects.
          </p>
        </div>
        <Link
          to="/organization/export"
          className="shrink-0 rounded-full border border-legacy-blue-light/30 px-3 py-1.5 text-xs font-medium text-legacy-blue-dark hover:border-legacy-blue-dark"
        >
          Export Flow Reports
        </Link>
      </div>

      {starredProjects.length === 0 ? (
        <p className="mt-8 text-sm text-legacy-blue-light">
          No starred projects yet. Star a project from the sidebar to see it here.
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              onLogChecklistItem={(itemId) => void handleLogChecklistItem(project.id, itemId)}
              onAddCustomChecklistItem={(name, cadenceType, cadenceDays) =>
                void handleAddCustomChecklistItem(project.id, name, cadenceType, cadenceDays)
              }
              onRemoveChecklistItem={(itemId) => void handleRemoveChecklistItem(project.id, itemId)}
              onSetSetupDate={(itemId, date) => void handleSetSetupDate(project.id, itemId, date)}
              onSetSchedule={(itemId, date) => void handleSetSchedule(project.id, itemId, date)}
              onReassign={(field, profileId) => void handleReassign(project, field, profileId)}
              onCompleteTask={(taskId) => completeTask(taskId)}
              onOpenFlowReport={() => openFlowReportModal(project.id)}
              onAddTask={() => openAddTaskModal(project.id)}
            />
          ))}
        </div>
      )}
      {(checklistLoading || flowReportsLoading) && starredProjects.length > 0 && (
        <p className="mt-4 text-xs text-legacy-blue-light">Loading status…</p>
      )}

      <div id="flow-reports">
        <FlowReportsSection
          reports={flowReports}
          projects={starredProjects}
          onOpenReport={(projectId, month) => openFlowReportModal(projectId, month)}
        />
      </div>

      <MyTasksSection
        tasks={tasks}
        projects={projects}
        nameFor={nameFor}
        currentProfileId={profile?.id ?? null}
        onAddTask={() => openAddTaskModal(null)}
        onSetStatus={handleSetTaskStatus}
        onCompleteRecurring={handleCompleteRecurringTask}
        onDelete={handleDeleteTask}
      />

      {addTaskModalOpen && (
        <AddTaskModal
          presetProjectId={addTaskModalProjectId}
          projects={projects}
          directory={directory}
          currentProfileId={profile?.id ?? null}
          onClose={() => setAddTaskModalOpen(false)}
          onCreate={handleCreateTask}
        />
      )}
    </div>
  )
}
