import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser'

/**
 * Access token for Microsoft Graph itself — a different audience than the ID
 * token apiClient.ts's getIdToken() returns for our own /api/*. Graph calls
 * (calendar panel, see CalendarPanel.tsx) use this instead. Admin consent for
 * Calendars.Read may not be granted yet; a consent-required failure here just
 * means no calendar data, not an error to handle specially.
 */
export async function getGraphAccessToken(
  instance: IPublicClientApplication,
  account: AccountInfo,
): Promise<string | null> {
  try {
    const result = await instance.acquireTokenSilent({
      scopes: ['Calendars.Read'],
      account,
    })
    return result.accessToken
  } catch (err) {
    console.error('[graph] could not acquire access token:', err)
    return null
  }
}

export interface GraphCalendarEvent {
  id: string
  subject: string
  /** ISO date-time, UTC (see the outlook.timezone="UTC" Prefer header below). */
  start: string
  end: string
  isAllDay: boolean
}

/**
 * The signed-in user's Outlook events for [startDate, endDate), read-only.
 * Calls Graph directly from the browser — no backend proxy — same as any
 * other delegated-permission SPA call. Returns null on any failure
 * (including "admin consent not granted yet"), which the calendar panel
 * treats the same as "no events", not an error to surface.
 */
export async function fetchCalendarEvents(
  instance: IPublicClientApplication,
  account: AccountInfo,
  startDate: Date,
  endDate: Date,
): Promise<GraphCalendarEvent[] | null> {
  const token = await getGraphAccessToken(instance, account)
  if (!token) return null

  const params = new URLSearchParams({
    startDateTime: startDate.toISOString(),
    endDateTime: endDate.toISOString(),
    $select: 'id,subject,start,end,isAllDay',
    $orderby: 'start/dateTime',
    $top: '100',
  })

  let res: Response
  try {
    res = await fetch(`https://graph.microsoft.com/v1.0/me/calendarView?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    })
  } catch (err) {
    console.error('[graph] calendarView request failed:', err)
    return null
  }

  if (!res.ok) {
    console.error('[graph] calendarView returned', res.status, await res.text().catch(() => ''))
    return null
  }

  const body = (await res.json()) as {
    value: {
      id: string
      subject: string
      start: { dateTime: string }
      end: { dateTime: string }
      isAllDay: boolean
    }[]
  }
  return body.value.map((e) => ({
    id: e.id,
    subject: e.subject || '(No subject)',
    // Graph's dateTime strings have no offset even though we asked for UTC
    // via the Prefer header above — without a trailing Z, `new Date(...)`
    // would misparse these as local time instead of UTC.
    start: toUtcIsoString(e.start.dateTime),
    end: toUtcIsoString(e.end.dateTime),
    isAllDay: e.isAllDay,
  }))
}

function toUtcIsoString(graphDateTime: string): string {
  return graphDateTime.endsWith('Z') ? graphDateTime : `${graphDateTime}Z`
}
