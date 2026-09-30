import type { ReactNode } from 'react'
import { ChevronIcon } from './icons'

/**
 * Shared shell for the calendar and checklist panels: slides out from the
 * right edge below the header (top-16, matching AppShell's fixed h-16
 * header) so the header's own toggle buttons + profile menu stay visible and
 * clickable while a panel is open. The backdrop only covers the area below
 * the header, so clicking the visible page to the left of the panel closes
 * it (clicking inside the panel does not, since the panel sits on top of the
 * backdrop at the same screen coordinates). Closed via a left-edge tab
 * handle (not a top-right X) that peeks out over the page.
 */
export function SlideOutPanel({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  return (
    <>
      <div
        className={`fixed inset-x-0 bottom-0 top-16 z-40 bg-legacy-blue-dark/20 transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`fixed right-0 top-16 z-50 flex h-[calc(100vh-4rem)] w-[92vw] max-w-6xl transform flex-col border-l border-legacy-blue-light/15 bg-white shadow-xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!open}
      >
        {/* z-30: must render above any sticky content the panel body scrolls (the checklist
            grid's sticky header/column cells go up to z-20), not just above the panel's own
            static content. */}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title.toLowerCase()}`}
          title="Close"
          className="absolute -left-4 top-1/2 z-30 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-legacy-blue-light/15 bg-white text-legacy-blue-light shadow-md transition hover:text-legacy-red"
        >
          <ChevronIcon direction="right" className="h-5 w-5" />
        </button>

        <div className="border-b border-legacy-blue-light/15 px-4 py-3">
          <h2 className="text-sm font-semibold text-legacy-blue-dark">{title}</h2>
        </div>

        {children}
      </aside>
    </>
  )
}
