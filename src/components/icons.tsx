import type { SVGProps } from 'react'

/**
 * Placeholder line icons. Uniform stroke style so tool cards read as a set.
 * Swap individual icons for real ones as tools ship.
 */

const base: SVGProps<SVGSVGElement> = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function ChecklistIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M9 5h10M9 12h10M9 19h10" />
      <path d="m3 5 1.5 1.5L7 4M3 12l1.5 1.5L7 11M3 19l1.5 1.5L7 18" />
    </svg>
  )
}

export function ChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M4 5h16v11H8l-4 4V5Z" />
      <path d="M8 9h8M8 12h5" />
    </svg>
  )
}

export function DocumentPlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M6 3h8l4 4v14H6V3Z" />
      <path d="M14 3v4h4M12 11v6M9 14h6" />
    </svg>
  )
}

export function ReceiptIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  )
}

export function QuestionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7M12 17h.01" />
    </svg>
  )
}

export function RatingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="m12 4 2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.4-4.6 2.4.9-5.2L4 9.5l5.2-.8L12 4Z" />
    </svg>
  )
}

export function CalendarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </svg>
  )
}

export function DashboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </svg>
  )
}

export function ChevronIcon({
  direction = 'right',
  ...props
}: SVGProps<SVGSVGElement> & { direction?: 'left' | 'right' }) {
  return (
    <svg {...base} {...props}>
      <path d={direction === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  )
}

export function RefreshIcon({
  spinning,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { spinning?: boolean }) {
  return (
    <svg
      {...base}
      {...props}
      className={spinning ? `animate-spin ${className ?? ''}` : className}
    >
      <path d="M3 12a9 9 0 0 1 15.5-6.3M21 12a9 9 0 0 1-15.5 6.3" />
      <path d="M18 3v4h-4M6 21v-4h4" />
    </svg>
  )
}

/** Plus when the project isn't Added yet, filled checkmark circle once it is. */
export function AddProjectIcon({
  added,
  ...props
}: SVGProps<SVGSVGElement> & { added?: boolean }) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" fill={added ? 'currentColor' : 'none'} />
      {added ? (
        <path d="m8 12.5 2.8 2.8L16 9.5" stroke="white" />
      ) : (
        <path d="M12 8v8M8 12h8" />
      )}
    </svg>
  )
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}
