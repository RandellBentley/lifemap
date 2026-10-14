import { useEffect, useState } from 'react'
import type { Metric } from '../api/types'
import { UNIT_LABEL } from '../lib/units'

interface Props {
  metric: Pick<Metric, 'kind' | 'unit'>
  /** In the metric's display unit; null when empty. */
  value: number | null
  onChange: (value: number | null) => void
  id?: string
  placeholder?: string
}

/** A number in the metric's unit; durations get separate hours and minutes boxes. */
export function MetricValueInput({ metric, value, onChange, id, placeholder }: Props) {
  if (metric.kind === 'duration') return <DurationInput metric={metric} value={value} onChange={onChange} id={id} />

  const suffix = metric.kind === 'money' ? metric.unit : metric.kind === 'percent' ? '%' : (UNIT_LABEL[metric.unit] ?? metric.unit)
  return (
    <span className="metric-input">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
      <span className="metric-input-unit">{suffix}</span>
    </span>
  )
}

function DurationInput({ metric, value, onChange, id }: Props) {
  // Value is in hours or minutes (the metric's unit); edit it as h + min.
  const toMinutes = (v: number) => (metric.unit === 'h' ? v * 60 : v)
  const fromMinutes = (m: number) => (metric.unit === 'h' ? m / 60 : m)
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')

  useEffect(() => {
    if (value === null) {
      setHours('')
      setMinutes('')
      return
    }
    const total = Math.round(toMinutes(value))
    setHours(String(Math.floor(total / 60)))
    setMinutes(String(total % 60))
  }, [value === null])

  const update = (h: string, m: string) => {
    setHours(h)
    setMinutes(m)
    if (h === '' && m === '') return onChange(null)
    onChange(fromMinutes((Number(h) || 0) * 60 + (Number(m) || 0)))
  }

  return (
    <span className="metric-input duration">
      <input id={id} type="number" min={0} inputMode="numeric" value={hours} onChange={(e) => update(e.target.value, minutes)} aria-label="Hours" />
      <span className="metric-input-unit">h</span>
      <input type="number" min={0} max={59} inputMode="numeric" value={minutes} onChange={(e) => update(hours, e.target.value)} aria-label="Minutes" />
      <span className="metric-input-unit">min</span>
    </span>
  )
}
