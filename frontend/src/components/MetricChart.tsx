import { useMemo } from 'react'
import { format } from 'date-fns'
import type { Measurement, Metric } from '../api/types'
import { parseDay } from '../lib/dates'
import { formatValue } from '../lib/units'
import { LineChart, type ChartPoint } from './LineChart'

const MIN_POINTS = 2

/**
 * Change over time for one metric. Latest-reading metrics plot each reading; running totals
 * plot the cumulative sum. Readings logged with a milestone get a larger dot.
 */
export function MetricChart({ metric, readings }: { metric: Metric; readings: Measurement[] }) {
  const points = useMemo<(ChartPoint & { reading: Measurement })[]>(() => {
    let running = metric.mode === 'total' ? (metric.progress.start ?? 0) : 0
    return readings.map((reading) => {
      if (metric.mode === 'total') running += reading.value
      return {
        key: reading.id,
        t: parseDay(reading.recorded_on).getTime(),
        value: metric.mode === 'total' ? running : reading.value,
        emphasized: !!reading.milestone,
        reading,
      }
    })
  }, [readings, metric.mode, metric.progress.start])

  if (points.length < MIN_POINTS) {
    return (
      <div className="chart-empty">
        <span>More data points needed to chart progress</span>
        <span className="muted small">
          {points.length} of {MIN_POINTS} readings logged
        </span>
      </div>
    )
  }

  const fmt = (v: number) => formatValue(metric, v)
  return (
    <LineChart
      points={points}
      format={fmt}
      name={metric.name}
      noun="readings"
      target={metric.target_value}
      tooltip={(i) => {
        const p = points[i]
        return (
          <>
            <strong>{fmt(p.value)}</strong>
            {metric.mode === 'total' && <span className="muted small">+{fmt(p.reading.value)} this time</span>}
            <span className="muted small">{format(new Date(p.t), 'EEE, MMM d, yyyy')}</span>
            {p.reading.milestone && <span className="small">🏁 {p.reading.milestone.title}</span>}
            {p.reading.note && <span className="muted small">{p.reading.note}</span>}
          </>
        )
      }}
    />
  )
}
