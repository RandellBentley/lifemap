import { addDays, differenceInCalendarDays } from 'date-fns'
import type { Entry, EventSummary } from '../api/types'
import type { UploadSummary } from './usePhotoQueue'
import { dayKey, parseDay } from './dates'

/** Last day of the event; an ongoing event runs through today. */
export function eventEnd(event: EventSummary): string {
  if (event.ends_on) return event.ends_on
  const today = dayKey(new Date())
  return today > event.starts_on ? today : event.starts_on
}

export function eventDayCount(event: EventSummary): number {
  return differenceInCalendarDays(parseDay(eventEnd(event)), parseDay(event.starts_on)) + 1
}

/** 1-based day within the event, or null if the date falls outside it. */
export function eventDayNumber(event: EventSummary, day: string): number | null {
  if (day < event.starts_on || day > eventEnd(event)) return null
  return differenceInCalendarDays(parseDay(day), parseDay(event.starts_on)) + 1
}

/** Every date the event covers, as yyyy-MM-dd. */
export function eventDays(event: EventSummary): string[] {
  const start = parseDay(event.starts_on)
  return Array.from({ length: eventDayCount(event) }, (_, i) => dayKey(addDays(start, i)))
}

const rangeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** "Jul 3 – 12, 2026", "Jul 3, 2026", or "Jul 3, 2026 – ongoing". */
export function formatEventRange(event: EventSummary): string {
  const start = parseDay(event.starts_on)
  if (!event.ends_on) return `${rangeFormat.format(start)} – ongoing`
  if (event.ends_on === event.starts_on) return rangeFormat.format(start)
  return rangeFormat.formatRange(start, parseDay(event.ends_on))
}

/** Day entries created by event uploads have no title; name them after their event day. */
export function entryTitle(entry: Entry): string {
  if (entry.title) return entry.title
  const event = entry.event_summary
  const day = event && eventDayNumber(event, entry.occurred_on)
  return event ? (day ? `${event.title} — Day ${day}` : event.title) : 'Untitled'
}

export function describeUpload(s: UploadSummary): string {
  const parts = [
    `Added ${s.uploaded} ${s.uploaded === 1 ? 'photo or video' : 'photos & videos'} across ${s.days} ${s.days === 1 ? 'day' : 'days'}` +
      (s.createdDays ? ` (${s.createdDays} new day ${s.createdDays === 1 ? 'entry' : 'entries'}).` : '.'),
  ]
  if (s.outside) parts.push(`${s.outside} taken outside the event’s dates went to its first or last day.`)
  if (s.failed) parts.push(`${s.failed} failed to upload — retry below.`)
  return parts.join(' ')
}
