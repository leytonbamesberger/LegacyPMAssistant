import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { Link } from 'react-router-dom'
import { useProject } from '../contexts/ProjectContext'
import {
  exportFlowReportsPdf,
  fetchAvailableFlowReportMonths,
  fetchFlowReportsForMonth,
  type FlowReport,
} from '../lib/flowReports'

export function ExportFlowReports() {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { projects } = useProject()

  const starredProjects = useMemo(() => projects.filter((p) => p.isStarred), [projects])
  const starredIds = useMemo(() => starredProjects.map((p) => p.id), [starredProjects])
  const starredIdsKey = starredIds.join(',')

  const [months, setMonths] = useState<string[]>([])
  const [month, setMonth] = useState<string | null>(null)
  const [reports, setReports] = useState<FlowReport[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (!account || starredIds.length === 0) return
    void (async () => {
      const result = await fetchAvailableFlowReportMonths(instance, account, starredIds)
      if (result && result.length > 0) {
        setMonths(result)
        setMonth((prev) => prev ?? result[0])
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, account, starredIdsKey])

  const loadReports = useCallback(async () => {
    if (!account || !month || starredIds.length === 0) {
      setReports([])
      setLoading(false)
      return
    }
    setLoading(true)
    const result = await fetchFlowReportsForMonth(instance, account, starredIds, month)
    if (result) {
      setReports(result)
      setSelected(new Set(result.filter((r) => r.status === 'completed').map((r) => r.project_id)))
    }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, account, starredIdsKey, month])

  useEffect(() => {
    void loadReports()
  }, [loadReports])

  const completed = reports.filter((r) => r.status === 'completed')
  const incomplete = reports.filter((r) => r.status !== 'completed')

  function toggle(projectId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  async function handleGenerate() {
    if (!account || !month || selected.size === 0) return
    setGenerating(true)
    const blob = await exportFlowReportsPdf(instance, account, [...selected], month)
    setGenerating(false)
    if (!blob) return

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `FLOW Report ${month}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link to="/organization/flow" className="text-xs text-legacy-blue-light hover:underline">
        ← Back to FLOW
      </Link>
      <h1 className="mt-1 text-xl font-semibold text-legacy-blue-dark">Export Flow Reports</h1>
      <p className="mt-1 text-sm text-legacy-blue-light">
        Build the monthly FLOW meeting PDF — cover page plus one letter per selected project.
      </p>

      {starredProjects.length === 0 ? (
        <p className="mt-8 text-sm text-legacy-blue-light">
          No projects added yet. Add a project from the sidebar to include it here.
        </p>
      ) : (
        <>
          <label className="mt-6 flex items-center gap-2 text-sm text-legacy-blue-dark">
            Month
            <select
              value={month ?? ''}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded border border-legacy-blue-light/30 px-2 py-1 text-sm text-legacy-blue-dark"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
            </select>
          </label>

          {loading ? (
            <p className="mt-4 text-sm text-legacy-blue-light">Loading…</p>
          ) : (
            <div className="mt-4 space-y-6">
              <ProjectGroup
                title="Completed"
                reports={completed}
                projects={starredProjects}
                selected={selected}
                onToggle={toggle}
              />
              <ProjectGroup
                title="Incomplete"
                reports={incomplete}
                projects={starredProjects}
                selected={selected}
                onToggle={toggle}
                incomplete
              />
            </div>
          )}

          <button
            type="button"
            disabled={generating || selected.size === 0}
            onClick={() => void handleGenerate()}
            className="mt-6 rounded-full bg-legacy-blue-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {generating ? 'Generating…' : `Generate PDF (${selected.size} project${selected.size === 1 ? '' : 's'})`}
          </button>
        </>
      )}
    </div>
  )
}

function ProjectGroup({
  title,
  reports,
  projects,
  selected,
  onToggle,
  incomplete,
}: {
  title: string
  reports: FlowReport[]
  projects: { id: string; name: string; job_number: string | null }[]
  selected: Set<string>
  onToggle: (projectId: string) => void
  incomplete?: boolean
}) {
  if (reports.length === 0) return null

  return (
    <div>
      <h2 className="text-sm font-semibold text-legacy-blue-dark">
        {title} <span className="font-normal text-legacy-blue-light">({reports.length})</span>
      </h2>
      <ul className="mt-2 space-y-1 rounded-lg border border-legacy-blue-light/25 p-2">
        {reports.map((report) => {
          const project = projects.find((p) => p.id === report.project_id)
          return (
            <li key={report.project_id} className="flex items-center gap-2 px-1 py-1 text-sm">
              <input
                type="checkbox"
                checked={selected.has(report.project_id)}
                onChange={() => onToggle(report.project_id)}
                className="h-3.5 w-3.5 accent-legacy-blue-dark"
              />
              <span className="text-legacy-blue-dark">
                {project?.job_number ?? '—'} — {project?.name ?? 'Unknown project'}
              </span>
              {incomplete && (
                <span className="text-xs font-medium text-legacy-red">incomplete</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function formatMonth(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
