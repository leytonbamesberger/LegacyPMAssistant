import { useEffect, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { useProfile } from '../contexts/ProfileContext'
import {
  fetchInitiationCatalog,
  initiateProject,
  type InitiationPayload,
} from '../lib/initiation'
import type { Project } from '../lib/projects'
import {
  EMPTY_SETUP,
  emptyRecurring,
  recurringScheduleValid,
  setupDatesState,
  toWizardItem,
  type RecurringConfig,
  type SetupConfig,
  type WizardItem,
} from '../lib/wizardItems'
import { Modal } from './Modal'
import { ProfileSearchSelect } from './ProfileSearchSelect'
import { inputClass, RecurringScheduleStep, SetupDatesStep } from './WizardSteps'

type Step = 1 | 2 | 3 | 4 | 5

const STEP_TITLE: Record<Step, string> = {
  1: 'Setup items',
  2: 'Setup due dates',
  3: 'Recurring items',
  4: 'Recurring schedule',
  5: 'Confirm PM / APM',
}

/**
 * Five-step project initiation wizard. All choices live in this component's
 * state and are sent in ONE call on the final Confirm — nothing is saved while
 * the wizard is open, so closing it halfway leaves the project untouched.
 */
export function InitiateProjectModal({
  project,
  onClose,
  onDone,
}: {
  project: Project
  onClose: () => void
  /** Called after a successful initiation, before the modal closes. */
  onDone: () => void
}) {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { directory } = useProfile()

  const [step, setStep] = useState<Step>(1)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [setupItems, setSetupItems] = useState<WizardItem[]>([])
  const [removedSetup, setRemovedSetup] = useState<WizardItem[]>([])
  const [recurringItems, setRecurringItems] = useState<WizardItem[]>([])
  const [removedRecurring, setRemovedRecurring] = useState<WizardItem[]>([])
  const [customCounter, setCustomCounter] = useState(0)

  const [setupConfig, setSetupConfig] = useState<Record<string, SetupConfig>>({})
  // One date for every non-meeting Setup item (they're tracked as a single bundle).
  const [setupCompleteBy, setSetupCompleteBy] = useState('')
  const [recurringConfig, setRecurringConfig] = useState<Record<string, RecurringConfig>>({})

  const [pmId, setPmId] = useState<string | null>(project.pm_id)
  const [apmId, setApmId] = useState<string | null>(project.apm_id)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!account) return
    let cancelled = false
    void (async () => {
      const catalog = await fetchInitiationCatalog(instance, account, project.id)
      if (cancelled) return
      if (!catalog) {
        setLoadError('Could not load the checklist — close this and try again.')
      } else if (catalog.initiated) {
        setLoadError('This project has already been initiated.')
      } else {
        const bucket = (phase: 'setup' | 'recurring', excluded: boolean) =>
          catalog.items
            .filter((i) => i.phase === phase && i.excluded === excluded)
            .map(toWizardItem)
        setSetupItems(bucket('setup', false))
        setRemovedSetup(bucket('setup', true))
        setRecurringItems(bucket('recurring', false))
        setRemovedRecurring(bucket('recurring', true))
        setPmId(catalog.pm_id)
        setApmId(catalog.apm_id)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [instance, account, project.id])

  const getSetup = (key: string): SetupConfig => setupConfig[key] ?? EMPTY_SETUP
  const patchSetup = (key: string, patch: Partial<SetupConfig>) =>
    setSetupConfig((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_SETUP), ...patch } }))

  const getRecurring = (item: WizardItem): RecurringConfig => recurringConfig[item.key] ?? emptyRecurring(item)
  const patchRecurring = (item: WizardItem, patch: Partial<RecurringConfig>) =>
    setRecurringConfig((prev) => ({ ...prev, [item.key]: { ...getRecurring(item), ...patch } }))

  function addCustom(
    phase: 'setup' | 'recurring',
    name: string,
  ): string | null {
    const trimmed = name.trim()
    if (!trimmed) return null
    const items = phase === 'setup' ? setupItems : recurringItems
    if (items.some((i) => i.name.toLowerCase() === trimmed.toLowerCase())) {
      return `"${trimmed}" is already on the list`
    }
    const item: WizardItem = {
      key: `new-${customCounter}`,
      itemId: null,
      name: trimmed,
      isMeeting: false,
      defaultCadence: { value: 1, unit: 'week' },
    }
    setCustomCounter((n) => n + 1)
    if (phase === 'setup') setSetupItems((prev) => [...prev, item])
    else setRecurringItems((prev) => [...prev, item])
    return null
  }

  function removeItem(phase: 'setup' | 'recurring', item: WizardItem) {
    const [setItems, setRemoved] =
      phase === 'setup' ? [setSetupItems, setRemovedSetup] : [setRecurringItems, setRemovedRecurring]
    setItems((prev) => prev.filter((i) => i.key !== item.key))
    // A custom item that never existed server-side just disappears; a catalog item can be added back.
    if (item.itemId) setRemoved((prev) => [...prev, item])
  }

  function restoreItem(phase: 'setup' | 'recurring', item: WizardItem) {
    const [setItems, setRemoved] =
      phase === 'setup' ? [setSetupItems, setRemovedSetup] : [setRecurringItems, setRemovedRecurring]
    setRemoved((prev) => prev.filter((i) => i.key !== item.key))
    setItems((prev) => [...prev, item])
  }

  const { meetingComplete, valid: setupDatesValid } = setupDatesState(setupItems, getSetup, setupCompleteBy)
  const recurringValid = recurringScheduleValid(recurringItems, getRecurring)

  const canAdvance =
    step === 2 ? setupDatesValid : step === 4 ? recurringValid : true

  async function handleConfirm() {
    if (!account || submitting) return
    setSubmitting(true)
    setSubmitError(null)

    const payload: InitiationPayload = {
      projectId: project.id,
      pmId,
      apmId,
      setup: setupItems.map((item) => {
        const cfg = getSetup(item.key)
        return {
          itemId: item.itemId,
          newName: item.itemId ? null : item.name,
          // A meeting date completes the meeting, as does Done.
          isComplete: item.isMeeting ? meetingComplete(item.key) : cfg.complete,
          // Every setup task, meetings included, is due on "Setup complete by" (null when it was left
          // blank because everything is complete). A meeting's own date is separate.
          dueDate: setupCompleteBy || null,
          meetingDate: item.isMeeting ? cfg.date || null : null,
          isTbd: item.isMeeting && cfg.tbd && !meetingComplete(item.key),
        }
      }),
      recurring: recurringItems.map((item) => {
        const cfg = getRecurring(item)
        return {
          itemId: item.itemId,
          newName: item.itemId ? null : item.name,
          startDate: cfg.startDate,
          cadenceValue: Number(cfg.value),
          cadenceUnit: cfg.unit,
        }
      }),
    }

    const result = await initiateProject(instance, account, payload)
    setSubmitting(false)
    if (!result.ok) {
      setSubmitError(result.error)
      return
    }
    onDone()
    onClose()
  }

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-2xl" closeOnBackdrop={false}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-legacy-blue-dark">
            Initiate {project.job_number ? `${project.job_number} — ` : ''}
            {project.name}
          </h2>
          {!loadError && !loading && (
            <p className="mt-0.5 text-xs text-legacy-blue-light">
              Step {step} of 5 — {STEP_TITLE[step]}
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

      {loading ? (
        <p className="mt-4 text-sm text-legacy-blue-light">Loading…</p>
      ) : loadError ? (
        <p className="mt-4 text-sm text-legacy-red">{loadError}</p>
      ) : (
        <>
          <div className="mt-4">
            {step === 1 && (
              <ItemListStep
                intro="Remove any Setup items that don't apply to this project, or add your own."
                items={setupItems}
                removed={removedSetup}
                onRemove={(item) => removeItem('setup', item)}
                onRestore={(item) => restoreItem('setup', item)}
                onAddCustom={(name) => addCustom('setup', name)}
              />
            )}

            {step === 2 && (
              <SetupDatesStep
                intro={
                  'Tick Done for anything already complete. Set the date by which setup should be finished. Enter meeting dates, or leave meetings TBD.'
                }
                items={setupItems}
                getSetup={getSetup}
                patchSetup={patchSetup}
                completeBy={setupCompleteBy}
                onCompleteBy={setSetupCompleteBy}
              />
            )}

            {step === 3 && (
              <ItemListStep
                intro="Remove any Recurring items that don't apply to this project, or add your own."
                items={recurringItems}
                removed={removedRecurring}
                onRemove={(item) => removeItem('recurring', item)}
                onRestore={(item) => restoreItem('recurring', item)}
                onAddCustom={(name) => addCustom('recurring', name)}
              />
            )}

            {step === 4 && (
              <RecurringScheduleStep
                intro="Choose when each item first comes due and how often it repeats."
                items={recurringItems}
                getRecurring={getRecurring}
                patchRecurring={patchRecurring}
              />
            )}

            {step === 5 && (
              <div className="space-y-3">
                <p className="text-sm text-legacy-blue-light">
                  These people are assigned every task generated for this project. Auto-filled from
                  who Added it; change either one here.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ProfileSearchSelect label="PM" value={pmId} directory={directory} onChange={setPmId} />
                  <ProfileSearchSelect label="APM" value={apmId} directory={directory} onChange={setApmId} />
                </div>
                {!pmId && !apmId && (
                  <p className="text-xs text-legacy-red">
                    No PM or APM is set — the generated tasks won't be assigned to anyone.
                  </p>
                )}
                <p className="text-xs text-legacy-blue-light">
                  Confirming creates {setupItems.length} Setup and {recurringItems.length} Recurring
                  task{setupItems.length + recurringItems.length === 1 ? '' : 's'}.
                </p>
              </div>
            )}
          </div>

          {submitError && <p className="mt-3 text-sm text-legacy-red">{submitError}</p>}

          <div className="mt-5 flex items-center justify-between border-t border-legacy-blue-light/15 pt-3">
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as Step)}
              disabled={step === 1 || submitting}
              className="rounded-full border border-legacy-blue-light/30 px-3 py-1.5 text-xs font-medium text-legacy-blue-dark hover:border-legacy-blue-dark disabled:opacity-40"
            >
              Back
            </button>
            {step < 5 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s + 1) as Step)}
                disabled={!canAdvance}
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
                {submitting ? 'Initiating…' : 'Confirm & Initiate'}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

/** Steps 1 and 3: the include/exclude list for one phase, with custom-item entry and "add back". */
function ItemListStep({
  intro,
  items,
  removed,
  onRemove,
  onRestore,
  onAddCustom,
}: {
  intro: string
  items: WizardItem[]
  removed: WizardItem[]
  onRemove: (item: WizardItem) => void
  onRestore: (item: WizardItem) => void
  /** Returns an error message if the name can't be added. */
  onAddCustom: (name: string) => string | null
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleAdd() {
    const result = onAddCustom(name)
    setError(result)
    if (!result) setName('')
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-legacy-blue-light">{intro}</p>

      <ul className="divide-y divide-legacy-blue-light/15 rounded-md border border-legacy-blue-light/20">
        {items.length === 0 && (
          <li className="px-3 py-3 text-sm text-legacy-blue-light">Nothing selected.</li>
        )}
        {items.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-sm text-legacy-blue-dark">
              {item.name}
              {!item.itemId && <span className="ml-1.5 text-xs text-legacy-blue-light">(custom)</span>}
            </span>
            <button
              type="button"
              onClick={() => onRemove(item)}
              title="Remove from this project"
              className="px-1 text-sm text-legacy-blue-light hover:text-legacy-red"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            placeholder="Add a custom item…"
            className={`${inputClass} flex-1`}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!name.trim()}
            className="rounded-full border border-legacy-blue-light/30 px-3 py-1 text-xs font-medium text-legacy-blue-dark hover:border-legacy-blue-dark disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-legacy-red">{error}</p>}
      </div>

      {removed.length > 0 && (
        <div>
          <p className="text-xs font-medium text-legacy-blue-light">Removed</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {removed.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onRestore(item)}
                  title="Add back"
                  className="rounded-full border border-legacy-blue-light/30 px-2.5 py-0.5 text-xs text-legacy-blue-light hover:border-legacy-blue-dark hover:text-legacy-blue-dark"
                >
                  + {item.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
