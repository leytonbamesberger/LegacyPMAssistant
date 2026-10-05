import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { Calendar, dateFnsLocalizer, type View } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay, startOfMonth, endOfMonth } from 'date-fns'
import { enUS } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import './CalendarPanel.css'
import { SlideOutPanel } from './SlideOutPanel'
import { useFlowReport } from '../contexts/FlowReportContext'
import { useProfile } from '../contexts/ProfileContext'
import { fetchCalendarEvents, type GraphCalendarEvent } from '../lib/graphClient'
import { fetchTasks, type Task } from '../lib/tasks'

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { 'en-US': enUS },
})

type EntryKind = 'outlook' | 'task' | 'flow'

interface CalendarEvent {
  title: string
  start: Date
  end: Date
  allDay: boolean
  kind: EntryKind
  /** Set on task-sourced events (kind 'task' | 'flow'). */
  task?: Task
}

const KIND_COLOR: Record<EntryKind, string> = {
  outlook: '#18385f',
  task: '#003058',
  flow: '#ee3428',
}

/** Padding around the visible month so grid cells from adjacent months (which react-big-calendar always shows) get Outlook data too. */
const RANGE_PAD_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Slide-out drawer from the right edge, available from anywhere in the app
 * (not a route) — toggled from AppShell's header. A standard month-grid
 * calendar merging two sources: the signed-in user's Outlook events and their
 * own open tasks that have a due date, plus their meeting tasks on the date
 * the meeting is held. Tasks cover everything — manual tasks,
 * generated Setup/Recurring checklist tasks, and each project's flow task
 * (which opens its report when clicked). TBD tasks have no date, so they don't
 * appear until one is set.
 */
export function CalendarPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { instance, accounts } = useMsal()
  const account = accounts[0]
  const { profile } = useProfile()
  const { openFlowReportModal } = useFlowReport()

  const [currentDate, setCurrentDate] = useState(new Date())
  const [view, setView] = useState<View>('month')

  const [outlookEvents, setOutlookEvents] = useState<GraphCalendarEvent[] | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)

  const monthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`

  // Tasks aren't range-bound (we already have all of them), only Outlook's
  // calendarView needs a range — refetch it whenever the visible month
  // changes, not just on open.
  useEffect(() => {
    if (!open || !account) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const start = new Date(startOfMonth(currentDate).getTime() - RANGE_PAD_DAYS * DAY_MS)
      const end = new Date(endOfMonth(currentDate).getTime() + RANGE_PAD_DAYS * DAY_MS)

      const [eventsResult, tasksResult, meetingsResult] = await Promise.all([
        fetchCalendarEvents(instance, account, start, end),
        fetchTasks(instance, account),
        // Meeting tasks are complete once they have a date, so they aren't in the open list.
        fetchTasks(instance, account, { status: 'meeting' }),
      ])
      if (cancelled) return
      setOutlookEvents(eventsResult)
      const byId = new Map<string, Task>()
      for (const task of [...(tasksResult?.tasks ?? []), ...(meetingsResult?.tasks ?? [])]) {
        byId.set(task.id, task)
      }
      setTasks([...byId.values()])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instance, account, monthKey])

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
      if (!profile || !task.assignee_ids.includes(profile.id)) continue
      // A meeting task sits on the calendar on its meeting_date (even though it's complete) and never
      // on its due_date; a meeting with no date yet isn't shown at all.
      const day = task.is_meeting ? task.meeting_date : task.status === 'complete' ? null : task.due_date
      if (!day) continue
      const date = allDayDate(new Date(`${day}T00:00:00`))
      list.push({
        title: task.title,
        start: date,
        end: date,
        allDay: true,
        kind: task.source_category === 'flow' ? 'flow' : 'task',
        task,
      })
    }

    return list
  }, [outlookEvents, tasks, profile])

  const handleSelectEvent = useCallback(
    (event: CalendarEvent) => {
      if (event.kind === 'flow' && event.task?.project_id) {
        onClose()
        openFlowReportModal(event.task.project_id)
      }
    },
    [onClose, openFlowReportModal],
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
