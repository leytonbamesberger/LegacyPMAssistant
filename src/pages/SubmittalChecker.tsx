import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useMsal } from '@azure/msal-react'
import { Link } from 'react-router-dom'
import { useProject } from '../contexts/ProjectContext'
import { useUnsavedWork } from '../contexts/UnsavedWorkContext'
import { CsiSectionPicker } from '../components/CsiSectionPicker'
import { CATEGORY_KEYS, CATEGORY_META } from '../../shared/categories'
import { formatCsiCode, normalizeCsiCode } from '../../shared/csi'
import {
  createSubmittal,
  fetchProjectSpecs,
  runSubmittal,
  syncProjectSpecs,
  uploadSubmittalFile,
  type SpecSection,
  type SubmittalCheck,
} from '../lib/submittals'

type Phase =
  | { kind: 'form' }
  | { kind: 'uploading' }
  | { kind: 'running' }
  | {
      kind: 'needs_section'
      submittalCheckId: string
      predictedSection: string | null
      predictedTitle: string | null
      confidence: number
      reasoning: string
    }
  | { kind: 'multi_product'; explanation: string | null }
  | { kind: 'completed'; check: SubmittalCheck }
  | { kind: 'failed'; submittalCheckId: string | null; error: string }

export function SubmittalChecker() {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { selectedProject } = useProject()
  const { setUnsavedWork } = useUnsavedWork()

  const [specs, setSpecs] = useState<SpecSection[] | null>(null)
  const [specsSyncing, setSpecsSyncing] = useState(false)
  const [specsSyncError, setSpecsSyncError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [manualCode, setManualCode] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [treatAsSingle, setTreatAsSingle] = useState(false)

  const [phase, setPhase] = useState<Phase>({ kind: 'form' })

  const loadSpecs = useCallback(async () => {
    if (!account || !selectedProject) return
    const cached = await fetchProjectSpecs(instance, account, selectedProject.id)
    setSpecs(cached ?? [])
  }, [instance, account, selectedProject])

  useEffect(() => {
    setSpecs(null)
    void loadSpecs()
  }, [loadSpecs])

  async function handleSyncSpecs() {
    if (!account || !selectedProject) return
    setSpecsSyncing(true)
    const result = await syncProjectSpecs(instance, account, selectedProject.id)
    if (result) {
      setSpecs(result.sections)
      setSpecsSyncError(result.syncOk ? null : result.syncError)
    } else {
      setSpecsSyncError('Could not sync specs')
    }
    setSpecsSyncing(false)
  }

  const manualSection = useMemo(
    () => specs?.find((s) => s.csi_code === manualCode) ?? null,
    [specs, manualCode],
  )

  const runPipeline = useCallback(
    async (submittalCheckId: string, csiSectionOverride?: string) => {
      if (!account) return
      setPhase({ kind: 'running' })
      setUnsavedWork(true, 'submittal check in progress')
      const result = await runSubmittal(instance, account, {
        submittalCheckId,
        csiSectionOverride,
        treatAsSingleSubmittal: treatAsSingle,
      })
      setUnsavedWork(false)

      if (!result) {
        setPhase({ kind: 'failed', submittalCheckId, error: 'The request failed unexpectedly.' })
        return
      }
      if (result.kind === 'needs_section_selection') {
        setPhase({
          kind: 'needs_section',
          submittalCheckId,
          predictedSection: result.predictedSection,
          predictedTitle: result.predictedTitle,
          confidence: result.confidence,
          reasoning: result.reasoning,
        })
      } else if (result.kind === 'multi_product') {
        setPhase({ kind: 'multi_product', explanation: result.explanation })
      } else if (result.kind === 'completed') {
        setPhase({ kind: 'completed', check: result.check })
      } else {
        setPhase({ kind: 'failed', submittalCheckId, error: result.error })
      }
    },
    [instance, account, treatAsSingle, setUnsavedWork],
  )

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!file || !selectedProject || !account) return

    setPhase({ kind: 'uploading' })
    const created = await createSubmittal(instance, account, {
      projectId: selectedProject.id,
      filename: file.name,
      csiSection: manualCode ?? undefined,
    })
    if (!created) {
      setPhase({ kind: 'failed', submittalCheckId: null, error: 'Could not start the submittal check.' })
      return
    }

    const uploaded = await uploadSubmittalFile(created.uploadPath, created.uploadToken, file)
    if (!uploaded) {
      setPhase({
        kind: 'failed',
        submittalCheckId: created.submittalCheckId,
        error: 'File upload failed.',
      })
      return
    }

    await runPipeline(created.submittalCheckId)
  }

  function resetForm() {
    setFile(null)
    setManualCode(null)
    setShowPicker(false)
    setTreatAsSingle(false)
    setPhase({ kind: 'form' })
  }

  if (!selectedProject) {
    return (
      <PageShell>
        <EmptyState>
          Select a project from the sidebar to check a submittal against its
          specifications.
        </EmptyState>
      </PageShell>
    )
  }

  return (
    <PageShell
      projectName={selectedProject.name}
      onSyncSpecs={() => void handleSyncSpecs()}
      syncing={specsSyncing}
      syncError={specsSyncError}
    >
      {specs === null ? (
        <p className="text-sm text-legacy-blue-light">Loading specifications…</p>
      ) : specs.length === 0 ? (
        <EmptyState>
          No specifications are cached for this project yet. Add specifications
          in Procore, then sync.
          <button
            type="button"
            onClick={() => void handleSyncSpecs()}
            disabled={specsSyncing}
            className="mt-3 block rounded-md bg-legacy-blue-dark px-4 py-2 text-sm font-medium text-white hover:bg-legacy-blue-dark/90 disabled:opacity-60"
          >
            {specsSyncing ? 'Syncing…' : 'Sync Specs'}
          </button>
        </EmptyState>
      ) : phase.kind === 'form' || phase.kind === 'uploading' || phase.kind === 'running' ? (
        <form onSubmit={handleSubmit} className="max-w-xl space-y-5">
          <div>
            <label className="block text-sm font-medium text-legacy-blue-dark">
              Submittal PDF
            </label>
            <input
              type="file"
              accept="application/pdf"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1.5 block w-full text-sm text-legacy-blue-dark file:mr-3 file:rounded-md file:border-0 file:bg-legacy-blue-dark file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-legacy-blue-dark/90"
            />
          </div>

          <div className="rounded-md border border-legacy-blue-light/20 p-3">
            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              className="text-sm text-legacy-blue-light hover:text-legacy-blue-dark"
            >
              {showPicker ? '– Hide' : '+ Spec Section (optional)'}
              {manualSection && !showPicker && (
                <span className="ml-2 font-medium text-legacy-blue-dark">
                  {manualSection.csi_code_display ?? manualSection.csi_code}
                </span>
              )}
            </button>
            {showPicker && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-legacy-blue-light">
                  Leave blank to let AI detect the section automatically.
                </p>
                <CsiSectionPicker
                  sections={specs}
                  value={manualCode}
                  onChange={(section) => {
                    setManualCode(section.csi_code)
                    setShowPicker(false)
                  }}
                />
                {manualCode && (
                  <button
                    type="button"
                    onClick={() => setManualCode(null)}
                    className="text-xs text-legacy-red hover:underline"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm text-legacy-blue-dark">
            <input
              type="checkbox"
              checked={treatAsSingle}
              onChange={(e) => setTreatAsSingle(e.target.checked)}
              className="mt-0.5"
            />
            This submittal covers multiple bundled items — treat as one submittal
          </label>

          <button
            type="submit"
            disabled={!file || phase.kind !== 'form'}
            className="rounded-md bg-legacy-blue-dark px-4 py-2.5 text-sm font-medium text-white hover:bg-legacy-blue-dark/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {phase.kind === 'uploading'
              ? 'Uploading…'
              : phase.kind === 'running'
                ? 'Checking…'
                : 'Check Submittal'}
          </button>
        </form>
      ) : phase.kind === 'needs_section' ? (
        <div className="max-w-xl space-y-3">
          <Banner tone="warn">
            AI predicted{' '}
            <strong>
              {phase.predictedSection ?? 'no section'}
              {phase.predictedTitle ? ` — ${phase.predictedTitle}` : ''}
            </strong>{' '}
            with {phase.confidence}% confidence — below the threshold to proceed
            automatically. {phase.reasoning}
          </Banner>
          <p className="text-sm font-medium text-legacy-blue-dark">
            Choose the correct spec section to continue:
          </p>
          <CsiSectionPicker
            sections={specs}
            value={null}
            onChange={(section) => void runPipeline(phase.submittalCheckId, section.csi_code)}
          />
        </div>
      ) : phase.kind === 'multi_product' ? (
        <div className="max-w-xl space-y-3">
          <Banner tone="warn">
            This looks like a multi-product package
            {phase.explanation ? `: ${phase.explanation}` : '.'} Separate the
            package and upload one product at a time, or re-upload with
            "treat as one submittal" checked if that's intentional.
          </Banner>
          <button
            type="button"
            onClick={resetForm}
            className="rounded-md bg-legacy-blue-dark px-4 py-2 text-sm font-medium text-white hover:bg-legacy-blue-dark/90"
          >
            Upload again
          </button>
        </div>
      ) : phase.kind === 'failed' ? (
        <div className="max-w-xl space-y-3">
          <Banner tone="error">Something went wrong: {phase.error}</Banner>
          <div className="flex gap-2">
            {phase.submittalCheckId && (
              <button
                type="button"
                onClick={() => void runPipeline(phase.submittalCheckId!)}
                className="rounded-md bg-legacy-blue-dark px-4 py-2 text-sm font-medium text-white hover:bg-legacy-blue-dark/90"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={resetForm}
              className="rounded-md border border-legacy-blue-light/30 px-4 py-2 text-sm text-legacy-blue-dark hover:bg-legacy-blue-light/10"
            >
              Start over
            </button>
          </div>
        </div>
      ) : (
        <ResultsView
          check={phase.check}
          specs={specs}
          onRerunDifferentSection={(check) =>
            setPhase({
              kind: 'needs_section',
              submittalCheckId: check.id,
              predictedSection: check.csi_section,
              predictedTitle: null,
              confidence: check.section_confidence ?? 0,
              reasoning: 'Manual re-selection.',
            })
          }
          onStartOver={resetForm}
        />
      )}
    </PageShell>
  )
}

function PageShell({
  children,
  projectName,
  onSyncSpecs,
  syncing,
  syncError,
}: {
  children: React.ReactNode
  projectName?: string
  onSyncSpecs?: () => void
  syncing?: boolean
  syncError?: string | null
}) {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link to="/home" className="text-xs text-legacy-blue-light hover:underline">
            ← Back to Tools
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-legacy-blue-dark">
            Submittal Checker
          </h1>
          {projectName && (
            <p className="text-sm text-legacy-blue-light">Project: {projectName}</p>
          )}
        </div>
        {onSyncSpecs && (
          <button
            type="button"
            onClick={onSyncSpecs}
            disabled={syncing}
            title={syncError ? `Last sync failed: ${syncError}` : undefined}
            className="shrink-0 rounded-md border border-legacy-blue-light/30 px-3 py-1.5 text-xs font-medium text-legacy-blue-dark hover:bg-legacy-blue-light/10 disabled:opacity-60"
          >
            {syncing ? 'Syncing…' : 'Sync Specs'}
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-md rounded-lg border border-legacy-blue-light/20 bg-white p-5 text-sm text-legacy-blue-dark/80">
      {children}
    </div>
  )
}

function Banner({
  tone,
  children,
}: {
  tone: 'warn' | 'error' | 'ok'
  children: React.ReactNode
}) {
  const styles =
    tone === 'error'
      ? 'border-legacy-red/40 bg-legacy-red/5 text-legacy-red'
      : tone === 'warn'
        ? 'border-legacy-red/30 bg-legacy-red/5 text-legacy-blue-dark'
        : 'border-legacy-blue-light/25 bg-legacy-blue-light/5 text-legacy-blue-dark'
  return <div className={`rounded-md border p-3 text-sm ${styles}`}>{children}</div>
}

function ResultsView({
  check,
  specs,
  onRerunDifferentSection,
  onStartOver,
}: {
  check: SubmittalCheck
  specs: SpecSection[]
  onRerunDifferentSection: (check: SubmittalCheck) => void
  onStartOver: () => void
}) {
  const sectionDisplay =
    specs.find((s) => s.csi_code === check.csi_section)?.csi_code_display ??
    (check.csi_section ? formatCsiCode(normalizeCsiCode(check.csi_section)) : '—')

  return (
    <div className="max-w-2xl space-y-5">
      <div className="text-sm text-legacy-blue-light">
        Section <span className="font-medium text-legacy-blue-dark">{sectionDisplay}</span>
        {check.section_source === 'ai_detected' && check.section_confidence !== null && (
          <> — AI-detected, {check.section_confidence}% confidence</>
        )}
        {check.section_source === 'user_selected' && <> — manually selected</>}
      </div>

      {check.low_confidence_warning && (
        <Banner tone="warn">
          Section confidence was borderline — double-check {sectionDisplay} is
          correct.{' '}
          <button
            type="button"
            onClick={() => onRerunDifferentSection(check)}
            className="font-medium underline"
          >
            Rerun with different section
          </button>
        </Banner>
      )}

      {check.score_percent !== null ? (
        <ScoreBar percent={check.score_percent} />
      ) : (
        <p className="text-sm text-legacy-blue-light">
          Every category was N/A for this section — no overall score to show.
        </p>
      )}

      <table className="w-full overflow-hidden rounded-md border border-legacy-blue-light/20 text-sm">
        <tbody>
          {CATEGORY_KEYS.map((key) => {
            const result = check.category_results?.[key]
            const isNa = !result || result.status === 'N/A'
            return (
              <tr key={key} className="border-b border-legacy-blue-light/10 last:border-b-0">
                <td className="w-8 px-3 py-2.5 text-center">
                  <StatusIcon status={result?.status} />
                </td>
                <td
                  className={`w-40 px-3 py-2.5 font-medium ${
                    isNa ? 'text-legacy-blue-light' : 'text-legacy-blue-dark'
                  }`}
                >
                  {CATEGORY_META[key].label}
                </td>
                <td className={isNa ? 'px-3 py-2.5 text-legacy-blue-light' : 'px-3 py-2.5 text-legacy-blue-dark/80'}>
                  {result?.notes ?? '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <button
        type="button"
        onClick={onStartOver}
        className="rounded-md border border-legacy-blue-light/30 px-4 py-2 text-sm text-legacy-blue-dark hover:bg-legacy-blue-light/10"
      >
        Check another submittal
      </button>
    </div>
  )
}

function ScoreBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent))
  const color = clamped >= 80 ? 'bg-emerald-500' : clamped >= 50 ? 'bg-amber-500' : 'bg-legacy-red'
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-legacy-blue-dark">Overall score</span>
        <span className="text-lg font-semibold text-legacy-blue-dark">
          {Math.round(clamped)}%
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-legacy-blue-light/15">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status?: string }) {
  if (!status || status === 'N/A') {
    return <span className="text-legacy-blue-light/50">–</span>
  }
  if (status === 'Pass') {
    return <span className="text-emerald-600">✓</span>
  }
  if (status === 'Caution') {
    return <span className="text-amber-500">!</span>
  }
  return <span className="text-legacy-red">✕</span>
}
