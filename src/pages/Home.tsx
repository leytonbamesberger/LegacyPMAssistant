import { useEffect } from 'react'
import { useMsal } from '@azure/msal-react'
import { ProfileMenu } from '../components/ProfileMenu'
import { ToolCard } from '../components/ToolCard'
import { TOOLS } from '../tools/registry'
import { ensureProfile } from '../lib/profiles'

export function Home() {
  const { accounts } = useMsal()
  const account = accounts[0]

  // Sync the Supabase `profiles` row once we have an authenticated account.
  useEffect(() => {
    if (!account) return
    void ensureProfile(account)
  }, [account])

  return (
    <div className="flex min-h-full flex-col bg-white">
      <header className="bg-legacy-blue-dark">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold tracking-tight text-white">
            Legacy PM Assistant
          </span>
          <ProfileMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <h1 className="text-xl font-semibold text-legacy-blue-dark">Tools</h1>
        <p className="mt-1 text-sm text-legacy-blue-light">
          Select a tool to get started.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => (
            <ToolCard key={tool.key} tool={tool} />
          ))}
        </div>
      </main>
    </div>
  )
}
