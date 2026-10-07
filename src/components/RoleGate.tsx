import { useState } from 'react'
import type { ReactNode } from 'react'
import { useProfile } from '../contexts/ProfileContext'
import { Modal } from './Modal'

const ROLES = [
  { value: 'pm', label: 'Project Manager' },
  { value: 'apm', label: 'Assistant Project Manager' },
] as const

/**
 * Nobody gets into the app without a role. While the signed-in user's `profiles.title` is null this
 * renders the "Choose your role" modal INSTEAD of the app — no page, header or route is mounted
 * behind it, so there is no way around it. The modal has no close button, ignores clicks outside it
 * and has no Escape handler. It applies to existing users with a null title as well as new ones.
 *
 * Sits inside the first-load gate, so it never shows while the app is still loading.
 */
export function RoleGate({ children }: { children: ReactNode }) {
  const { profile } = useProfile()
  if (profile && profile.title === null) return <ChooseRole />
  return <>{children}</>
}

function ChooseRole() {
  const { setTitle } = useProfile()
  const [choice, setChoice] = useState<'pm' | 'apm' | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  async function save() {
    if (!choice || saving) return
    setSaving(true)
    setFailed(false)
    const ok = await setTitle(choice)
    // On success the profile now has a title and this gate unmounts, so only a failure needs handling.
    if (!ok) {
      setFailed(true)
      setSaving(false)
    }
  }

  return (
    <div className="h-full min-h-screen bg-white">
      <Modal onClose={() => {}} closeOnBackdrop={false}>
        <div role="dialog" aria-modal="true" aria-labelledby="choose-role-title">
          <h2 id="choose-role-title" className="text-base font-semibold text-legacy-blue-dark">
            Choose your role
          </h2>
          <p className="mt-1 text-sm text-legacy-blue-light">
            Your role decides whether you are assigned as PM or APM when you are the first to add a
            project.
          </p>

          <div role="radiogroup" aria-label="Role" className="mt-4 space-y-2">
            {ROLES.map((role) => (
              <label
                key={role.value}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm text-legacy-blue-dark transition ${
                  choice === role.value
                    ? 'border-legacy-blue-dark bg-legacy-blue-light/10'
                    : 'border-legacy-blue-light/30 hover:border-legacy-blue-dark'
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value={role.value}
                  checked={choice === role.value}
                  onChange={() => setChoice(role.value)}
                  className="h-4 w-4 accent-legacy-blue-dark"
                />
                {role.label}
              </label>
            ))}
          </div>

          {failed && (
            <p role="alert" className="mt-3 text-sm text-legacy-red">
              Couldn’t save your role — try again.
            </p>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={!choice || saving}
            className="mt-4 rounded-full bg-legacy-blue-dark px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
