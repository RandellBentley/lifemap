import type { Metric, MetricKind } from '../api/types'

/** Mirrors backend goals/units.py: which display units each kind accepts. */
export const KINDS: { kind: MetricKind; label: string; units: string[] | null; hint: string }[] = [
  { kind: 'weight', label: 'Weight', units: ['lb', 'kg'], hint: 'e.g. body weight' },
  { kind: 'money', label: 'Money', units: null, hint: 'e.g. a debt balance or savings' },
  { kind: 'count', label: 'Count', units: null, hint: 'e.g. study sessions, books read' },
  { kind: 'duration', label: 'Time', units: ['h', 'min'], hint: 'e.g. hours practiced' },
  { kind: 'distance', label: 'Distance', units: ['mi', 'km', 'm'], hint: 'e.g. miles run' },
  { kind: 'percent', label: 'Percent', units: ['%'], hint: 'e.g. course completion' },
]

export const DEFAULT_UNIT: Record<MetricKind, string> = {
  weight: 'lb',
  money: 'USD',
  count: 'times',
  duration: 'h',
  distance: 'mi',
  percent: '%',
}

/** Factor to the kind's base unit (mirrors goals/units.py), for converting between display units. */
const FACTOR: Record<string, number> = { kg: 1, lb: 0.45359237, km: 1000, mi: 1609.344, m: 1, h: 3600, min: 60 }

/** Re-express a value when the display unit changes within a kind (e.g. 180 lb -> 81.6466 kg). */
export function convertUnit(value: number | null, from: string, to: string): number | null {
  if (value === null || !(from in FACTOR) || !(to in FACTOR)) return value
  return Math.round(((value * FACTOR[from]) / FACTOR[to]) * 10000) / 10000
}

export const UNIT_LABEL: Record<string, string> = { h: 'hours', min: 'minutes', mi: 'miles', km: 'kilometers', m: 'meters' }

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

type Measured = Pick<Metric, 'kind' | 'unit'>

/** Format a value given in the metric's display unit: "168.2 lb", "$7,400.00", "12h 30m". */
export function formatValue(metric: Measured, value: number): string {
  switch (metric.kind) {
    case 'money':
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: metric.unit }).format(value)
      } catch {
        return `${number.format(value)} ${metric.unit}`
      }
    case 'duration': {
      const totalMinutes = Math.round(metric.unit === 'h' ? value * 60 : value)
      const sign = totalMinutes < 0 ? '−' : ''
      const h = Math.floor(Math.abs(totalMinutes) / 60)
      const m = Math.abs(totalMinutes) % 60
      return `${sign}${h ? `${h}h` : ''}${h && m ? ' ' : ''}${m || !h ? `${m}m` : ''}`
    }
    case 'percent':
      return `${number.format(value)}%`
    default:
      return `${number.format(value)} ${metric.unit}`
  }
}

/** "x of y": plain units are said once ("15 of 50 sessions"); money and time format both sides. */
function ofPhrase(metric: Measured, part: number, whole: number): string {
  const plain = metric.kind !== 'money' && metric.kind !== 'duration'
  return plain ? `${number.format(part)} of ${formatValue(metric, whole)}` : `${formatValue(metric, part)} of ${formatValue(metric, whole)}`
}

/** One line for where a metric stands, e.g. "168 lb · 12 of 15 lb down (80%)". */
export function describeProgress(metric: Metric): string {
  const p = metric.progress
  if (p.current === null) return 'No readings yet'
  const pct = p.progress !== null ? ` (${Math.round(p.progress * 100)}%)` : ''
  if (metric.mode === 'latest') {
    if (p.target === null || p.start === null || p.change === null) return `Latest: ${formatValue(metric, p.current)}`
    const needed = Math.abs(p.target - p.start)
    return `${formatValue(metric, p.current)} · ${ofPhrase(metric, Math.abs(p.change), needed)} ${p.direction}${pct}`
  }
  if (p.target === null) return `Total: ${formatValue(metric, p.current)}`
  return `${ofPhrase(metric, p.current, p.target)}${pct}`
}
