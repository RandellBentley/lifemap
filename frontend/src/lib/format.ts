import { format } from 'date-fns'
import { parseDay } from './dates'

/** "Mar 5, 2026" for a yyyy-MM-dd date. */
export const formatDay = (day: string) => format(parseDay(day), 'MMM d, yyyy')
