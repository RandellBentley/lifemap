import { Link } from 'react-router'
import type { Entry } from '../api/types'
import { eventDayNumber } from '../lib/events'

/** "◆ Hawaii · Day 3" link shown on entries that belong to an event. */
export function EventBadge({ entry, className = '' }: { entry: Entry; className?: string }) {
  const event = entry.event_summary
  if (!event) return null
  const day = eventDayNumber(event, entry.occurred_on)
  return (
    <Link to={`/events/${event.id}`} className={`event-badge ${className}`} title={`Part of ${event.title}`}>
      <span aria-hidden>◆</span> {event.title}
      {day && <span className="event-badge-day"> · Day {day}</span>}
    </Link>
  )
}
