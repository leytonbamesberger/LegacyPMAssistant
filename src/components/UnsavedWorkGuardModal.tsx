import { useUnsavedWork } from '../contexts/UnsavedWorkContext'
import { useProject } from '../contexts/ProjectContext'

/**
 * Confirmation shown when switching the active project while a tool has
 * registered unsaved work via `useUnsavedWork`. Rendered by `ProjectProvider`
 * whenever it has a pending switch queued.
 */
export function UnsavedWorkGuardModal() {
  const { description } = useUnsavedWork()
  const { pendingSwitch, confirmPendingSwitch, cancelPendingSwitch } = useProject()

  if (!pendingSwitch) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-legacy-blue-dark/40 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-legacy-blue-dark">
          Unsaved work
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-legacy-blue-dark/80">
          You have unsaved work{description ? ` in ${description}` : ''}.
          Switching projects may lose this progress. Continue?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancelPendingSwitch}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-legacy-blue-dark hover:bg-legacy-blue-light/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmPendingSwitch}
            className="rounded-md bg-legacy-red px-3 py-1.5 text-sm font-medium text-white hover:bg-legacy-red/90"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
