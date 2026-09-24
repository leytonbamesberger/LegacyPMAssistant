import { useState } from 'react'
import type { Project } from '../lib/projects'
import {
  FLOW_REPORT_QUESTIONS,
  type FlowReport,
  type FlowReportAnswers,
} from '../lib/flowReports'

const STATUS_LABEL: Record<FlowReport['status'], string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
}

const STATUS_CLASS: Record<FlowReport['status'], string> = {
  not_started: 'border border-legacy-blue-light/25 text-legacy-blue-light',
  in_progress: 'border border-legacy-red/50 text-legacy-red',
  completed: 'bg-legacy-blue-dark text-white',
}

export function FlowReportsSection({
  reports,
  projects,
  onSave,
  onSubmit,
}: {
  reports: FlowReport[]
  projects: Project[]
  onSave: (
    projectId: string,
    month: string,
    answers: FlowReportAnswers,
    dueDate: string | null,
  ) => Promise<void>
  onSubmit: (
    projectId: string,
    month: string,
    answers: FlowReportAnswers,
    dueDate: string | null,
  ) => Promise<void>
}) {
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)

  if (reports.length === 0) return null

  return (
    <div className="mt-10">
      <h2 className="text-lg font-semibold text-legacy-blue-dark">Flow Reports</h2>
      <p className="mt-1 text-sm text-legacy-blue-light">
        This month's report status across your starred projects.
      </p>

      <div className="mt-4 overflow-hidden rounded-lg border border-legacy-blue-light/25">
        <table className="w-full text-sm">
          <thead className="bg-legacy-blue-light/5 text-left text-xs uppercase tracking-wide text-legacy-blue-light">
            <tr>
              <th className="px-3 py-2 font-medium">Project</th>
              <th className="px-3 py-2 font-medium">Month</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Due Date</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => {
              const project = projects.find((p) => p.id === report.project_id)
              const isOpen = openProjectId === report.project_id
              return (
                <FlowReportRow
                  key={report.project_id}
                  report={report}
                  project={project}
                  isOpen={isOpen}
                  onToggle={() => setOpenProjectId(isOpen ? null : report.project_id)}
                  onSave={onSave}
                  onSubmit={onSubmit}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FlowReportRow({
  report,
  project,
  isOpen,
  onToggle,
  onSave,
  onSubmit,
}: {
  report: FlowReport
  project: Project | undefined
  isOpen: boolean
  onToggle: () => void
  onSave: FlowReportsSectionProps['onSave']
  onSubmit: FlowReportsSectionProps['onSubmit']
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-t border-legacy-blue-light/15 hover:bg-legacy-blue-light/5"
      >
        <td className="px-3 py-2 font-medium text-legacy-blue-dark">
          {project?.name ?? 'Unknown project'}
        </td>
        <td className="px-3 py-2 text-legacy-blue-light">{formatMonth(report.month)}</td>
        <td className="px-3 py-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[report.status]}`}
          >
            {STATUS_LABEL[report.status]}
          </span>
        </td>
        <td className="px-3 py-2 text-legacy-blue-light">
          {report.due_date ? formatDate(report.due_date) : '—'}
        </td>
      </tr>
      {isOpen && (
        <tr className="border-t border-legacy-blue-light/15 bg-legacy-blue-light/5">
          <td colSpan={4} className="px-3 py-3">
            <FlowReportForm report={report} onSave={onSave} onSubmit={onSubmit} />
          </td>
        </tr>
      )}
    </>
  )
}

type FlowReportsSectionProps = Parameters<typeof FlowReportsSection>[0]

function FlowReportForm({
  report,
  onSave,
  onSubmit,
}: {
  report: FlowReport
  onSave: FlowReportsSectionProps['onSave']
  onSubmit: FlowReportsSectionProps['onSubmit']
}) {
  const [answers, setAnswers] = useState<FlowReportAnswers>(report.answers ?? {})
  const [dueDate, setDueDate] = useState<string>(report.due_date ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await onSave(report.project_id, report.month, answers, dueDate || null)
    setSaving(false)
  }

  async function handleSubmit() {
    setSaving(true)
    await onSubmit(report.project_id, report.month, answers, dueDate || null)
    setSaving(false)
  }

  return (
    <div className="space-y-3">
      <label className="flex max-w-xs items-center gap-2 text-xs text-legacy-blue-light">
        Due date
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded border border-legacy-blue-light/30 px-2 py-1 text-xs text-legacy-blue-dark"
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FLOW_REPORT_QUESTIONS.map(({ key, label }) => (
          <label key={key} className="text-xs text-legacy-blue-light">
            {label}
            <textarea
              rows={2}
              value={answers[key] ?? ''}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [key]: e.target.value }))}
              className="mt-1 w-full rounded-md border border-legacy-blue-light/30 p-2 text-sm text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
            />
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="rounded-full border border-legacy-blue-light/30 px-3 py-1.5 text-xs font-medium text-legacy-blue-dark hover:border-legacy-blue-dark disabled:opacity-60"
        >
          Save Draft
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSubmit()}
          className="rounded-full bg-legacy-blue-dark px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        >
          Submit
        </button>
        {report.status === 'completed' && report.submitted_at && (
          <span className="self-center text-xs text-legacy-blue-light">
            Submitted {formatDate(report.submitted_at)}
          </span>
        )}
      </div>
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
