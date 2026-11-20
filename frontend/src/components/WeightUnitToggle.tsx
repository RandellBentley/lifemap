import { useWeightUnit } from '../lib/weight'

/** kg / lb switch. Every weight on screen follows it; the choice is remembered in this browser. */
export function WeightUnitToggle() {
  const [unit, setUnit] = useWeightUnit()
  return (
    <div className="segmented" role="radiogroup" aria-label="Weight unit">
      {(['kg', 'lb'] as const).map((u) => (
        <button key={u} type="button" role="radio" aria-checked={unit === u} className={unit === u ? 'active' : ''} onClick={() => setUnit(u)}>
          {u}
        </button>
      ))}
    </div>
  )
}
