import { useEffect, useState } from 'react'
import { fromKg, toKg, useWeightUnit } from '../lib/weight'

interface Props {
  /** Kilograms, or null for no weight. */
  valueKg: number | null
  onChange: (kg: number | null) => void
  id?: string
  'aria-label'?: string
}

const display = (kg: number | null, unit: 'kg' | 'lb') =>
  kg === null ? '' : String(Math.round(fromKg(kg, unit) * 100) / 100)

/**
 * Typed in the current unit, stored in kg. Keeps the text you type ("62.") instead of
 * re-rendering it from the converted number, and re-expresses it when you flip kg/lb.
 */
export function WeightInput({ valueKg, onChange, id, ...rest }: Props) {
  const [unit] = useWeightUnit()
  const [text, setText] = useState(() => display(valueKg, unit))

  useEffect(() => setText(display(valueKg, unit)), [unit])

  return (
    <span className="metric-input">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={text}
        aria-label={rest['aria-label']}
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value === '' ? null : toKg(Number(e.target.value), unit))
        }}
      />
      <span className="metric-input-unit">{unit}</span>
    </span>
  )
}
