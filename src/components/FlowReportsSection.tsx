import type { Project } from '../lib/projects'
import { lastDayOfMonth, type FlowReport } from '../lib/flowReports'

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

/** Flat cross-project list; clicking a row opens the shared FlowReportModal (see ProjectDashboard). */
export function FlowReportsSection({
  reports,
  projects,
  onOpenReport,
}: {
  reports: FlowReport[]
  projects: Project[]
  onOpenReport: (projectId: string, month: string) => void
}) {
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
              return (
                <tr
                  key={report.project_id}
                  onClick={() => onOpenReport(report.project_id, report.month)}
                  className="cursor-pointer border-t border-legacy-blue-light/15 hover:bg-legacy-blue-light/5"
                >
                  <td className="px-3 py-2 font-medium text-legacy-blue-dark">
                    {project?.name ?? 'Unknown project'}
                  </td>
                  <td className="px-3 py-2 text-legacy-blue-light">
                    {formatMonth(report.month)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[report.status]}`}
                    >
                      {STATUS_LABEL[report.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-legacy-blue-light">
                    {formatDate(lastDayOfMonth(report.month))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
