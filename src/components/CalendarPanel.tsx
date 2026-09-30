import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { useNavigate } from 'react-router-dom'
import { Calendar, dateFnsLocalizer, type View } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay, startOfMonth, endOfMonth } from 'date-fns'
import { enUS } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import './CalendarPanel.css'
import { SlideOutPanel } from './SlideOutPanel'
import { useProject } from '../contexts/ProjectContext'
import { useProfile } from '../contexts/ProfileContext'
import { fetchCalendarEvents, type GraphCalendarEvent } from '../lib/graphClient'
import { fetchTasks, type Task } from '../lib/tasks'
import { fetchChecklistStatus, type ProjectChecklistStatus } from '../lib/checklist'
import { defaultFlowReportMonth, lastDayOfMonth } from '../lib/flowReports'

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { 'en-US': enUS },
})

type EntryKind = 'outlook' | 'task' | 'flow' | 'checklist'

interface CalendarEvent {
  title: string
  start: Date
  end: Date
  allDay: boolean
  kind: EntryKind
}

const KIND_COLOR: Record<EntryKind, string> = {
  outlook: '#18385f',
  task: '#003058',
  flow: '#ee3428',
  checklist: '#18385f',
}

/** Padding around the visible month so grid cells from adjacent months (which react-big-calendar always shows) get Outlook data too. */
const RANGE_PAD_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Slide-out drawer from the right edge, available from anywhere in the app
 * (not a route) — toggled from AppShell's header. A standard month-grid
 * calendar merging four sources: the signed-in user's Outlook events, their
 * own task due dates, one aggregated "Flow Reports Due" entry, and any Setup
 * (completed-with-a-date) or Recurring (scheduled) checklist item with a
 * date set, across starred projects.
 */
export function CalendarPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { projects } = useProject()
  const { profile } = useProfile()
  const navigate = useNavigate()

  const starredProjects = useMemo(() => projects.filter((p) => p.isStarred), [projects])
  const starredIds = useMemo(() => starredProjects.map((p) => p.id), [starredProjects])
  const starredIdsKey = starredIds.join(',')

  const [currentDate, setCurrentDate] = useState(new Date())
  const [view, setView] = useState<View>('month')

  const [outlookEvents, setOutlookEvents] = useState<GraphCalendarEvent[] | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [checklist, setChecklist] = useState<ProjectChecklistStatus[]>([])
  const [loading, setLoading] = useState(false)

  const monthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`

  // Tasks/checklist aren't range-bound (we already have all of them), only
  // Outlook's calendarView needs a range — refetch it whenever the visible
  // month changes, not just on open.
  useEffect(() => {
    if (!open || !account) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const start = new Date(startOfMonth(currentDate).getTime() - RANGE_PAD_DAYS * DAY_MS)
      const end = new Date(endOfMonth(currentDate).getTime() + RANGE_PAD_DAYS * DAY_MS)

      const [eventsResult, tasksResult, checklistResult] = await Promise.all([
        fetchCalendarEvents(instance, account, start, end),
        fetchTasks(instance, account),
        starredIds.length > 0 ? fetchChecklistStatus(instance, account, starredIds) : Promise.resolve([]),
      ])
      if (cancelled) return
      setOutlookEvents(eventsResult)
      setTasks(tasksResult ?? [])
      setChecklist(checklistResult ?? [])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instance, account, monthKey, starredIdsKey])

  const events = useMemo<CalendarEvent[]>(() => {
    const list: CalendarEvent[] = []

    for (const e of outlookEvents ?? []) {
      list.push({
        title: e.subject,
        start: new Date(e.start),
        end: new Date(e.end),
        allDay: e.isAllDay,
        kind: 'outlook',
      })
    }

    for (const task of tasks) {
      if (task.assigned_to !== profile?.id) continue
      if (task.is_recurring) {
        if (task.cadence_days === null) continue
        const dueAt = task.last_completed_at
          ? new Date(task.last_completed_at).getTime() + task.cadence_days * DAY_MS
          : Date.now()
        const date = allDayDate(new Date(dueAt))
        list.push({ title: task.title, start: date, end: date, allDay: true, kind: 'task' })
      } else if (task.due_date) {
        const date = allDayDate(new Date(`${task.due_date}T00:00:00`))
        list.push({ title: task.title, start: date, end: date, allDay: true, kind: 'task' })
      }
    }

    const flowDate = allDayDate(new Date(`${lastDayOfMonth(defaultFlowReportMonth())}T00:00:00`))
    list.push({ title: 'Flow Reports Due', start: flowDate, end: flowDate, allDay: true, kind: 'flow' })

    for (const status of checklist) {
      const project = projects.find((p) => p.id === status.projectId)
      const prefix = project ? `${project.name}: ` : ''
      for (const item of status.setup) {
        if (item.completedAt) {
          const date = allDayDate(new Date(`${item.completedAt.slice(0, 10)}T00:00:00`))
          list.push({ title: `${prefix}${item.item.name}`, start: date, end: date, allDay: true, kind: 'checklist' })
        }
      }
      for (const item of status.recurring) {
        if (item.scheduledDate) {
          const date = allDayDate(new Date(`${item.scheduledDate}T00:00:00`))
          list.push({ title: `${prefix}${item.item.name}`, start: date, end: date, allDay: true, kind: 'checklist' })
        }
      }
    }

    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlookEvents, tasks, checklist, projects, profile])

  const handleSelectEvent = useCallback(
    (event: CalendarEvent) => {
      if (event.kind === 'flow') {
        onClose()
        navigate('/organization#flow-reports')
      }
    },
    [onClose, navigate],
  )

  return (
    <SlideOutPanel open={open} onClose={onClose} title="Calendar">
      <div className="legacy-rbc relative flex-1 overflow-y-auto p-4">
        {loading && (
          <p className="absolute right-6 top-6 text-xs text-legacy-blue-light">Loading…</p>
        )}
        <Calendar
          localizer={localizer}
          events={events}
          date={currentDate}
          onNavigate={setCurrentDate}
          view={view}
          onView={setView}
          views={['month']}
          startAccessor="start"
          endAccessor="end"
          allDayAccessor="allDay"
          titleAccessor="title"
          style={{ height: '100%' }}
          popup
          onSelectEvent={handleSelectEvent}
          eventPropGetter={(event: CalendarEvent) => ({
            style: {
              backgroundColor: KIND_COLOR[event.kind],
              cursor: event.kind === 'flow' ? 'pointer' : 'default',
            },
          })}
        />
      </div>
    </SlideOutPanel>
  )
}

/** Strips time to local midnight so all-day events land on the right grid cell regardless of source timezone. */
function allDayDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}
