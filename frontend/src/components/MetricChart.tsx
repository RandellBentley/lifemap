import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { format } from 'date-fns'
import type { Measurement, Metric } from '../api/types'
import { parseDay } from '../lib/dates'
import { formatValue } from '../lib/units'

const HEIGHT = 200 // includes the x-axis band, so the card never needs an inner scroll
const MARGIN = { top: 14, right: 76, bottom: 28 } // left is measured from the tick labels
const MIN_POINTS = 2

interface Point {
  t: number
  /** Plotted value: the reading itself, or the running total so far. */
  value: number
  reading: Measurement
}

/**
 * Change over time for one metric: a single series, so no legend (the card names it).
 * Latest-reading metrics plot each reading; running totals plot the cumulative sum.
 * The target is a labeled reference line; readings logged with a milestone get a larger dot.
 */
export function MetricChart({ metric, readings }: { metric: Metric; readings: Measurement[] }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)

  const points = useMemo<Point[]>(() => {
    let running = metric.mode === 'total' ? (metric.progress.start ?? 0) : 0
    return readings.map((reading) => {
      if (metric.mode === 'total') running += reading.value
      return { t: parseDay(reading.recorded_on).getTime(), value: metric.mode === 'total' ? running : reading.value, reading }
    })
  }, [readings, metric.mode, metric.progress.start])

  // Re-attach when the empty state swaps for the chart (a different element gets the ref).
  const chartable = points.length >= MIN_POINTS
  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [chartable])

  if (!chartable) {
    return (
      <div className="chart-empty" ref={box}>
        <span>More data points needed to chart progress</span>
        <span className="muted small">
          {points.length} of {MIN_POINTS} readings logged
        </span>
      </div>
    )
  }

  const fmt = (v: number) => formatValue(metric, v)
  const target = metric.target_value

  // --- scales -------------------------------------------------------------------------
  const values = points.map((p) => p.value).concat(target !== null ? [target] : [])
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4)
  const [yMin, yMax] = [ticks[0], ticks[ticks.length - 1]]
  const left = Math.max(...ticks.map((t) => fmt(t).length)) * 6.6 + 14
  const plotW = Math.max(width - left - MARGIN.right, 40)
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom

  let [t0, t1] = [points[0].t, points[points.length - 1].t]
  if (t0 === t1) [t0, t1] = [t0 - 86_400_000, t1 + 86_400_000] // all on one day: give it width
  const x = (t: number) => left + ((t - t0) / (t1 - t0)) * plotW
  const y = (v: number) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH

  const spanDays = (t1 - t0) / 86_400_000
  const xTickCount = Math.max(2, Math.min(5, Math.floor(plotW / 110)))
  const xTicks = Array.from({ length: xTickCount }, (_, i) => t0 + ((t1 - t0) * i) / (xTickCount - 1))
  const xLabel = (t: number) => format(new Date(t), spanDays > 300 ? 'MMM yyyy' : 'MMM d')

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  const showAllMarkers = points.length <= 40

  // --- hover / keyboard: the crosshair snaps to the nearest reading --------------------
  const nearest = (px: number) => {
    let best = 0
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].t) - px) < Math.abs(x(points[best].t) - px)) best = i
    return best
  }
  const onPointerMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    setActive(nearest(e.clientX - rect.left))
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(points.length - 1)
    else if (step) setActive((a) => Math.min(points.length - 1, Math.max(0, (a ?? points.length - 1) + step)))
    else return
    e.preventDefault()
  }

  const hovered = active !== null ? points[active] : null
  const summary = `${metric.name}: ${points.length} readings from ${format(new Date(points[0].t), 'MMM d, yyyy')} to ${format(
    new Date(last.t),
    'MMM d, yyyy',
  )}; latest ${fmt(last.value)}${target !== null ? `, target ${fmt(target)}` : ''}. Use arrow keys to step through readings.`

  return (
    <div className="chart" ref={box}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={summary}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => setActive((a) => a ?? points.length - 1)}
          onBlur={() => setActive(null)}
        >
          {/* gridlines + y ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} />
              <text className="chart-tick" x={left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {fmt(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text
              key={i}
              className="chart-tick"
              x={x(t)}
              y={HEIGHT - 8}
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            >
              {xLabel(t)}
            </text>
          ))}

          {/* target reference line (a threshold, so dashed; gridlines stay solid) */}
          {target !== null && (
            <g>
              <line className="chart-target" x1={left} x2={left + plotW} y1={y(target)} y2={y(target)} />
              <text className="chart-target-label" x={left + plotW + 6} y={y(target)} dominantBaseline="middle">
                Target
              </text>
            </g>
          )}

          <path className="chart-line" d={path} />

          {points.map((p, i) => {
            const milestone = !!p.reading.milestone
            if (!showAllMarkers && !milestone && i !== points.length - 1) return null
            return (
              <circle
                key={p.reading.id}
                className={`chart-dot ${milestone ? 'milestone' : ''} ${active === i ? 'active' : ''}`}
                cx={x(p.t)}
                cy={y(p.value)}
                r={milestone ? 6 : 4}
              />
            )
          })}

          {/* direct label on the latest value only */}
          <text className="chart-end-label" x={x(last.t) + 10} y={y(last.value)} dominantBaseline="middle">
            {fmt(last.value)}
          </text>

          {hovered && <line className="chart-crosshair" x1={x(hovered.t)} x2={x(hovered.t)} y1={MARGIN.top} y2={MARGIN.top + plotH} />}

          {/* hit layer: the whole plot, so the pointer only has to be nearest a date */}
          <rect
            className="chart-hit"
            x={left}
            y={MARGIN.top}
            width={plotW}
            height={plotH}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}

      {hovered && (
        <div
          className="chart-tooltip"
          role="status"
          style={{
            left: Math.min(Math.max(x(hovered.t), 90), width - 90),
            top: Math.max(y(hovered.value) - 12, 0),
          }}
        >
          <strong>{fmt(hovered.value)}</strong>
          {metric.mode === 'total' && <span className="muted small">+{fmt(hovered.reading.value)} this time</span>}
          <span className="muted small">{format(new Date(hovered.t), 'EEE, MMM d, yyyy')}</span>
          {hovered.reading.milestone && <span className="small">🏁 {hovered.reading.milestone.title}</span>}
          {hovered.reading.note && <span className="muted small">{hovered.reading.note}</span>}
        </div>
      )}
    </div>
  )
}

/** Round axis ticks (1 / 2 / 2.5 / 5 × 10ⁿ) that cover [min, max]. */
function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) [min, max] = [min - 1, max + 1]
  const raw = (max - min) / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v / step) * step)
  return ticks
}
