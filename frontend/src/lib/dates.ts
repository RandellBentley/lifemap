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

/** ISO timestamp -> datetime-local value showing the wall-clock time in `timeZone`. */
export function toZonedInput(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/** Wall-clock datetime-local value in `timeZone` -> ISO timestamp. */
export function fromZonedInput(value: string, timeZone: string) {
  const wall = Date.parse(`${value}:00Z`)
  // Subtract the zone's offset at that moment; the second pass settles daylight-saving edges.
  let t = wall
  for (let i = 0; i < 2; i++) t = wall - (Date.parse(`${toZonedInput(new Date(t).toISOString(), timeZone)}:00Z`) - t)
  return new Date(t).toISOString()
}

/** Parse "yyyy-MM-dd" as a local calendar date (new Date("yyyy-MM-dd") would be UTC). */
export function parseDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const dayKey = (date: Date) => format(date, 'yyyy-MM-dd')
export const monthKey = (date: Date) => format(date, 'yyyy-MM')
