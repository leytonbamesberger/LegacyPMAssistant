import { useMemo, useState } from 'react'
import Fuse from 'fuse.js'
import { useProject } from '../contexts/ProjectContext'
import type { Project } from '../lib/projects'
import { ChevronIcon, RefreshIcon, SearchIcon, StarIcon } from './icons'

const COLLAPSED_KEY = 'legacy-pm:sidebarCollapsed'
const MAX_SEARCH_RESULTS = 25

// Auto-collapse the sidebar after picking a project — flip this to `false`
// if you'd rather it stay open.
const COLLAPSE_ON_SELECT = true

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Left-side, collapsible project selector. Collapsed: a narrow rail showing
 * the active project's job number. Expanded: a search box over either the
 * starred list (search empty) or fuzzy-matched results (search has text).
 */
export function Sidebar() {
  const {
    projects,
    selectedProject,
    selectProject,
    syncing,
    syncError,
    refreshProjects,
    toggleStar,
  } = useProject()

  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [query, setQuery] = useState('')

  function setCollapsedPersisted(next: boolean) {
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      // Non-critical UI preference — fine to lose on storage failure.
    }
  }

  const fuse = useMemo(
    () =>
      new Fuse(projects, {
        keys: ['name', 'job_number'],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [projects],
  )

  const searchResults = useMemo(() => {
    if (!query.trim()) return []
    return fuse.search(query).slice(0, MAX_SEARCH_RESULTS).map((r) => r.item)
  }, [fuse, query])

  const starredProjects = useMemo(
    () => projects.filter((p) => p.isStarred),
    [projects],
  )

  function handleSelect(project: Project) {
    selectProject(project)
    if (COLLAPSE_ON_SELECT) setCollapsedPersisted(true)
  }

  if (collapsed) {
    return (
      <div className="flex w-14 shrink-0 flex-col items-center border-r border-legacy-blue-light/15 bg-white py-3">
        <button
          type="button"
          onClick={() => setCollapsedPersisted(false)}
          title="Expand project sidebar"
          className="rounded p-1.5 text-legacy-blue-light hover:bg-legacy-blue-light/10"
        >
          <ChevronIcon direction="right" className="h-4 w-4" />
        </button>
        <div className="mt-4 break-words px-1 text-center text-[10px] font-semibold leading-tight text-legacy-blue-dark">
          {selectedProject?.job_number ?? '—'}
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-legacy-blue-light/15 bg-white">
      <div className="flex items-center justify-between border-b border-legacy-blue-light/15 px-3 py-2.5">
        <span className="text-sm font-semibold text-legacy-blue-dark">Projects</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void refreshProjects()}
            disabled={syncing}
            title={
              syncError
                ? `Last sync failed: ${syncError}`
                : 'Refresh projects from Procore'
            }
            className="relative rounded p-1.5 text-legacy-blue-light hover:bg-legacy-blue-light/10 disabled:opacity-60"
          >
            <RefreshIcon spinning={syncing} className="h-4 w-4" />
            {syncError && !syncing && (
              <span
                className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-legacy-red"
                aria-hidden
              />
            )}
          </button>
          <button
            type="button"
            onClick={() => setCollapsedPersisted(true)}
            title="Collapse sidebar"
            className="rounded p-1.5 text-legacy-blue-light hover:bg-legacy-blue-light/10"
          >
            <ChevronIcon direction="left" className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="border-b border-legacy-blue-light/15 p-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-legacy-blue-light" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search job number or name…"
            className="w-full rounded-md border border-legacy-blue-light/25 py-1.5 pl-7 pr-2.5 text-sm text-legacy-blue-dark placeholder:text-legacy-blue-light/60 focus:border-legacy-blue-dark focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {query.trim() ? (
          searchResults.length > 0 ? (
            <ProjectList
              projects={searchResults}
              selectedId={selectedProject?.id ?? null}
              onSelect={handleSelect}
              onToggleStar={toggleStar}
            />
          ) : (
            <p className="px-2 py-4 text-center text-xs text-legacy-blue-light">
              No projects match “{query}”.
            </p>
          )
        ) : starredProjects.length > 0 ? (
          <ProjectList
            projects={starredProjects}
            selectedId={selectedProject?.id ?? null}
            onSelect={handleSelect}
            onToggleStar={toggleStar}
          />
        ) : (
          <p className="px-2 py-4 text-center text-xs text-legacy-blue-light">
            No starred projects yet. Search above and star one to keep it handy.
          </p>
        )}
      </div>
    </div>
  )
}

function ProjectList({
  projects,
  selectedId,
  onSelect,
  onToggleStar,
}: {
  projects: Project[]
  selectedId: string | null
  onSelect: (project: Project) => void
  onToggleStar: (project: Project) => void
}) {
  return (
    <ul className="space-y-0.5">
      {projects.map((project) => (
        <ProjectRow
          key={project.id}
          project={project}
          active={project.id === selectedId}
          onSelect={() => onSelect(project)}
          onToggleStar={() => onToggleStar(project)}
        />
      ))}
    </ul>
  )
}

function ProjectRow({
  project,
  active,
  onSelect,
  onToggleStar,
}: {
  project: Project
  active: boolean
  onSelect: () => void
  onToggleStar: () => void
}) {
  return (
    <li
      className={`flex items-center gap-1 rounded-md text-sm ${
        active
          ? 'bg-legacy-blue-dark text-white'
          : 'text-legacy-blue-dark hover:bg-legacy-blue-light/10'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 px-2 py-1.5 text-left"
      >
        <div className="truncate font-medium">{project.name}</div>
        {project.job_number && (
          <div
            className={`truncate text-xs ${
              active ? 'text-white/70' : 'text-legacy-blue-light'
            }`}
          >
            {project.job_number}
          </div>
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggleStar()
        }}
        title={project.isStarred ? 'Unstar' : 'Star'}
        className={`shrink-0 px-2 py-1.5 ${
          active ? 'text-white' : 'text-legacy-blue-light hover:text-legacy-red'
        }`}
      >
        <StarIcon filled={project.isStarred} className="h-4 w-4" />
      </button>
    </li>
  )
}
