import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ToolCard } from '../components/ToolCard'
import { TOOLS } from '../tools/registry'

const PROCORE_NOTICES: Record<string, { tone: 'ok' | 'warn'; text: string }> = {
  connected: { tone: 'ok', text: 'Procore connected.' },
  denied: { tone: 'warn', text: 'Procore connection was cancelled.' },
  error: { tone: 'warn', text: 'Procore connection failed. Please try again.' },
}

export function Home() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [notice, setNotice] = useState<(typeof PROCORE_NOTICES)[string] | null>(
    null,
  )

  // Surface the result of the Procore OAuth round-trip, then drop the param.
  useEffect(() => {
    const result = searchParams.get('procore')
    if (!result) return
    setNotice(PROCORE_NOTICES[result] ?? null)
    searchParams.delete('procore')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams])

  return (
    <>
      {notice && (
        <div
          className={`border-b px-6 py-2.5 text-sm ${
            notice.tone === 'ok'
              ? 'border-legacy-blue-light/20 bg-legacy-blue-light/5 text-legacy-blue-dark'
              : 'border-legacy-red/30 bg-legacy-red/5 text-legacy-red'
          }`}
        >
          <div className="flex items-center justify-between">
            <span>{notice.text}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-xs underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <h1 className="text-xl font-semibold text-legacy-blue-dark">Tools</h1>
        <p className="mt-1 text-sm text-legacy-blue-light">
          Select a tool to get started.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => (
            <ToolCard key={tool.key} tool={tool} />
          ))}
        </div>
      </div>
    </>
  )
}
