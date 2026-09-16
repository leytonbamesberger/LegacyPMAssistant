import { useMemo, useState } from 'react'
import Fuse from 'fuse.js'
import { csiDivision, csiDivisionName } from '../../shared/csi'
import type { SpecSection } from '../lib/submittals'
import { SearchIcon } from './icons'

interface CsiSectionPickerProps {
  sections: SpecSection[]
  value: string | null
  onChange: (section: SpecSection) => void
}

/**
 * Search-or-browse picker over a project's cached spec sections, grouped by
 * CSI division and expandable within each. Used both for the upload form's
 * optional manual pick and the low-confidence fallback selection.
 */
export function CsiSectionPicker({ sections, value, onChange }: CsiSectionPickerProps) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const fuse = useMemo(
    () =>
      new Fuse(sections, {
        keys: ['csi_code_display', 'title'],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [sections],
  )

  const searchResults = query.trim() ? fuse.search(query).map((r) => r.item) : null

  const groups = useMemo(() => {
    const byDivision = new Map<string, SpecSection[]>()
    for (const section of sections) {
      const division = csiDivision(section.csi_code)
      if (!byDivision.has(division)) byDivision.set(division, [])
      byDivision.get(division)!.push(section)
    }
    return [...byDivision.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [sections])

  function toggleDivision(division: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(division)) next.delete(division)
      else next.add(division)
      return next
    })
  }

  if (sections.length === 0) {
    return (
      <p className="text-sm text-legacy-blue-light">
        No cached spec sections for this project yet — sync specs first.
      </p>
    )
  }

  return (
    <div className="rounded-md border border-legacy-blue-light/25">
      <div className="relative border-b border-legacy-blue-light/15 p-2">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-legacy-blue-light" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search section number or title…"
          className="w-full rounded border border-legacy-blue-light/25 py-1.5 pl-7 pr-2.5 text-sm text-legacy-blue-dark placeholder:text-legacy-blue-light/60 focus:border-legacy-blue-dark focus:outline-none"
        />
      </div>

      <div className="max-h-64 overflow-y-auto p-1.5">
        {searchResults ? (
          searchResults.length > 0 ? (
            <ul className="space-y-0.5">
              {searchResults.map((section) => (
                <SectionRow
                  key={section.id}
                  section={section}
                  active={section.csi_code === value}
                  onSelect={() => onChange(section)}
                />
              ))}
            </ul>
          ) : (
            <p className="px-2 py-3 text-center text-xs text-legacy-blue-light">
              No sections match “{query}”.
            </p>
          )
        ) : (
          <ul className="space-y-0.5">
            {groups.map(([division, divisionSections]) => (
              <li key={division}>
                <button
                  type="button"
                  onClick={() => toggleDivision(division)}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm font-medium text-legacy-blue-dark hover:bg-legacy-blue-light/10"
                >
                  <span>{csiDivisionName(division)}</span>
                  <span className="text-xs text-legacy-blue-light">
                    {divisionSections.length}
                  </span>
                </button>
                {expanded.has(division) && (
                  <ul className="space-y-0.5 py-0.5 pl-3">
                    {divisionSections.map((section) => (
                      <SectionRow
                        key={section.id}
                        section={section}
                        active={section.csi_code === value}
                        onSelect={() => onChange(section)}
                      />
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SectionRow({
  section,
  active,
  onSelect,
}: {
  section: SpecSection
  active: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`w-full rounded px-2 py-1.5 text-left text-sm ${
          active
            ? 'bg-legacy-blue-dark text-white'
            : 'text-legacy-blue-dark hover:bg-legacy-blue-light/10'
        }`}
      >
        <span className="font-medium">{section.csi_code_display ?? section.csi_code}</span>
        {section.title && (
          <span className={active ? 'text-white/80' : 'text-legacy-blue-light'}>
            {' — '}
            {section.title}
          </span>
        )}
      </button>
    </li>
  )
}
