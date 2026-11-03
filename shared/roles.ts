/**
 * A user's self-reported role (`profiles.title`). No imports: used by src/ and server/.
 *
 * Not a permission tier for the whole app — it decides how the user is assigned when they are the first
 * to Add a project (PM / APM take that slot; Service claims the project's service salesman), and which
 * tabs and tasks they see (Service users get Available Projects instead of FLOW, no Procurement, and
 * only their own manual and service tasks).
 */
export type ProfileTitle = 'pm' | 'apm' | 'service'

export const PROFILE_TITLES: readonly ProfileTitle[] = ['pm', 'apm', 'service']

export const PROFILE_TITLE_LABEL: Record<ProfileTitle, string> = {
  pm: 'Project Manager',
  apm: 'Assistant Project Manager',
  service: 'Service',
}

export function isProfileTitle(value: unknown): value is ProfileTitle {
  return value === 'pm' || value === 'apm' || value === 'service'
}
