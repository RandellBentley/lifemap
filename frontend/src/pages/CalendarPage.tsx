import { Link, useSearchParams } from 'react-router'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { useCalendar, useTimelineSummary } from '../api/hooks'
import type { EventSummary, GoalMarker } from '../api/types'
import { dayKey, monthKey } from '../lib/dates'
import { eventEnd } from '../lib/events'
import { MARKER_ICON, markerKey, markerSummary } from '../lib/goals'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = Array.from({ length: 12 }, (_, i) => format(new Date(2000, i, 1), 'MMMM'))
const MAX_BAR_ROWS = 3
const MAX_GOAL_ICONS = 3

interface WeekBar {
  event: EventSummary
  startCol: number
  endCol: number
  row: number
  continuesBefore: boolean
  continuesAfter: boolean
}

/** Cut each event to this week's columns; overlapping events stack into rows. */
function weekBars(week: string[], events: EventSummary[]): WeekBar[] {
  const first = week[0]
  const last = week[6]
  const rowEnds: number[] = []
  const bars: WeekBar[] = []
  for (const event of [...events].sort((a, b) => a.starts_on.localeCompare(b.starts_on))) {
    const end = eventEnd(event)
    if (event.starts_on > last || end < first) continue
    const startCol = event.starts_on < first ? 0 : week.indexOf(event.starts_on)
    const endCol = end > last ? 6 : week.indexOf(end)
    let row = rowEnds.findIndex((e) => e < startCol)
    if (row === -1) row = rowEnds.length
    rowEnds[row] = endCol
    if (row < MAX_BAR_ROWS) {
      bars.push({ event, startCol, endCol, row, continuesBefore: event.starts_on < first, continuesAfter: end > last })
    }
  }
  return bars
}

export function CalendarPage() {
  const [params, setParams] = useSearchParams()
  const month = params.get('month') ?? monthKey(new Date())
  const [year, monthIndex] = (() => {
    const [y, m] = month.split('-').map(Number)
    return [y, m - 1]
  })()
  const monthDate = new Date(year, monthIndex, 1)

  const { data, isError } = useCalendar(month)
  const { data: summary } = useTimelineSummary()
  const byDate = new Map(data?.days.map((d) => [d.date, d]))
  const markersByDate = new Map<string, GoalMarker[]>()
  for (const m of data?.goal_markers ?? []) markersByDate.set(m.date, [...(markersByDate.get(m.date) ?? []), m])
  const countByMonth = new Map(summary?.months.map((m) => [m.month, m.count]))

  // Offer every year you have entries for, plus a little room around the present.
  const thisYear = new Date().getFullYear()
  const firstYear = Math.min(summary?.first ? new Date(summary.first).getFullYear() : thisYear, thisYear - 5, year)
  const lastYear = Math.max(summary?.last ? new Date(summary.last).getFullYear() : thisYear, thisYear + 1, year)
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => lastYear - i)

  const goTo = (date: Date) => setParams({ month: monthKey(date) })
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(monthDate)),
    end: endOfWeek(endOfMonth(monthDate)),
  }).map(dayKey)
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7))

  return (
    <div className="page">
      <div className="page-header calendar-header">
        <div className="calendar-nav">
          <button className="btn" onClick={() => goTo(addMonths(monthDate, -12))} aria-label="Previous year">
            «
          </button>
          <button className="btn" onClick={() => goTo(addMonths(monthDate, -1))} aria-label="Previous month">
            ‹
          </button>
          <select
            className="calendar-select"
            aria-label="Month"
            value={monthIndex}
            onChange={(e) => goTo(new Date(year, Number(e.target.value), 1))}
          >
            {MONTHS.map((name, i) => {
              const count = countByMonth.get(`${year}-${String(i + 1).padStart(2, '0')}`)
              return (
                <option key={name} value={i}>
                  {name}
                  {count ? ` (${count})` : ''}
                </option>
              )
            })}
          </select>
          <select
            className="calendar-select"
            aria-label="Year"
            value={year}
            onChange={(e) => goTo(new Date(Number(e.target.value), monthIndex, 1))}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => goTo(addMonths(monthDate, 1))} aria-label="Next month">
            ›
          </button>
          <button className="btn" onClick={() => goTo(addMonths(monthDate, 12))} aria-label="Next year">
            »
          </button>
        </div>
        <button className="btn" onClick={() => setParams({})}>
          Today
        </button>
      </div>

      {/* Year at a glance: jump to any month, with how many entries each has. */}
      <div className="month-strip" role="tablist" aria-label={`Months of ${year}`}>
        {MONTHS.map((name, i) => {
          const key = `${year}-${String(i + 1).padStart(2, '0')}`
          const count = countByMonth.get(key) ?? 0
          return (
            <button
              key={key}
              role="tab"
              aria-selected={i === monthIndex}
              className={`month-chip ${i === monthIndex ? 'active' : ''} ${count ? 'has-entries' : ''}`}
              onClick={() => goTo(new Date(year, i, 1))}
            >
              <span>{name.slice(0, 3)}</span>
              <span className="month-chip-count">{count || '·'}</span>
            </button>
          )
        })}
      </div>

      {isError && <p className="error">Couldn’t load this month.</p>}

      <div className="calendar">
        <div className="calendar-weekdays">
          {WEEKDAYS.map((d) => (
            <div key={d} className="calendar-weekday">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="calendar-week">
            {week.map((key) => {
              const date = new Date(`${key}T00:00`)
              const info = byDate.get(key)
              const classes = [
                'calendar-day',
                !isSameMonth(date, monthDate) && 'outside',
                isToday(date) && 'today',
                info && 'has-entries',
              ]
                .filter(Boolean)
                .join(' ')

              const goals = markersByDate.get(key) ?? []
              // The cell is a container: a full-size link to the day sits underneath, and goal
              // icons are their own links on top (links can't be nested).
              return (
                <div key={key} className={`${classes} ${goals.length ? 'has-goals' : ''}`}>
                  {info?.cover_thumb && <img src={info.cover_thumb} alt="" loading="lazy" />}
                  {(info || goals.length > 0) && (
                    <Link to={`/day/${key}`} className="day-link" aria-label={`Open ${format(date, 'MMMM d')}`} />
                  )}
                  <span className="day-number">{format(date, 'd')}</span>
                  {info && (
                    <span className="day-counts">
                      {info.entry_count} {info.entry_count === 1 ? 'entry' : 'entries'}
                      {info.media_count > 0 && ` · ${info.media_count} 📷`}
                    </span>
                  )}
                  {goals.length > 0 && (
                    <span className="day-goals">
                      {goals.slice(0, MAX_GOAL_ICONS).map((m) => (
                        <Link key={markerKey(m)} to={`/goals/${m.goal.id}`} className={`day-goal kind-${m.kind}`} title={markerSummary(m)}>
                          {MARKER_ICON[m.kind]}
                        </Link>
                      ))}
                      {goals.length > MAX_GOAL_ICONS && (
                        <span className="day-goal more" title={goals.slice(MAX_GOAL_ICONS).map(markerSummary).join('\n')}>
                          +{goals.length - MAX_GOAL_ICONS}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              )
            })}

            <div className="calendar-week-events">
              {weekBars(week, data?.events ?? []).map((bar) => (
                <Link
                  key={bar.event.id}
                  to={`/events/${bar.event.id}`}
                  className={`calendar-event ${bar.continuesBefore ? 'cont-before' : ''} ${bar.continuesAfter ? 'cont-after' : ''}`}
                  style={{ gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`, gridRow: bar.row + 1 }}
                  title={bar.event.title}
                >
                  {bar.event.title}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
