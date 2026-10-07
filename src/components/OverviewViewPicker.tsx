import { useEffect, useMemo, useRef, useState } from 'react'
import type { OverviewView } from '../../shared/overviewView'
import { fuzzyScore } from '../lib/fuzzy'
import type { ProfileDirectoryEntry } from '../lib/profiles'
import type { Project } from '../lib/projects'

const CHIPS_SHOWN = 4

/** Project order everywhere in the picker: job number (natural order), then name; no job number last. */
function byJobNumber(a: Project, b: Project): number {
  if (!!a.job_number !== !!b.job_number) return a.job_number ? -1 : 1
  return (
    (a.job_number ?? '').localeCompare(b.job_number ?? '', undefined, { numeric: true }) ||
    a.name.localeCompare(b.name)
  )
}

/**
 * The Overview's "Choose a View" dropdown (multi-select checkboxes) and, beside it, the current
 * selections as removable chips ("+N more" once there are many). One search box at the top filters all
 * three sections below it:
 *   1. My Projects — every Added project, live (checked by default)
 *   2. Project Managers — each person who is PM on at least one project, with their project count;
 *      checking one includes all their projects and follows reassignments
 *   3. Projects — every project, individually pickable
 * The view is the union of everything checked.
 */
export function OverviewViewPicker({
  view,
  onChange,
  projects,
  directory,
}: {
  view: OverviewView
  onChange: (next: OverviewView) => void
  projects: Project[]
  directory: ProfileDirectoryEntry[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  // Which edge the popup hangs from: the left edge (opening rightwards) unless it wouldn't fit before the right of the screen.
  const [alignRight, setAlignRight] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const nameOf = (id: string) => directory.find((p) => p.id === id)?.display_name ?? 'Unknown'
  const addedCount = projects.filter((p) => p.isStarred).length

  const pmOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of projects) if (p.pm_id) counts.set(p.pm_id, (counts.get(p.pm_id) ?? 0) + 1)
    return [...counts.entries()]
      .map(([id, count]) => ({
        id,
        count,
        name: directory.find((d) => d.id === id)?.display_name ?? 'Unknown',
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [projects, directory])

  const q = query.trim()
  const showMine = !q || fuzzyScore(q, 'My Projects Added') !== null
  const visiblePms = pmOptions.filter((pm) => !q || fuzzyScore(q, pm.name) !== null)
  const visibleProjects = useMemo(() => {
    const sorted = [...projects].sort(byJobNumber)
    if (!q) return sorted
    return sorted
      .map((p) => ({ p, score: fuzzyScore(q, `${p.job_number ?? ''} ${p.name}`) }))
      .filter((x): x is { p: Project; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p)
  }, [projects, q])

  const toggle = <K extends 'pm_ids' | 'project_ids'>(key: K, id: string) =>
    onChange({
      ...view,
      [key]: view[key].includes(id) ? view[key].filter((x) => x !== id) : [...view[key], id],
    })

  // ---- chips ----
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...(view.mine ? [{ key: 'mine', label: 'My Projects', remove: () => onChange({ ...view, mine: false }) }] : []),
    ...view.pm_ids.map((id) => ({
      key: `pm-${id}`,
      label: `PM: ${nameOf(id)}`,
      remove: () => toggle('pm_ids', id),
    })),
    ...view.project_ids.map((id) => {
      const p = projects.find((x) => x.id === id)
      return {
        key: `project-${id}`,
        label: p ? `${p.job_number ? `${p.job_number} ` : ''}${p.name}` : 'Unknown project',
        remove: () => toggle('project_ids', id),
      }
    }),
  ]
  const shownChips = expanded ? chips : chips.slice(0, CHIPS_SHOWN)
  const hidden = chips.length - shownChips.length

  const row = 'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-legacy-blue-dark hover:bg-legacy-blue-light/10'
  const heading = 'px-3 pb-0.5 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-legacy-blue-light/80'
  const covered = (p: Project) => (view.mine && p.isStarred) || (!!p.pm_id && view.pm_ids.includes(p.pm_id))

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <ul className="flex flex-wrap items-center justify-end gap-1.5" aria-label="Current view">
        {chips.length === 0 && <li className="text-xs text-legacy-blue-light">Nothing selected</li>}
        {shownChips.map((chip) => (
          <li
            key={chip.key}
            className="flex max-w-[16rem] items-center gap-1 rounded-full bg-legacy-blue-light/15 py-0.5 pl-2.5 pr-1 text-xs text-legacy-blue-dark"
          >
            <span className="truncate">{chip.label}</span>
            <button
              type="button"
              onClick={chip.remove}
              aria-label={`Remove ${chip.label} from the view`}
              className="rounded-full px-1 leading-none text-legacy-blue-light hover:text-legacy-red"
            >
              ×
            </button>
          </li>
        ))}
        {chips.length > CHIPS_SHOWN && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded-full px-2 py-0.5 text-xs font-medium text-legacy-blue-light underline hover:text-legacy-blue-dark"
            >
              {expanded ? 'Show less' : `+${hidden} more`}
            </button>
          </li>
        )}
      </ul>

      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={(e) => {
            // The popup is w-80 (320px).
            setAlignRight(window.innerWidth - e.currentTarget.getBoundingClientRect().left < 320 + 16)
            setOpen((v) => !v)
            setQuery('')
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="rounded-md border border-legacy-blue-light/30 px-3 py-1.5 text-sm font-medium text-legacy-blue-dark hover:border-legacy-blue-dark"
        >
          Choose a View <span aria-hidden>▾</span>
        </button>

        {open && (
          <div
            role="dialog"
            aria-label="Choose a View"
            className={`absolute z-40 mt-1 w-80 rounded-md border border-legacy-blue-light/25 bg-white shadow-lg ${
              alignRight ? 'right-0' : 'left-0'
            }`}
          >
            <div className="border-b border-legacy-blue-light/15 p-2">
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search views, people, projects…"
                aria-label="Search the view options"
                className="w-full rounded-md border border-legacy-blue-light/30 px-2 py-1.5 text-sm text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
              />
            </div>

            {/* The popup's own list scrolls (it's a transient menu, not part of the page). */}
            <div className="max-h-96 overflow-y-auto pb-1">
              {showMine && (
                <>
                  <div className={heading}>My Projects</div>
                  <label className={row}>
                    <input
                      type="checkbox"
                      checked={view.mine}
                      onChange={(e) => onChange({ ...view, mine: e.target.checked })}
                      className="h-3.5 w-3.5 accent-legacy-blue-dark"
                    />
                    <span>
                      My Projects
                      <span className="ml-1.5 text-xs text-legacy-blue-light">{addedCount} Added</span>
                    </span>
                  </label>
                </>
              )}

              {visiblePms.length > 0 && (
                <>
                  <div className={heading}>Project Managers</div>
                  {visiblePms.map((pm) => (
                    <label key={pm.id} className={row}>
                      <input
                        type="checkbox"
                        checked={view.pm_ids.includes(pm.id)}
                        onChange={() => toggle('pm_ids', pm.id)}
                        className="h-3.5 w-3.5 accent-legacy-blue-dark"
                      />
                      <span className="min-w-0 truncate">
                        {pm.name}
                        <span className="ml-1.5 text-xs text-legacy-blue-light">
                          {pm.count} project{pm.count === 1 ? '' : 's'}
                        </span>
                      </span>
                    </label>
                  ))}
                </>
              )}

              {visibleProjects.length > 0 && (
                <>
                  <div className={heading}>Projects</div>
                  {visibleProjects.map((p) => (
                    <label key={p.id} className={row}>
                      <input
                        type="checkbox"
                        checked={view.project_ids.includes(p.id)}
                        onChange={() => toggle('project_ids', p.id)}
                        className="h-3.5 w-3.5 shrink-0 accent-legacy-blue-dark"
                      />
                      <span className="min-w-0 truncate">
                        {p.job_number && <span className="mr-1.5 text-legacy-blue-light">{p.job_number}</span>}
                        {p.name}
                        {covered(p) && <span className="ml-1.5 text-xs text-legacy-blue-light">· already shown</span>}
                      </span>
                    </label>
                  ))}
                </>
              )}

              {q && !showMine && visiblePms.length === 0 && visibleProjects.length === 0 && (
                <p className="px-3 py-3 text-sm text-legacy-blue-light">Nothing matches “{query}”.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
