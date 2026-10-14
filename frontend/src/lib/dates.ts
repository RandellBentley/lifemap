import { format } from 'date-fns'
import type { Entry } from '../api/types'

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/** Show an entry's time in the zone it happened in, not the viewer's. */
export function formatEntryDate(entry: Pick<Entry, 'occurred_at' | 'timezone'>, style: 'full' | 'short' = 'full') {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: style === 'full' ? 'full' : 'medium',
    timeStyle: 'short',
    timeZone: entry.timezone,
  }).format(new Date(entry.occurred_at))
}

/** ISO timestamp -> value for <input type="datetime-local"> in the browser's zone. */
export function toLocalInput(iso: string) {
  return format(new Date(iso), "yyyy-MM-dd'T'HH:mm")
}

export function fromLocalInput(value: string) {
  return new Date(value).toISOString()
}

/** Parse "yyyy-MM-dd" as a local calendar date (new Date("yyyy-MM-dd") would be UTC). */
export function parseDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const dayKey = (date: Date) => format(date, 'yyyy-MM-dd')
export const monthKey = (date: Date) => format(date, 'yyyy-MM')
