import type { Project } from '../lib/projects'

/**
 * The selected project's bubble in the Tasks page's pinned area (same shape and position as the
 * Initiate Project bubbles): name, PM, APM, and Edit / Closeout Project. An uninitiated project only
 * offers Edit (PM and APM) — the Initiate Project bubble covers the rest, so Closeout is hidden.
 */
export function ProjectBubble({
  project,
  pmName,
  apmName,
  onEdit,
  onCloseout,
  onClear,
}: {
  project: Project
  pmName: string | null
  apmName: string | null
  onEdit: () => void
  onCloseout: () => void
  onClear: () => void
}) {
  const button =
    'shrink-0 rounded-full border border-legacy-blue-dark/40 px-4 py-1.5 text-sm font-semibold text-legacy-blue-dark hover:bg-legacy-blue-dark hover:text-white'
  return (
    <div
      aria-label={`Selected project: ${project.name}`}
      className="flex items-center justify-between gap-3 rounded-lg border border-legacy-blue-light/40 bg-legacy-blue-light/5 px-3 py-2.5"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-legacy-blue-dark">
          {project.job_number ? `${project.job_number} — ` : ''}
          {project.name}
          {project.status === 'closing' && (
            <span className="ml-2 rounded-full bg-legacy-blue-light/15 px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-legacy-blue-light">
              Closing
            </span>
          )}
        </div>
        <div className="text-xs text-legacy-blue-light">
          PM: {pmName ?? 'Unassigned'} · APM: {apmName ?? 'Unassigned'}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={onEdit} className={button}>
          Edit
        </button>
        {project.initiated && (
          <button type="button" onClick={onCloseout} className={button}>
            Closeout Project
          </button>
        )}
        <button
          type="button"
          onClick={onClear}
          title="Clear selection"
          aria-label="Clear selected project"
          className="px-1 text-lg leading-none text-legacy-blue-light hover:text-legacy-red"
        >
          ×
        </button>
      </div>
    </div>
  )
}
