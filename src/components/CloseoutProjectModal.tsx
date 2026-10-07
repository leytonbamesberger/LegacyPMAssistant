import { useEffect, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import {
  closeoutProject,
  fetchProjectEditCatalog,
  type Project,
  type ProjectEditCatalog,
} from '../lib/projects'
import { Modal } from './Modal'
import { inputClass } from './WizardSteps'

type Step = 1 | 2

/**
 * Closeout Project (initiated projects only), a two-step wizard:
 *  1. which of the closeout items apply, each with its own due date;
 *  2. confirm — with, the FIRST time only, a pre-checked "Stop recurring tasks for this project".
 *
 * Confirming creates one `closeout` task per item (assigned to the PM/APM) and sets the project to
 * 'closing'. The project stays in the app; nothing is removed from Procore or the database. Opening it
 * again later pre-fills the current selection: complete items are locked, an open one can be unchecked
 * (its task is deleted) or given a new date, and a new one can be added.
 */
export function CloseoutProjectModal({
  project,
  onClose,
  onDone,
}: {
  project: Project
  onClose: () => void
  /** Called after a successful save, before the modal closes. */
  onDone: () => void
}) {
  const { instance, accounts } = useMsal()
  const account = accounts[0]

  const [catalog, setCatalog] = useState<ProjectEditCatalog | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>(1)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [dueDates, setDueDates] = useState<Record<string, string>>({})
  const [stopRecurring, setStopRecurring] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!account) return
    let cancelled = false
    void (async () => {
      const result = await fetchProjectEditCatalog(instance, account, project.id)
      if (cancelled) return
      if (!result) {
        setLoadError('Could not load the project — close this and try again.')
      } else if (!result.project.initiated) {
        setLoadError('Initiate this project before closing it out.')
      } else {
        setCatalog(result)
        setSelected(Object.fromEntries(result.closeout.map((c) => [c.id, c.selected])))
        setDueDates(Object.fromEntries(result.closeout.map((c) => [c.id, c.dueDate ?? ''])))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [instance, account, project.id])

  const items = catalog?.closeout ?? []
  // The stop-recurring box belongs to the first closeout only; a project already 'closing' is being re-opened.
  const firstTime = catalog?.project.status === 'active'
  const chosen = items.filter((c) => selected[c.id])
  const datesValid = chosen.every((c) => c.locked || /^\d{4}-\d{2}-\d{2}$/.test(dueDates[c.id] ?? ''))
  const removing = items.filter((c) => c.selected && !c.locked && !selected[c.id])

  async function handleConfirm() {
    if (!account || !catalog || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    const result = await closeoutProject(instance, account, {
      projectId: project.id,
      // Complete (locked) items are never resent: the server leaves them alone.
      items: chosen.filter((c) => !c.locked).map((c) => ({ itemId: c.id, dueDate: dueDates[c.id] })),
      stopRecurring: firstTime && stopRecurring,
    })
    setSubmitting(false)
    if (!result.ok) {
      setSubmitError(result.error)
      return
    }
    onDone()
    onClose()
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-lg" closeOnBackdrop={false}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-legacy-blue-dark">
            Closeout {project.job_number ? `${project.job_number} — ` : ''}
            {project.name}
          </h2>
          {catalog && (
            <p className="mt-0.5 text-xs text-legacy-blue-light">
              Step {step} of 2 — {step === 1 ? 'Closeout items' : 'Confirm'}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-legacy-blue-light hover:text-legacy-red"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {loadError ? (
        <p className="mt-4 text-sm text-legacy-red">{loadError}</p>
      ) : !catalog ? (
        <p className="mt-4 text-sm text-legacy-blue-light">Loading…</p>
      ) : (
        <>
          <div className="mt-4">
            {step === 1 && (
              <div className="space-y-3">
                <p className="text-sm text-legacy-blue-light">
                  Pick the closeout items that apply to this project and give each one its own due date.
                </p>
                <ul className="divide-y divide-legacy-blue-light/15 rounded-md border border-legacy-blue-light/20">
                  {items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <label
                        className={`flex min-w-[12rem] flex-1 items-center gap-2 text-sm ${
                          item.locked ? 'cursor-not-allowed text-legacy-blue-light' : 'cursor-pointer text-legacy-blue-dark'
                        }`}
                        title={item.locked ? 'Already complete — can’t be removed' : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={!!selected[item.id]}
                          disabled={item.locked}
                          onChange={(e) => setSelected((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                          className="h-3.5 w-3.5 shrink-0 accent-legacy-blue-dark"
                        />
                        <span>
                          {item.name}
                          {item.locked && <span className="ml-1.5 text-xs">(complete)</span>}
                        </span>
                      </label>
                      <input
                        type="date"
                        value={dueDates[item.id] ?? ''}
                        disabled={!selected[item.id] || item.locked}
                        onChange={(e) => setDueDates((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        aria-label={`${item.name} due date`}
                        aria-required={!!selected[item.id]}
                        className={`${inputClass} w-[9.5rem] disabled:bg-legacy-blue-light/10`}
                      />
                    </li>
                  ))}
                </ul>
                {chosen.some((c) => !c.locked && !dueDates[c.id]) && (
                  <p className="text-xs text-legacy-red">Each selected item needs a due date.</p>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3 text-sm text-legacy-blue-dark">
                <p>
                  {chosen.length === 0
                    ? 'No closeout tasks will be created.'
                    : `Closeout task${chosen.length === 1 ? '' : 's'} for ${project.name}:`}
                </p>
                {chosen.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-5">
                    {chosen.map((c) => (
                      <li key={c.id}>
                        {c.name}
                        <span className="text-legacy-blue-light">
                          {c.locked ? ' — complete' : ` — due ${dueDates[c.id]}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {removing.length > 0 && (
                  <p className="text-legacy-red">
                    Will remove (open, now unchecked): {removing.map((c) => c.name).join(', ')}
                  </p>
                )}
                <p className="text-xs text-legacy-blue-light">
                  The tasks go to the project's PM and APM. The project is marked as closing but stays in the
                  app, and nothing is removed from Procore.
                </p>
                {firstTime && (
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border border-legacy-blue-light/25 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={stopRecurring}
                      onChange={(e) => setStopRecurring(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 accent-legacy-blue-dark"
                    />
                    <span>
                      Stop recurring tasks for this project
                      <span className="block text-xs text-legacy-blue-light">
                        Removes its open recurring tasks and stops new ones; completed history stays. Setup
                        tasks and FLOW aren't affected either way.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>

          {submitError && <p className="mt-3 text-sm text-legacy-red">{submitError}</p>}

          <div className="mt-5 flex items-center justify-between border-t border-legacy-blue-light/15 pt-3">
            <button
              type="button"
              onClick={() => (step === 1 ? onClose() : setStep(1))}
              disabled={submitting}
              className="rounded-full border border-legacy-blue-light/30 px-3 py-1.5 text-xs font-medium text-legacy-blue-dark hover:border-legacy-blue-dark disabled:opacity-40"
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            {step === 1 ? (
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!datesValid}
                className="rounded-full bg-legacy-blue-dark px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={submitting}
                className="rounded-full bg-legacy-red px-4 py-1.5 text-xs font-medium text-white disabled:opacity-60"
              >
                {submitting ? 'Saving…' : firstTime ? 'Close out project' : 'Save'}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
