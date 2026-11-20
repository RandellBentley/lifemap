import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { format } from 'date-fns'
import { useExercises, useLiftHistory } from '../api/hooks'
import { parseDay } from '../lib/dates'
import { formatDay } from '../lib/format'
import { formatWeight, fromKg, useWeightUnit } from '../lib/weight'
import { LineChart } from './LineChart'

const MIN_POINTS = 2
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

/**
 * Workouts → Progress: pick a lift, see its heaviest made set per workout over time.
 * The chosen lift lives in the URL (?lift=<id>), so back/forward and reloads keep it.
 */
export function LiftProgress() {
  const { data: exercises, isPending, isError } = useExercises()
  const [params, setParams] = useSearchParams()
  // Default to the lift you've logged most.
  const fallback = exercises?.reduce((a, b) => (b.use_count > a.use_count ? b : a), exercises[0])
  const lift = exercises?.find((e) => e.id === params.get('lift')) ?? fallback

  if (isPending) return <p className="muted">Loading…</p>
  if (isError) return <p className="error">Couldn’t load your lifts.</p>
  if (!lift) {
    return (
      <div className="empty">
        <p>No lifts yet. Log a workout and your progress will chart here.</p>
        <Link to="/workouts/new" className="btn primary">
          Log your first workout
        </Link>
      </div>
    )
  }

  return (
    <section className="card lift-progress">
      <label className="field lift-picker">
        <span>Lift</span>
        <select className="exercise-select" value={lift.id} onChange={(e) => setParams({ lift: e.target.value }, { replace: true })}>
          {exercises.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <LiftChart exerciseId={lift.id} name={lift.name} />
    </section>
  )
}

function LiftChart({ exerciseId, name }: { exerciseId: string; name: string }) {
  const { data: history, isPending, isError } = useLiftHistory(exerciseId)
  const [unit] = useWeightUnit()
  const navigate = useNavigate()
  const [showTable, setShowTable] = useState(false)

  if (isPending) return <div className="chart-empty muted small">Loading chart…</div>
  if (isError) return <p className="error">Couldn’t load {name} history.</p>
  if (history.length < MIN_POINTS) {
    return (
      <div className="chart-empty">
        <span>Not enough recorded workouts for {name} to chart progress</span>
        <span className="muted small">
          {history.length} of {MIN_POINTS} workouts with a made, weighted set
        </span>
      </div>
    )
  }

  // Plot in the chosen unit, so the axis ticks are round numbers of kg or lb.
  const points = history.map((h) => ({ key: h.workout_id, t: parseDay(h.date).getTime(), value: fromKg(h.weight_kg, unit) }))
  const best = history.reduce((a, b) => (b.weight_kg > a.weight_kg ? b : a))
  const reps = (n: number) => `${n} ${n === 1 ? 'rep' : 'reps'}`

  return (
    <>
      <p className="muted small lift-progress-note">
        Heaviest made set in each workout. Best: <strong>{formatWeight(best.weight_kg, unit)}</strong> × {reps(best.reps)} on{' '}
        {formatDay(best.date)}.
      </p>
      <LineChart
        points={points}
        format={(v) => `${number.format(v)} ${unit}`}
        name={`${name}, heaviest made set per workout`}
        noun="workouts"
        tooltip={(i) => (
          <>
            <strong>{formatWeight(history[i].weight_kg, unit)}</strong>
            <span className="small">× {reps(history[i].reps)}</span>
            <span className="muted small">{format(points[i].t, 'EEE, MMM d, yyyy')}</span>
            <span className="muted small">Click to open the workout</span>
          </>
        )}
        onSelect={(i) => navigate(`/workouts/${history[i].workout_id}`)}
      />
      <button className="link-button small" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
        {showTable ? 'Hide' : 'Show'} {history.length} workouts
      </button>
      {showTable && (
        <table className="sets-table readonly">
          <thead>
            <tr>
              <th>Date</th>
              <th>Heaviest made set</th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((h) => (
              <tr key={h.workout_id}>
                <td>
                  <Link to={`/workouts/${h.workout_id}`}>{formatDay(h.date)}</Link>
                </td>
                <td>
                  {formatWeight(h.weight_kg, unit)} × {reps(h.reps)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
