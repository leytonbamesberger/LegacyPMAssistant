import type { SearchSelectOption } from '../components/SearchSelect'
import type { Project } from './projects'

/** Project choices for a SearchSelect: the user's Added projects first, then everything else — each group alphabetical. */
export function projectSearchOptions(projects: Project[]): SearchSelectOption[] {
  const byName = (a: Project, b: Project) => a.name.localeCompare(b.name)
  const option = (p: Project, group: string): SearchSelectOption => ({
    id: p.id,
    label: p.name,
    hint: p.job_number ?? undefined,
    group,
  })
  return [
    ...projects.filter((p) => p.isStarred).sort(byName).map((p) => option(p, 'Added')),
    ...projects.filter((p) => !p.isStarred).sort(byName).map((p) => option(p, 'All projects')),
  ]
}
