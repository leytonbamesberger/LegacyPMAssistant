import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { Link } from 'react-router-dom'
import { useProject } from '../contexts/ProjectContext'
import { useProfile } from '../contexts/ProfileContext'
import {
  fetchTasks,
  setMeetingDate,
  setTaskNotes,
  setTaskStatus,
  updateTask,
  type NewTaskInput,
  type Task,
  type TaskStatus,
} from '../lib/tasks'
import { AddTaskModal } from '../components/AddTaskModal'
import { NO_TASK_FILTERS, TaskFilters, type TaskFilterState } from '../components/TaskFilters'
import { TaskTable } from '../components/TaskTable'
import type { TaskListRow } from '../lib/taskRows'

const PAGE_SIZE = 25

/** Completed tasks, same rows and filters as Tasks, with numbered pages (the list only ever grows). */
export function ArchivePage() {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { projects } = useProject()
  const { profile, directory, nameFor } = useProfile()

  const [filters, setFilters] = useState<TaskFilterState>(NO_TASK_FILTERS)
  const [page, setPage] = useState(1)
  const [tasks, setTasks] = useState<Task[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const requestId = useRef(0)
  const loadPage = useCallback(async () => {
    if (!account) return
    const id = ++requestId.current
    setLoading(true)
    const result = await fetchTasks(instance, account, {
      status: 'complete',
      ...filters,
      page,
      pageSize: PAGE_SIZE,
    })
    if (id !== requestId.current) return
    setLoadFailed(result === null)
    if (result) {
      setTasks(result.tasks)
      setTotal(result.total)
      // Reopening the last task on the final page leaves that page empty — step back.
      const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
      if (page > lastPage) setPage(lastPage)
    }
    setLoading(false)
  }, [instance, account, filters, page])

  useEffect(() => {
    void loadPage()
  }, [loadPage])

  function changeFilters(next: TaskFilterState) {
    setFilters(next)
    setPage(1)
  }

  async function handleStatus(task: Task, status: TaskStatus) {
    if (!account) return
    // Reopening a task takes it off the Archive (back onto Tasks).
    await setTaskStatus(instance, account, task.id, status)
    void loadPage()
  }

  // Editing a completed meeting's date moves its calendar entry; clearing it reopens the task
  // (it returns to Tasks and leaves this list).
  async function handleMeetingDate(task: Task, date: string | null) {
    if (!account) return
    await setMeetingDate(instance, account, task.id, date)
    void loadPage()
  }

  // Editing a completed manual task changes it in place; it stays complete, so it stays on the Archive.
  async function handleUpdate(task: Task, fields: NewTaskInput): Promise<boolean> {
    if (!account) return false
    const updated = await updateTask(instance, account, task.id, fields)
    if (updated) void loadPage()
    return updated !== null
  }

  async function handleSaveNotes(task: Task, notes: string | null) {
    if (!account) return
    const updated = await setTaskNotes(instance, account, task.id, notes)
    if (updated) setTasks((prev) => prev.map((t) => (t.id === updated.id ? { ...t, notes: updated.notes } : t)))
  }

  const rows = useMemo<TaskListRow[]>(() => tasks.map((task) => ({ kind: 'task', task })), [tasks])

  const filtered =
    filters.projectId !== null || filters.assigneeId !== null || filters.categories.length > 0

  return (
    <div className="w-full px-6 py-8">
      <Link
        to="/organization/tasks"
        className="text-sm font-medium text-legacy-blue-light underline-offset-2 hover:text-legacy-blue-dark hover:underline"
      >
        ← Back to Tasks
      </Link>
      <h1 className="mt-3 text-xl font-semibold text-legacy-blue-dark">Archive</h1>
      <p className="mt-1 text-sm text-legacy-blue-light">
        Completed tasks assigned to or by you, newest first.
      </p>

      <div className="mt-6">
        <TaskFilters
          filters={filters}
          onChange={changeFilters}
          projects={projects}
          directory={directory}
          showFlow={false}
        />
      </div>

      <div className="mt-4">
        <TaskTable
          rows={rows}
          mode="archive"
          loading={loading && tasks.length === 0}
          error={loadFailed}
          onRetry={() => void loadPage()}
          emptyMessage={filtered ? 'No completed tasks match these filters.' : 'Nothing completed yet.'}
          currentProfileId={profile?.id ?? null}
          projectName={(id) => projects.find((p) => p.id === id)?.name ?? null}
          nameFor={nameFor}
          onStatus={(task, status) => void handleStatus(task, status)}
          onSaveNotes={handleSaveNotes}
          onEdit={setEditingTask}
          onMeetingDate={(task, date) => void handleMeetingDate(task, date)}
        />
      </div>

      {total > 0 && (
        <Pagination page={page} pageCount={pageCount} total={total} onPage={setPage} />
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

/** Page numbers with the first/last page and a window around the current one; gaps collapse to "…". */
function pageWindow(page: number, pageCount: number): (number | '…')[] {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1])
  const pages = [...wanted].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) out.push('…')
    out.push(p)
  })
  return out
}

function Pagination({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number
  pageCount: number
  total: number
  onPage: (page: number) => void
}) {
  const first = (page - 1) * PAGE_SIZE + 1
  const last = Math.min(page * PAGE_SIZE, total)
  const button = 'rounded-md px-2.5 py-1 text-sm transition disabled:cursor-default disabled:opacity-40'

  return (
    <nav aria-label="Archive pages" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-legacy-blue-light">
        {first}–{last} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className={`${button} text-legacy-blue-dark hover:bg-legacy-blue-light/10`}
        >
          ← Prev
        </button>
        {pageWindow(page, pageCount).map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="px-1 text-sm text-legacy-blue-light">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPage(p)}
              aria-current={p === page ? 'page' : undefined}
              className={`${button} ${
                p === page
                  ? 'bg-legacy-blue-dark font-medium text-white'
                  : 'text-legacy-blue-dark hover:bg-legacy-blue-light/10'
              }`}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          className={`${button} text-legacy-blue-dark hover:bg-legacy-blue-light/10`}
        >
          Next →
        </button>
      </div>
    </nav>
  )
}
