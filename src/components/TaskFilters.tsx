import { useMemo } from 'react'
import type { Project } from '../lib/projects'
import type { ProfileDirectoryEntry } from '../lib/profiles'
import type { TaskSourceCategory } from '../lib/tasks'
import { projectSearchOptions } from '../lib/projectOptions'
import { SearchSelect, type SearchSelectOption } from './SearchSelect'

export interface TaskFilterState {
  projectId: string | null
  assigneeId: string | null
  /** Empty = no category filter (so manual tasks, which have no category, still show). */
  categories: TaskSourceCategory[]
}

export const NO_TASK_FILTERS: TaskFilterState = { projectId: null, assigneeId: null, categories: [] }

const CATEGORY_OPTIONS: { value: TaskSourceCategory; label: string }[] = [
  { value: 'setup', label: 'Setup' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'closeout', label: 'Closeout' },
  { value: 'flow', label: 'FLOW' },
]

/** Shared by the Tasks and Archive pages. */
export function TaskFilters({
  filters,
  onChange,
  projects,
  directory,
  showFlow = true,
}: {
  filters: TaskFilterState
  onChange: (next: TaskFilterState) => void
  projects: Project[]
  directory: ProfileDirectoryEntry[]
  /** The FLOW checkbox belongs on Tasks only: flow reports are never archived. */
  showFlow?: boolean
}) {
  const projectOptions = useMemo(() => projectSearchOptions(projects), [projects])

  const assigneeOptions = useMemo<SearchSelectOption[]>(
    () =>
      [...directory]
        .sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? ''))
        .map((p) => ({
          id: p.id,
          label: p.display_name ?? 'Unnamed',
          hint: p.title ? p.title.toUpperCase() : undefined,
        })),
    [directory],
  )

  const active =
    filters.projectId !== null || filters.assigneeId !== null || filters.categories.length > 0

  function toggleCategory(category: TaskSourceCategory) {
    const has = filters.categories.includes(category)
    onChange({
      ...filters,
      categories: has
        ? filters.categories.filter((c) => c !== category)
        : [...filters.categories, category],
    })
  }

  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
      <div className="w-64">
        <SearchSelect
          label="Project"
          options={projectOptions}
          value={filters.projectId}
          onChange={(projectId) => onChange({ ...filters, projectId })}
          allLabel="All projects"
          placeholder="Search projects…"
        />
      </div>
      <div className="w-56">
        <SearchSelect
          label="Assignee"
          options={assigneeOptions}
          value={filters.assigneeId}
          onChange={(assigneeId) => onChange({ ...filters, assigneeId })}
          allLabel="Anyone"
          placeholder="Search people…"
        />
      </div>
      <fieldset className="flex items-center gap-4 pb-1.5">
        <legend className="sr-only">Task type</legend>
        {CATEGORY_OPTIONS.filter((o) => showFlow || o.value !== 'flow').map(({ value, label }) => (
          <label key={value} className="flex cursor-pointer items-center gap-1.5 text-sm text-legacy-blue-dark">
            <input
              type="checkbox"
              checked={filters.categories.includes(value)}
              onChange={() => toggleCategory(value)}
              className="h-3.5 w-3.5 accent-legacy-blue-dark"
            />
            {label}
          </label>
        ))}
      </fieldset>
      {active && (
        <button
          type="button"
          onClick={() => onChange(NO_TASK_FILTERS)}
          className="pb-1.5 text-xs font-medium text-legacy-blue-light underline hover:text-legacy-blue-dark"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
