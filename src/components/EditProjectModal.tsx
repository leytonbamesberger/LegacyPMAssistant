import { useEffect, useMemo, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { useProfile } from '../contexts/ProfileContext'
import { localToday } from '../lib/dates'
import {
  editProject,
  fetchProjectEditCatalog,
  type EditCatalogItem,
  type Project,
  type ProjectEditCatalog,
} from '../lib/projects'
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
import {
  datesPayload,
  datesValid,
  EditDatesTab,
  hasDateChanges,
  initialDatesState,
  type DatesState,
} from './EditProjectDates'
import { Modal } from './Modal'
import { ProfileSearchSelect } from './ProfileSearchSelect'
import { RecurringScheduleStep, SetupDatesStep } from './WizardSteps'

type Step = 'main' | 'setup' | 'recurring'
type Tab = 'people' | 'tasks' | 'dates'

const TABS: { id: Tab; label: string }[] = [
  { id: 'people', label: 'People' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'dates', label: 'Dates' },
]

/**
 * Edit Project: change a project's PM / APM, which Setup and Recurring items apply to it, and its open
 * tasks' dates, after it was initiated. The first step is three tabs (People, Tasks, Dates) with one Save
 * for all of them. Built from the initiation wizard's pieces — the same PM/APM picker and the same Setup
 * dates / Recurring schedule steps (components/WizardSteps.tsx). Nothing is saved until the final Save.
 *
 *  - Unchecking an open item removes it (its open task is deleted and, for a recurring item, no further
 *    instance is created). An item whose task is already complete is locked on.
 *  - Checking an item that isn't on the project opens a follow-up step for what the wizard would ask
 *    (Setup: a due date, plus a date / TBD / Done for a meeting; Recurring: start date and cadence).
 *  - Dates tab: open items are editable, completed ones read-only (meetings excepted — see EditProjectDates).
 *  - An uninitiated project can only have its PM and APM changed (no tabs, no Dates).
 *  - Service Salesman: PM / APM users get the field on the People tab (searchable over people with the Service
 *    role, clearable); a Service user sees only that field, with a "Me" shortcut — no PM / APM, Tasks or Dates.
 *    Taking the slot from empty to a person creates the "Meet with owner/client" task, so the optional due date
 *    for it is asked right under the field.
 */
export function EditProjectModal({
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
  const { directory, profile } = useProfile()
  const isService = profile?.title === 'service'

  const [catalog, setCatalog] = useState<ProjectEditCatalog | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('main')
  const [tab, setTab] = useState<Tab>('people')
  const [datesState, setDatesState] = useState<DatesState | null>(null)

  const [pmId, setPmId] = useState<string | null>(project.pm_id)
  const [apmId, setApmId] = useState<string | null>(project.apm_id)
  const [serviceId, setServiceId] = useState<string | null>(project.service_id)
  /** Due date (YYYY-MM-DD, '' = none) of the meet-the-owner task a new salesman gets. */
  const [serviceDueDate, setServiceDueDate] = useState('')
  /** Checked state per catalog item id (initialised from what the project has now). */
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [setupConfig, setSetupConfig] = useState<Record<string, SetupConfig>>({})
  const [setupCompleteBy, setSetupCompleteBy] = useState('')
  const [recurringConfig, setRecurringConfig] = useState<Record<string, RecurringConfig>>({})

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
        return
      }
      setCatalog(result)
      setPmId(result.project.pm_id)
      setApmId(result.project.apm_id)
      setServiceId(result.project.service_id)
      setChecked(Object.fromEntries(result.items.map((i) => [i.id, i.state === 'included'])))
      // Added Setup items default to the project's existing open setup due date, else today.
      setSetupCompleteBy(result.setupDueDate ?? localToday())
      setDatesState(initialDatesState(result))
    })()
    return () => {
      cancelled = true
    }
  }, [instance, account, project.id])

  const items = catalog?.items ?? []
  const initiated = catalog?.project.initiated ?? project.initiated
  const setupAll = items.filter((i) => i.phase === 'setup')
  const recurringAll = items.filter((i) => i.phase === 'recurring')

  const isAdded = (i: EditCatalogItem) => !!checked[i.id] && i.state !== 'included'
  const isRemoved = (i: EditCatalogItem) => !checked[i.id] && i.state === 'included'
  const addedSetup = useMemo(() => setupAll.filter(isAdded).map(toWizardItem), [setupAll, checked]) // eslint-disable-line react-hooks/exhaustive-deps
  const addedRecurring = useMemo(() => recurringAll.filter(isAdded).map(toWizardItem), [recurringAll, checked]) // eslint-disable-line react-hooks/exhaustive-deps
  const removed = items.filter(isRemoved)

  const getSetup = (key: string): SetupConfig => setupConfig[key] ?? EMPTY_SETUP
  const patchSetup = (key: string, patch: Partial<SetupConfig>) =>
    setSetupConfig((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_SETUP), ...patch } }))
  const getRecurring = (item: WizardItem): RecurringConfig => recurringConfig[item.key] ?? emptyRecurring(item)
  const patchRecurring = (item: WizardItem, patch: Partial<RecurringConfig>) =>
    setRecurringConfig((prev) => ({ ...prev, [item.key]: { ...getRecurring(item), ...patch } }))

  const setupState = setupDatesState(addedSetup, getSetup, setupCompleteBy, true)
  const setupValid = setupState.valid
  const recurringValid = recurringScheduleValid(addedRecurring, getRecurring)

  // The follow-up steps this edit needs, in order. Save lands on the last one.
  const steps: Step[] = [
    'main',
    ...(addedSetup.length > 0 ? (['setup'] as const) : []),
    ...(addedRecurring.length > 0 ? (['recurring'] as const) : []),
  ]
  const stepIndex = Math.max(0, steps.indexOf(step))
  const isLast = stepIndex === steps.length - 1
  const canAdvance = step === 'setup' ? setupValid : step === 'recurring' ? recurringValid : true

  const removedIds = new Set(removed.map((i) => i.id))
  // A Service user has no Dates tab, so a blank date there must never block their save.
  const dateEdits = catalog && datesState && initiated && !isService ? datesPayload(catalog, datesState, removedIds) : null
  const datesOk = !catalog || !datesState || !initiated || isService || datesValid(catalog, datesState, removedIds)

  const personChanged = !!catalog && (pmId !== catalog.project.pm_id || apmId !== catalog.project.apm_id)
  const serviceChanged = !!catalog && serviceId !== catalog.project.service_id
  // Empty -> a person makes the meet-the-owner task, which is what the due date is for.
  const claimingService = serviceChanged && !!serviceId && catalog?.project.service_id === null
  // People with the Service role, plus the current salesman even if they have since switched roles.
  const serviceChoices = useMemo(
    () => directory.filter((p) => p.title === 'service' || p.id === catalog?.project.service_id),
    [directory, catalog?.project.service_id],
  )
  const dirty =
    personChanged ||
    serviceChanged ||
    removed.length > 0 ||
    addedSetup.length + addedRecurring.length > 0 ||
    (!!dateEdits && hasDateChanges(dateEdits))
  const saveBlocked = !canAdvance || !datesOk

  async function handleSave() {
    if (!account || !catalog || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    const result = await editProject(instance, account, {
      projectId: project.id,
      pmId: pmId !== catalog.project.pm_id ? pmId : undefined,
      apmId: apmId !== catalog.project.apm_id ? apmId : undefined,
      serviceId: serviceChanged ? serviceId : undefined,
      serviceDueDate: claimingService && serviceDueDate ? serviceDueDate : undefined,
      removeItemIds: removed.map((i) => i.id),
      addSetup: addedSetup.map((item) => {
        const cfg = getSetup(item.key)
        return {
          itemId: item.itemId,
          newName: null,
          // A meeting date completes the meeting, as does Done.
          isComplete: item.isMeeting ? setupState.meetingComplete(item.key) : cfg.complete,
          dueDate: setupCompleteBy || null,
          meetingDate: item.isMeeting ? cfg.date || null : null,
          isTbd: item.isMeeting && cfg.tbd && !setupState.meetingComplete(item.key),
        }
      }),
      addRecurring: addedRecurring.map((item) => {
        const cfg = getRecurring(item)
        return {
          itemId: item.itemId,
          newName: null,
          startDate: cfg.startDate,
          cadenceValue: Number(cfg.value),
          cadenceUnit: cfg.unit,
        }
      }),
      dates: dateEdits && hasDateChanges(dateEdits) ? dateEdits : undefined,
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
    <Modal onClose={onClose} maxWidthClassName="max-w-2xl" closeOnBackdrop={false}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-legacy-blue-dark">
            Edit {project.job_number ? `${project.job_number} — ` : ''}
            {project.name}
          </h2>
          {catalog && steps.length > 1 && (
            <p className="mt-0.5 text-xs text-legacy-blue-light">
              Step {stepIndex + 1} of {steps.length} —{' '}
              {step === 'main' ? 'People, tasks and dates' : step === 'setup' ? 'Added Setup items' : 'Added Recurring items'}
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
            {step === 'main' && initiated && !isService && (
              <div role="tablist" aria-label="Edit project" className="mb-4 flex gap-1 border-b border-legacy-blue-light/20">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`edit-tab-${t.id}`}
                    aria-selected={tab === t.id}
                    aria-controls={`edit-panel-${t.id}`}
                    onClick={() => setTab(t.id)}
                    className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
                      tab === t.id
                        ? 'border-legacy-blue-dark text-legacy-blue-dark'
                        : 'border-transparent text-legacy-blue-light hover:text-legacy-blue-dark'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {step === 'main' && (
              <div className="space-y-5">
                {(!initiated || tab === 'people') && (
                  <div role="tabpanel" id="edit-panel-people" aria-labelledby="edit-tab-people">
                    {!isService && (
                      <>
                        <p className="text-sm text-legacy-blue-light">
                          Changing the PM or APM moves this project's open Setup, Recurring and Closeout tasks to
                          the new person. Completed tasks stay as they are.
                        </p>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <ProfileSearchSelect label="PM" value={pmId} directory={directory} onChange={setPmId} />
                          <ProfileSearchSelect label="APM" value={apmId} directory={directory} onChange={setApmId} />
                        </div>
                      </>
                    )}
                    <div className={isService ? '' : 'mt-4'}>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <ProfileSearchSelect
                            label="Service Salesman"
                            value={serviceId}
                            directory={serviceChoices}
                            onChange={setServiceId}
                          />
                          {isService && profile && serviceId !== profile.id && (
                            <button
                              type="button"
                              onClick={() => setServiceId(profile.id)}
                              className="mt-1.5 text-xs font-medium text-legacy-blue-dark underline underline-offset-2 hover:no-underline"
                            >
                              Me
                            </button>
                          )}
                        </div>
                        {claimingService && (
                          <label className="block text-xs font-medium text-legacy-blue-light">
                            Meet with owner/client — due date (optional)
                            <input
                              type="date"
                              value={serviceDueDate}
                              min="1900-01-01"
                              onChange={(e) => setServiceDueDate(e.target.value)}
                              className="mt-1 block w-full rounded-md border border-legacy-blue-light/30 px-2 py-1.5 text-sm text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
                            />
                          </label>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-legacy-blue-light">
                        Choosing a salesman for a project that has none creates their "Meet with owner/client" task. Changing
                        it moves the open task to the new person; clearing it leaves the open task where it is.
                      </p>
                    </div>
                  </div>
                )}

                {initiated && !isService && tab === 'dates' && datesState && (
                  <div role="tabpanel" id="edit-panel-dates" aria-labelledby="edit-tab-dates">
                    <EditDatesTab catalog={catalog} state={datesState} onChange={setDatesState} removed={removedIds} />
                  </div>
                )}

                {isService ? null : initiated ? (
                  tab === 'tasks' && (
                    <div className="space-y-5" role="tabpanel" id="edit-panel-tasks" aria-labelledby="edit-tab-tasks">
                      <Checklist
                        title="Setup items"
                        items={setupAll}
                        checked={checked}
                        onToggle={(id, value) => setChecked((prev) => ({ ...prev, [id]: value }))}
                      />
                      <Checklist
                        title="Recurring items"
                        items={recurringAll}
                        checked={checked}
                        onToggle={(id, value) => setChecked((prev) => ({ ...prev, [id]: value }))}
                      />
                      <div className="space-y-1 text-xs text-legacy-blue-light">
                        <p>
                          Unchecking an open item deletes its open task (a recurring item also stops coming
                          back). Items that are already complete are locked. Checking an item that isn't on the
                          project asks for its dates next.
                        </p>
                        {removed.length > 0 && (
                          <p className="font-medium text-legacy-red">
                            Will remove: {removed.map((i) => i.name).join(', ')}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                ) : (
                  <p className="text-xs text-legacy-blue-light">
                    This project hasn't been initiated yet, so only its PM and APM can be changed here.
                  </p>
                )}
              </div>
            )}

            {step === 'setup' && (
              <SetupDatesStep
                intro="These Setup items are new to the project. Set the date they should be finished by; tick Done for any that are already complete, and give meetings a date or mark them TBD."
                items={addedSetup}
                getSetup={getSetup}
                patchSetup={patchSetup}
                completeBy={setupCompleteBy}
                onCompleteBy={setSetupCompleteBy}
                requireDate
              />
            )}

            {step === 'recurring' && (
              <RecurringScheduleStep
                intro="Choose when each added item first comes due and how often it repeats."
                items={addedRecurring}
                getRecurring={getRecurring}
                patchRecurring={patchRecurring}
              />
            )}
          </div>

          {!datesOk && (
            <p className="mt-3 text-sm text-legacy-red">
              Some dates on the Dates tab are blank or have a cadence that isn't a positive whole number.
            </p>
          )}
          {submitError && <p className="mt-3 text-sm text-legacy-red">{submitError}</p>}

          <div className="mt-5 flex items-center justify-between border-t border-legacy-blue-light/15 pt-3">
            <button
              type="button"
              onClick={() => (stepIndex === 0 ? onClose() : setStep(steps[stepIndex - 1]))}
              disabled={submitting}
              className="rounded-full border border-legacy-blue-light/30 px-3 py-1.5 text-xs font-medium text-legacy-blue-dark hover:border-legacy-blue-dark disabled:opacity-40"
            >
              {stepIndex === 0 ? 'Cancel' : 'Back'}
            </button>
            {isLast ? (
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={submitting || !dirty || saveBlocked}
                className="rounded-full bg-legacy-blue-dark px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {submitting ? 'Saving…' : 'Save'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStep(steps[stepIndex + 1])}
                disabled={saveBlocked}
                className="rounded-full bg-legacy-blue-dark px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                Next
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

/** One phase's items as checkboxes: included ones start checked, complete Setup items are locked on. */
function Checklist({
  title,
  items,
  checked,
  onToggle,
}: {
  title: string
  items: EditCatalogItem[]
  checked: Record<string, boolean>
  onToggle: (id: string, value: boolean) => void
}) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold uppercase tracking-wide text-legacy-blue-light">{title}</legend>
      <ul className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {items.length === 0 && <li className="text-sm text-legacy-blue-light">None.</li>}
        {items.map((item) => (
          <li key={item.id}>
            <label
              className={`flex items-center gap-2 py-1 text-sm ${
                item.locked ? 'cursor-not-allowed text-legacy-blue-light' : 'cursor-pointer text-legacy-blue-dark'
              }`}
              title={item.locked ? 'Already complete — can’t be removed' : undefined}
            >
              <input
                type="checkbox"
                checked={!!checked[item.id]}
                disabled={item.locked}
                onChange={(e) => onToggle(item.id, e.target.checked)}
                className="h-3.5 w-3.5 shrink-0 accent-legacy-blue-dark"
              />
              <span className="min-w-0 break-words">
                {item.name}
                {item.project_id && <span className="ml-1.5 text-xs text-legacy-blue-light">(custom)</span>}
                {item.locked && <span className="ml-1.5 text-xs">(complete)</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}
