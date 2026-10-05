import legacyLogo from '../assets/legacy-logo.png'

/**
 * Full-page first-load screen: shown instead of the app until the initial data is
 * in (see AppReadyContext), so pages never render as empty while they're still
 * loading. `error` swaps the spinner for a message and a Retry button.
 */
export function AppLoadingView({
  error,
  onRetry,
}: {
  error: { message: string } | null
  onRetry: () => void
}) {
  return (
    <main className="flex h-screen flex-col items-center justify-center bg-white px-4 text-center">
      <img src={legacyLogo} alt="Legacy Mechanical Inc." className="h-28 w-auto" />
      <h1 className="mt-6 text-lg font-semibold tracking-tight text-legacy-blue-dark">
        Legacy PM Assistant
      </h1>

      {error ? (
        <div role="alert" className="mt-6 max-w-sm">
          <p className="text-sm font-medium text-legacy-red">We couldn't load your workspace.</p>
          <p className="mt-1 text-sm text-legacy-blue-light">{error.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-full bg-legacy-blue-dark px-5 py-2 text-sm font-medium text-white transition hover:bg-legacy-blue-dark/90"
          >
            Retry
          </button>
        </div>
      ) : (
        <div role="status" aria-live="polite" className="mt-6 flex flex-col items-center gap-3">
          <span
            aria-hidden
            className="h-8 w-8 rounded-full border-4 border-legacy-blue-light/20 border-t-legacy-red motion-safe:animate-spin"
          />
          <p className="text-sm text-legacy-blue-light">Loading your projects and tasks…</p>
        </div>
      )}
    </main>
  )
}
