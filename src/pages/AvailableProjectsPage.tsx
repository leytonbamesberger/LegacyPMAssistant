import { useMemo, useState } from 'react'
import { useProject } from '../contexts/ProjectContext'
import { useProfile } from '../contexts/ProfileContext'
import { ProcoreEmptyState } from '../components/ProcoreEmptyState'

/**
 * Service users' stand-in for FLOW: every project that has no service salesman and isn't closed, so a
 * salesman can see what is unclaimed and claim it. The list is the same one the left-hand Projects list
 * uses (nothing extra is fetched), so a project Procore has synced is here even before anyone has touched
 * it. Add runs the exact Add flow — including the "Meet with the owner/client" due date modal — and the
 * row disappears once the project has a salesman.
 */
export function AvailableProjectsPage() {
  const { projects, loading, addProject } = useProject()
  const { nameFor } = useProfile()
  const [query, setQuery] = useState('')

  const available = useMemo(
    () =>
      projects
        .filter((p) => !p.service_id && p.status !== 'closed')
        .sort(
          (a, b) =>
            Number(!a.job_number) - Number(!b.job_number) ||
            (a.job_number ?? '').localeCompare(b.job_number ?? '', undefined, { numeric: true }) ||
            a.name.localeCompare(b.name),
        ),
    [projects],
  )

  const q = query.trim().toLowerCase()
  const shown = q ? available.filter((p) => `${p.job_number ?? ''} ${p.name}`.toLowerCase().includes(q)) : available

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="text-xl font-semibold text-legacy-blue-dark">Available Projects</h1>
      <p className="mt-1 text-sm text-legacy-blue-light">
        Projects that don't have a service salesman yet. Add one to make it yours.
      </p>

      <div className="mt-6">
        {loading && projects.length === 0 ? (
          <p className="text-sm text-legacy-blue-light">Loading…</p>
        ) : projects.length === 0 ? (
          <ProcoreEmptyState />
        ) : available.length === 0 ? (
          <p className="text-sm text-legacy-blue-light">Every project has a service salesman.</p>
        ) : (
          <>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search job number or name…"
              aria-label="Search available projects"
              className="w-72 rounded-md border border-legacy-blue-light/30 px-2.5 py-1.5 text-sm text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
            />
            <div className="mt-3 overflow-x-auto rounded-lg border border-legacy-blue-light/25">
              <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-sm text-legacy-blue-dark">
                <thead>
                  <tr className="bg-legacy-blue-light/5 text-left text-xs font-medium uppercase tracking-wide text-legacy-blue-light">
                    <th scope="col" className="w-32 border-b border-legacy-blue-light/20 px-3 py-2">
                      Job #
                    </th>
                    <th scope="col" className="border-b border-legacy-blue-light/20 px-3 py-2">
                      Project
                    </th>
                    <th scope="col" className="w-56 border-b border-legacy-blue-light/20 px-3 py-2">
                      PM
                    </th>
                    <th scope="col" className="w-24 border-b border-legacy-blue-light/20 px-3 py-2">
                      <span className="sr-only">Add</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-legacy-blue-light">
                        No available projects match “{query}”.
                      </td>
                    </tr>
                  )}
                  {shown.map((project) => (
                    <tr key={project.id} className="hover:bg-legacy-blue-light/5">
                      <td className="border-b border-legacy-blue-light/15 px-3 py-2 text-legacy-blue-light">
                        {project.job_number ?? '—'}
                      </td>
                      <td className="border-b border-legacy-blue-light/15 px-3 py-2 font-medium">{project.name}</td>
                      <td className="border-b border-legacy-blue-light/15 px-3 py-2">
                        {project.pm_id ? nameFor(project.pm_id) : 'Unassigned'}
                      </td>
                      <td className="border-b border-legacy-blue-light/15 px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void addProject(project)}
                          aria-label={`Add ${project.name}`}
                          className="rounded-full bg-legacy-blue-dark px-3 py-1 text-xs font-medium text-white hover:opacity-90"
                        >
                          Add
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
