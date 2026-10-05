import { useMemo, useState } from 'react'
import type { ProfileDirectoryEntry } from '../lib/profiles'

/** Searchable single-select over every profile, with an explicit "Unassigned" choice. */
export function ProfileSearchSelect({
  label,
  value,
  directory,
  onChange,
}: {
  label: string
  value: string | null
  directory: ProfileDirectoryEntry[]
  onChange: (profileId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = directory.find((p) => p.id === value)
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return directory.filter((p) => !q || (p.display_name ?? '').toLowerCase().includes(q))
  }, [directory, query])

  function choose(profileId: string | null) {
    onChange(profileId)
    setOpen(false)
  }

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-legacy-blue-light">
        {label}
        <input
          type="text"
          value={open ? query : (selected?.display_name ?? 'Unassigned')}
          onFocus={() => {
            setQuery('')
            setOpen(true)
          }}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => setOpen(false)}
          placeholder="Search people…"
          className="mt-1 w-full rounded-md border border-legacy-blue-light/30 px-2 py-1.5 text-sm text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
        />
      </label>
      {open && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-legacy-blue-light/25 bg-white py-1 shadow-lg">
          {/* onMouseDown (not onClick): it fires before the input's blur closes the list. */}
          <li
            onMouseDown={() => choose(null)}
            className="cursor-pointer px-2 py-1.5 text-sm text-legacy-blue-light hover:bg-legacy-blue-light/10"
          >
            Unassigned
          </li>
          {matches.map((p) => (
            <li
              key={p.id}
              onMouseDown={() => choose(p.id)}
              className={`cursor-pointer px-2 py-1.5 text-sm hover:bg-legacy-blue-light/10 ${
                p.id === value ? 'font-medium text-legacy-blue-dark' : 'text-legacy-blue-dark'
              }`}
            >
              {p.display_name ?? 'Unnamed'}
              {p.title && (
                <span className="ml-1.5 text-xs uppercase text-legacy-blue-light">{p.title}</span>
              )}
            </li>
          ))}
          {matches.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-legacy-blue-light">No one matches “{query}”.</li>
          )}
        </ul>
      )}
    </div>
  )
}
