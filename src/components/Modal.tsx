import type { ReactNode } from 'react'

/**
 * Shared overlay shell (backdrop click or the caller's own close control
 * dismisses it) — same visual language as UnsavedWorkGuardModal. Callers own
 * their own header/close button since content needs vary.
 */
export function Modal({
  onClose,
  children,
  maxWidthClassName = 'max-w-md',
}: {
  onClose: () => void
  children: ReactNode
  maxWidthClassName?: string
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-legacy-blue-dark/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${maxWidthClassName} max-h-[90vh] overflow-y-auto rounded-lg bg-white p-5 shadow-xl`}
      >
        {children}
      </div>
    </div>
  )
}
