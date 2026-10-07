import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useProject } from '../contexts/ProjectContext'
import { useFlowReport } from '../contexts/FlowReportContext'
import { FlowReportsSection } from '../components/FlowReportsSection'
import { ProcoreEmptyState } from '../components/ProcoreEmptyState'

/**
 * FLOW tab: the Flow Reports list (one row per Added project's current-period
 * report, click to fill it out) and the export entry point — both moved here
 * unchanged from the old project dashboard.
 */
export function FlowPage() {
  const { projects } = useProject()
  const { flowReports, loading, openFlowReportModal } = useFlowReport()
  const addedProjects = useMemo(() => projects.filter((p) => p.isStarred), [projects])

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-legacy-blue-dark">FLOW</h1>
          <p className="mt-1 text-sm text-legacy-blue-light">
            This month's report status across your added projects.
          </p>
        </div>
        <Link
          to="/organization/export"
          className="shrink-0 rounded-full border border-legacy-blue-light/30 px-3 py-1.5 text-xs font-medium text-legacy-blue-dark hover:border-legacy-blue-dark"
        >
          Export Flow Reports
        </Link>
      </div>

      <div className="mt-6">
        {addedProjects.length === 0 ? (
          <ProcoreEmptyState />
        ) : loading && flowReports.length === 0 ? (
          <p className="text-sm text-legacy-blue-light">Loading…</p>
        ) : (
          <FlowReportsSection
            reports={flowReports}
            projects={addedProjects}
            onOpenReport={(projectId, month) => openFlowReportModal(projectId, month)}
          />
        )}
      </div>
    </div>
  )
}
