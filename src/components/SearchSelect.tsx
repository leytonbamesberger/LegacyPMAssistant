import { useMemo, useState } from 'react'
import { fuzzyScore } from '../lib/fuzzy'

export interface SearchSelectOption {
  id: string
  label: string
  /** Section heading; options sharing a group stay together, groups keep first-seen order. */
  group?: string
  /** Muted text after the label (e.g. a job number or title). Searched too. */
  hint?: string
}

/**
 * Type-ahead dropdown with fuzzy matching, optional grouping (e.g. Added
 * projects above the rest) and an "all" choice that clears the selection.
 * Arrow keys + Enter work; mouse picks use onMouseDown so they land before the
 * input's blur closes the list.
 */
export function SearchSelect({
  label,
  options,
  value,
  onChange,
  allLabel,
  placeholder = 'Search…',
}: {
  label: string
  options: SearchSelectOption[]
  value: string | null
  onChange: (id: string | null) => void
  /** Text for the "no filter" choice, shown when nothing is selected. */
  allLabel: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const selected = options.find((o) => o.id === value)

  const visible = useMemo(() => {
    const scored = options
      .map((o) => ({ o, score: fuzzyScore(query, `${o.label} ${o.hint ?? ''}`) }))
      .filter((x): x is { o: SearchSelectOption; score: number } => x.score !== null)
    if (query.trim()) scored.sort((a, b) => b.score - a.score)
    // Stable group ordering: first-seen group order, original order (or score order) within.
    const groupOrder: string[] = []
    for (const { o } of scored) {
      const g = o.group ?? ''
      if (!groupOrder.includes(g)) groupOrder.push(g)
    }
    return groupOrder.flatMap((g) => scored.filter(({ o }) => (o.group ?? '') === g).map(({ o }) => o))
  }, [options, query])

  // Index 0 is the "all" choice, so option i lives at i + 1.
  const rows = [null, ...visible] as (SearchSelectOption | null)[]

  function choose(option: SearchSelectOption | null) {
    onChange(option?.id ?? null)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && open) {
      e.preventDefault()
      choose(rows[Math.min(active, rows.length - 1)] ?? null)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showGroups = new Set(visible.map((o) => o.group ?? '')).size > 1

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-legacy-blue-light">
        {label}
        <input
          type="text"
          value={open ? query : (selected?.label ?? allLabel)}
          onFocus={(e) => {
            setQuery('')
            setActive(0)
            setOpen(true)
            e.currentTarget.select()
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(visible.length > 0 ? 1 : 0)
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={`mt-1 w-full rounded-md border border-legacy-blue-light/30 px-2 py-1.5 text-sm focus:border-legacy-blue-dark focus:outline-none ${
            selected ? 'text-legacy-blue-dark' : 'text-legacy-blue-light'
          }`}
        />
      </label>
      {open && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full min-w-[14rem] overflow-y-auto rounded-md border border-legacy-blue-light/25 bg-white py-1 shadow-lg">
          <li
            onMouseDown={() => choose(null)}
            className={`cursor-pointer px-2 py-1.5 text-sm text-legacy-blue-light ${
              active === 0 ? 'bg-legacy-blue-light/10' : 'hover:bg-legacy-blue-light/10'
            }`}
          >
            {allLabel}
          </li>
          {visible.map((option, i) => {
            const previous = visible[i - 1]
            const startsGroup = showGroups && (i === 0 || (previous.group ?? '') !== (option.group ?? ''))
            return (
              <li key={option.id}>
                {startsGroup && (
                  <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-legacy-blue-light/80">
                    {option.group}
                  </div>
                )}
                <div
                  onMouseDown={() => choose(option)}
                  onMouseEnter={() => setActive(i + 1)}
                  className={`cursor-pointer px-2 py-1.5 text-sm ${
                    active === i + 1 ? 'bg-legacy-blue-light/10' : ''
                  } ${option.id === value ? 'font-medium text-legacy-blue-dark' : 'text-legacy-blue-dark'}`}
                >
                  {option.label}
                  {option.hint && (
                    <span className="ml-1.5 text-xs text-legacy-blue-light">{option.hint}</span>
                  )}
                </div>
              </li>
            )
          })}
          {visible.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-legacy-blue-light">Nothing matches “{query}”.</li>
          )}
        </ul>
      )}
    </div>
  )
}
