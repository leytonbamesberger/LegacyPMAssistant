import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMsal } from '@azure/msal-react'
import {
  defaultFlowReportMonth,
  fetchDefaultPeriodFlowReports,
  saveFlowReportDraft,
  submitFlowReport,
  type FlowReport,
  type FlowReportAnswers,
} from '../lib/flowReports'
import type { FlowBudgetChecklist } from '../../shared/flowBudget'
import { FlowReportModal } from '../components/FlowReportModal'
import { useProject } from './ProjectContext'

interface FlowReportContextValue {
  /** Each Added project's report for the current default period. */
  flowReports: FlowReport[]
  loading: boolean
  statusByProject: Record<string, FlowReport['status']>
  /**
   * Bumps after every report save/submit. A report's status is mirrored onto its
   * flow task server-side, so anything showing tasks refetches when this changes.
   */
  reportVersion: number
  /** Opens the shared modal for a project — `month` defaults to its existing report's month, or the current default period. */
  openFlowReportModal: (projectId: string, month?: string) => void
}

const FlowReportContext = createContext<FlowReportContextValue | null>(null)

/**
 * Single source of truth for Added-project flow report status, and the one
 * FlowReportModal instance for the whole app shell — so every entry point
 * (the Tasks page's flow tasks, the calendar) opens the same modal and sees
 * the same status without a parallel data path.
 */
export function FlowReportProvider({ children }: { children: ReactNode }) {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { projects } = useProject()

  const starredIds = useMemo(() => projects.filter((p) => p.isStarred).map((p) => p.id), [projects])
  const starredIdsKey = starredIds.join(',')

  const [flowReports, setFlowReports] = useState<FlowReport[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ projectId: string; month: string } | null>(null)
  const [reportVersion, setReportVersion] = useState(0)

  const refresh = useCallback(async () => {
    if (!account || starredIds.length === 0) {
      setFlowReports([])
      setLoading(false)
      return
    }
    setLoading(true)
    const reports = await fetchDefaultPeriodFlowReports(instance, account, starredIds)
    if (reports) setFlowReports(reports)
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, account, starredIdsKey])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Only patches the default-period summary when the saved/submitted month is
  // the one currently shown there — editing a past month via the modal's own
  // month selector shouldn't overwrite what "this period" shows.
  const patchIfCurrentPeriod = useCallback((report: FlowReport) => {
    setFlowReports((prev) =>
      prev.map((r) => (r.project_id === report.project_id && r.month === report.month ? report : r)),
    )
  }, [])

  const handleSave = useCallback(
    async (
      projectId: string,
      month: string,
      answers: FlowReportAnswers,
      marginFadeNotes: string | null,
      underbilledNotes: string | null,
      attn: string | null,
      company: string | null,
      budget: FlowBudgetChecklist,
    ) => {
      if (!account) return null
      const report = await saveFlowReportDraft(
        instance,
        account,
        projectId,
        month,
        answers,
        marginFadeNotes,
        underbilledNotes,
        attn,
        company,
        budget,
      )
      if (report) {
        patchIfCurrentPeriod(report)
        setReportVersion((v) => v + 1)
      }
      return report
    },
    [instance, account, patchIfCurrentPeriod],
  )

  const handleSubmit = useCallback(
    async (
      projectId: string,
      month: string,
      answers: FlowReportAnswers,
      marginFadeNotes: string | null,
      underbilledNotes: string | null,
      attn: string | null,
      company: string | null,
      budget: FlowBudgetChecklist,
    ) => {
      if (!account) return null
      const report = await submitFlowReport(
        instance,
        account,
        projectId,
        month,
        answers,
        marginFadeNotes,
        underbilledNotes,
        attn,
        company,
        budget,
      )
      if (report) {
        patchIfCurrentPeriod(report)
        setReportVersion((v) => v + 1)
      }
      return report
    },
    [instance, account, patchIfCurrentPeriod],
  )

  const openFlowReportModal = useCallback(
    (projectId: string, month?: string) => {
      if (month) {
        setModal({ projectId, month })
        return
      }
      const existing = flowReports.find((r) => r.project_id === projectId)
      setModal({ projectId, month: existing?.month ?? defaultFlowReportMonth() })
    },
    [flowReports],
  )

  const statusByProject = useMemo(
    () => Object.fromEntries(flowReports.map((r) => [r.project_id, r.status])),
    [flowReports],
  )

  const value = useMemo<FlowReportContextValue>(
    () => ({ flowReports, loading, statusByProject, reportVersion, openFlowReportModal }),
    [flowReports, loading, statusByProject, reportVersion, openFlowReportModal],
  )

  const project = modal ? projects.find((p) => p.id === modal.projectId) : undefined

  return (
    <FlowReportContext.Provider value={value}>
      {children}
      {modal && (
        <FlowReportModal
          projectId={modal.projectId}
          projectName={project?.name}
          initialMonth={modal.month}
          onClose={() => setModal(null)}
          onSave={handleSave}
          onSubmit={handleSubmit}
        />
      )}
    </FlowReportContext.Provider>
  )
}

export function useFlowReport(): FlowReportContextValue {
  const ctx = useContext(FlowReportContext)
  if (!ctx) {
    throw new Error('useFlowReport must be used within a FlowReportProvider')
  }
  return ctx
}
