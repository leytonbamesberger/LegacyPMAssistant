import { useEffect, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import {
  FLOW_REPORT_QUESTIONS,
  fetchFlowReportForMonth,
  lastDayOfMonth,
  type FlowReport,
  type FlowReportAnswers,
} from '../lib/flowReports'
import { Modal } from './Modal'

/** Same modal/form used by the Flow Reports section rows and each project card's Flow badge. */
export function FlowReportModal({
  projectId,
  projectName,
  initialMonth,
  onClose,
  onSave,
  onSubmit,
}: {
  projectId: string
  projectName: string | undefined
  initialMonth: string
  onClose: () => void
  onSave: (
    projectId: string,
    month: string,
    answers: FlowReportAnswers,
    marginFadeNotes: string | null,
    underbilledNotes: string | null,
    attn: string | null,
    company: string | null,
  ) => Promise<FlowReport | null>
  onSubmit: (
    projectId: string,
    month: string,
    answers: FlowReportAnswers,
    marginFadeNotes: string | null,
    underbilledNotes: string | null,
    attn: string | null,
    company: string | null,
  ) => Promise<FlowReport | null>
}) {
  const { instance, accounts } = useMsal()
  const account = accounts[0]

  const [month, setMonth] = useState(initialMonth)
  const [report, setReport] = useState<FlowReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [answers, setAnswers] = useState<FlowReportAnswers>({})
  const [marginFadeNotes, setMarginFadeNotes] = useState('')
  const [underbilledNotes, setUnderbilledNotes] = useState('')
  const [attn, setAttn] = useState('')
  const [company, setCompany] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!account) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const fetched = await fetchFlowReportForMonth(instance, account, projectId, month)
      if (cancelled) return
      setReport(fetched)
      setAnswers(fetched?.answers ?? {})
      setMarginFadeNotes(fetched?.margin_fade_notes ?? '')
      setUnderbilledNotes(fetched?.underbilled_notes ?? '')
      setAttn(fetched?.attn ?? '')
      setCompany(fetched?.company ?? '')
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [instance, account, projectId, month])

  async function handleSave() {
    setSaving(true)
    const saved = await onSave(
      projectId,
      month,
      answers,
      marginFadeNotes || null,
      underbilledNotes || null,
      attn || null,
      company || null,
    )
    if (saved) setReport(saved)
    setSaving(false)
  }

  async function handleSubmit() {
    setSaving(true)
    const saved = await onSubmit(
      projectId,
      month,
      answers,
      marginFadeNotes || null,
      underbilledNotes || null,
      attn || null,
      company || null,
    )
    if (saved) setReport(saved)
    setSaving(false)
    onClose()
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-legacy-blue-dark">
          {projectName ?? 'Flow Report'}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-legacy-blue-light hover:text-legacy-red"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-legacy-blue-light">
        <label className="flex items-center gap-2">
          Month
          <input
            type="month"
            value={month.slice(0, 7)}
            onChange={(e) => setMonth(`${e.target.value}-01`)}
            className="rounded border border-legacy-blue-light/30 px-2 py-1 text-xs text-legacy-blue-dark"
          />
        </label>
        <span>Due date: {formatDate(lastDayOfMonth(month))}</span>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-legacy-blue-light">Loading…</p>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-legacy-blue-light">
              Attn
              <input
                type="text"
                value={attn}
                onChange={(e) => setAttn(e.target.value)}
                placeholder="Optional"
                className="mt-1 w-full rounded-md border border-legacy-blue-light/30 p-2 text-sm text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
              />
            </label>
            <label className="text-xs text-legacy-blue-light">
              Company
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Optional"
                className="mt-1 w-full rounded-md border border-legacy-blue-light/30 p-2 text-sm text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
              />
            </label>
          </div>

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

          <label className="block text-xs text-legacy-blue-light">
            Margin fade notes
            <textarea
              rows={2}
              value={marginFadeNotes}
              onChange={(e) => setMarginFadeNotes(e.target.value)}
              placeholder="If applicable — jobs with margin fade from prior projections and why"
              className="mt-1 w-full rounded-md border border-legacy-blue-light/30 p-2 text-sm text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
            />
          </label>

          <label className="block text-xs text-legacy-blue-light">
            Underbilled notes
            <textarea
              rows={2}
              value={underbilledNotes}
              onChange={(e) => setUnderbilledNotes(e.target.value)}
              placeholder="If applicable — jobs currently underbilled and why"
              className="mt-1 w-full rounded-md border border-legacy-blue-light/30 p-2 text-sm text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
            />
          </label>

          <div className="flex items-center gap-2">
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
            {report?.status === 'completed' && report.submitted_at && (
              <span className="text-xs text-legacy-blue-light">
                Submitted {formatDate(report.submitted_at)}
              </span>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
