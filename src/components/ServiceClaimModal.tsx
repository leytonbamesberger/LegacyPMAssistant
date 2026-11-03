import { useState } from 'react'
import { useProject } from '../contexts/ProjectContext'
import { Modal } from './Modal'

/**
 * Shown when a Service user's Add is about to claim a project that has no service salesman: it asks for
 * the optional due date of the "Meet with owner/client" task. Cancel aborts the whole Add; a blank date is
 * fine. Rendered once by AppShell and driven by ProjectContext's `pendingClaim`, so the left-hand Projects
 * list and the Available Projects tab share it.
 */
export function ServiceClaimModal() {
  const { pendingClaim, confirmClaim, cancelClaim } = useProject()
  if (!pendingClaim) return null
  return <ClaimForm key={pendingClaim.id} onConfirm={confirmClaim} onCancel={cancelClaim} projectName={pendingClaim.name} />
}

function ClaimForm({
  projectName,
  onConfirm,
  onCancel,
}: {
  projectName: string
  onConfirm: (dueDate: string | null) => Promise<void>
  onCancel: () => void
}) {
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  // A native date input reports '' until the date is complete and valid; only a real year is sent.
  const valid = dueDate === '' || (/^\d{4}-\d{2}-\d{2}$/.test(dueDate) && Number(dueDate.slice(0, 4)) >= 1900)

  async function submit() {
    if (busy || !valid) return
    setBusy(true)
    await onConfirm(dueDate || null)
  }

  return (
    <Modal onClose={onCancel} closeOnBackdrop={false}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h2 className="text-base font-semibold text-legacy-blue-dark">Meet with the owner/client</h2>
        <p className="mt-1 text-sm text-legacy-blue-light">
          Adding {projectName} makes you its service salesman and creates a task for this meeting.
        </p>
        <label className="mt-4 block text-xs font-medium text-legacy-blue-light">
          Due date (optional)
          <input
            type="date"
            autoFocus
            value={dueDate}
            min="1900-01-01"
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 block rounded-md border border-legacy-blue-light/30 px-2 py-1.5 text-sm text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
          />
        </label>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-legacy-blue-light/30 px-3 py-1.5 text-xs font-medium text-legacy-blue-dark hover:border-legacy-blue-dark disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !valid}
            className="rounded-full bg-legacy-blue-dark px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {busy ? 'Adding…' : 'Add Project'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
