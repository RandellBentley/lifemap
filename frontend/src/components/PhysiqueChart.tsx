import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { format } from 'date-fns'
import type { ProgressReport } from '../api/types'
import { parseDay } from '../lib/dates'
import { formatWeight, fromKg, useWeightUnit } from '../lib/weight'
import { LineChart } from './LineChart'

const MIN_POINTS = 2
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

/**
 * Body weight over time from physique updates (newest first, as the API lists them). A hovered
 * point shows the update's first photo; clicking it opens the update.
 */
export function PhysiqueChart({ reports }: { reports: ProgressReport[] }) {
  const [unit] = useWeightUnit()
  const navigate = useNavigate()
  const weighed = useMemo(() => reports.filter((r) => r.body_weight_kg !== null).reverse(), [reports])

  if (weighed.length < MIN_POINTS) {
    return (
      <div className="chart-empty">
        <span>Not enough entries for graph</span>
        <span className="muted small">
          {weighed.length} of {MIN_POINTS} updates with a body weight
        </span>
      </div>
    )
  }

  // Plot in the chosen unit, so the axis ticks are round numbers of kg or lb.
  const points = weighed.map((r) => ({ key: r.id, t: parseDay(r.recorded_on).getTime(), value: fromKg(r.body_weight_kg!, unit) }))
  const firstPhoto = (r: ProgressReport) => r.photos.find((p) => p.status === 'ready' && p.urls.thumb)?.urls.thumb

  return (
    <LineChart
      points={points}
      format={(v) => `${number.format(v)} ${unit}`}
      name="Body weight"
      noun="updates"
      image={(i) => firstPhoto(weighed[i])}
      tooltip={(i) => {
        const r = weighed[i]
        return (
          <>
            <strong>{formatWeight(r.body_weight_kg, unit)}</strong>
            <span className="muted small">{format(points[i].t, 'EEE, MMM d, yyyy')}</span>
            {r.photos.length > 0 && (
              <span className="muted small">
                {r.photos.length} {r.photos.length === 1 ? 'photo' : 'photos'}
              </span>
            )}
            <span className="muted small">Click to open</span>
          </>
        )
      }}
      onSelect={(i) => navigate(`/workouts/physique/${weighed[i].id}`)}
    />
  )
}
