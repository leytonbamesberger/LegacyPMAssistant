import { Link } from 'react-router-dom'
import type { ToolDefinition } from '../tools/registry'

interface ToolCardProps {
  tool: ToolDefinition
}

const STATUS_LABEL: Record<ToolDefinition['status'], string> = {
  active: 'Open',
  next: 'Up Next',
  'coming-soon': 'Coming Soon',
}

/**
 * A single tool entry on the Home grid.
 *
 * Visual language (color carries meaning):
 * - `coming-soon`: muted, non-interactive. Greyed text, light border.
 * - `next`: the tool being built now. legacy-red accent border to draw the eye.
 * - `active`: live tool, links to `tool.path`. Interactive hover state, blue-dark affordances.
 */
export function ToolCard({ tool }: ToolCardProps) {
  const { name, description, Icon, status, path } = tool
  const isActive = status === 'active' && Boolean(path)
  const isNext = status === 'next'

  const containerBase =
    'group relative flex flex-col gap-3 rounded-lg border bg-white p-5 text-left transition'

  const containerByStatus = isActive
    ? 'border-legacy-blue-light/30 hover:border-legacy-blue-dark hover:shadow-sm cursor-pointer'
    : isNext
      ? 'border-legacy-red/60 border-l-4 border-l-legacy-red'
      : 'border-legacy-blue-light/15 opacity-60 cursor-not-allowed'

  const content = (
    <>
      <div className="flex items-start justify-between">
        <span
          className={
            isNext
              ? 'text-legacy-red'
              : isActive
                ? 'text-legacy-blue-dark'
                : 'text-legacy-blue-light'
          }
        >
          <Icon className="h-6 w-6" />
        </span>
        <StatusBadge status={status} />
      </div>

      <div className="space-y-1">
        <h3 className="text-base font-semibold text-legacy-blue-dark">{name}</h3>
        <p className="text-sm leading-snug text-legacy-blue-dark/70">
          {description}
        </p>
      </div>
    </>
  )

  if (isActive && path) {
    return (
      <Link to={path} className={`${containerBase} ${containerByStatus}`}>
        {content}
      </Link>
    )
  }

  return (
    <div className={`${containerBase} ${containerByStatus}`} aria-disabled={!isActive}>
      {content}
    </div>
  )
}

function StatusBadge({ status }: { status: ToolDefinition['status'] }) {
  const styles: Record<ToolDefinition['status'], string> = {
    active:
      'bg-legacy-blue-dark text-white',
    next: 'border border-legacy-red text-legacy-red',
    'coming-soon': 'border border-legacy-blue-light/30 text-legacy-blue-light',
  }

  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}
