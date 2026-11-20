import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { format } from 'date-fns'

const HEIGHT = 200 // includes the x-axis band, so the card never needs an inner scroll
const MARGIN = { top: 14, right: 76, bottom: 28 } // left is measured from the tick labels
const PHOTO_R = 20 // a hovered point with a photo grows to this radius and shows it

export interface ChartPoint {
  key: string
  t: number // ms timestamp of the day
  value: number
  emphasized?: boolean // drawn as a larger ring, e.g. a reading logged with a milestone
}

interface Props {
  points: ChartPoint[] // oldest first, at least two
  format: (value: number) => string
  /** Describes the series for screen readers, e.g. "Snatch: 5 workouts". */
  name: string
  noun: string
  target?: number | null
  tooltip: (index: number) => ReactNode
  /** Click or Enter on a point. */
  onSelect?: (index: number) => void
  /** A photo for a point, shown inside it while it's hovered or focused. */
  image?: (index: number) => string | null | undefined
}

/**
 * Change over time for one series: so no legend (the card names it). Thin line, a dot per
 * point, the latest value labeled directly, an optional dashed target, and a crosshair +
 * tooltip that snaps to the nearest point (pointer or arrow keys).
 */
export function LineChart({ points, format: fmt, name, noun, target = null, tooltip, onSelect, image }: Props) {
  const clipId = `chart-photo-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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

  // --- hover / keyboard: the crosshair snaps to the nearest point -----------------------
  const nearest = (px: number) => {
    let best = 0
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].t) - px) < Math.abs(x(points[best].t) - px)) best = i
    return best
  }
  const pointerIndex = (e: MouseEvent<SVGRectElement>) => nearest(e.clientX - e.currentTarget.ownerSVGElement!.getBoundingClientRect().left)
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(points.length - 1)
    else if (step) setActive((a) => Math.min(points.length - 1, Math.max(0, (a ?? points.length - 1) + step)))
    else if (e.key === 'Enter' && onSelect && active !== null) onSelect(active)
    else return
    e.preventDefault()
  }

  const hovered = active !== null ? points[active] : null
  const photo = active !== null ? image?.(active) : null
  const summary = `${name}: ${points.length} ${noun} from ${format(new Date(points[0].t), 'MMM d, yyyy')} to ${format(
    new Date(last.t),
    'MMM d, yyyy',
  )}; latest ${fmt(last.value)}${target !== null ? `, target ${fmt(target)}` : ''}. Use arrow keys to step through ${noun}${
    onSelect ? ', Enter to open one' : ''
  }.`

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
            if (!showAllMarkers && !p.emphasized && i !== points.length - 1) return null
            return (
              <circle
                key={p.key}
                className={`chart-dot ${p.emphasized ? 'milestone' : ''} ${active === i ? 'active' : ''}`}
                cx={x(p.t)}
                cy={y(p.value)}
                r={p.emphasized ? 6 : 4}
              />
            )
          })}

          {/* direct label on the latest value only (hidden while an enlarged photo point covers it;
              the tooltip shows the value then) */}
          {!(photo && active === points.length - 1) && (
            <text className="chart-end-label" x={x(last.t) + 10} y={y(last.value)} dominantBaseline="middle">
              {fmt(last.value)}
            </text>
          )}

          {hovered && <line className="chart-crosshair" x1={x(hovered.t)} x2={x(hovered.t)} y1={MARGIN.top} y2={MARGIN.top + plotH} />}

          {hovered && photo && (
            <g className="chart-photo" pointerEvents="none">
              <clipPath id={clipId}>
                <circle cx={x(hovered.t)} cy={y(hovered.value)} r={PHOTO_R} />
              </clipPath>
              <circle className="chart-photo-ring" cx={x(hovered.t)} cy={y(hovered.value)} r={PHOTO_R + 2} />
              <image
                href={photo}
                x={x(hovered.t) - PHOTO_R}
                y={y(hovered.value) - PHOTO_R}
                width={PHOTO_R * 2}
                height={PHOTO_R * 2}
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#${clipId})`}
              />
            </g>
          )}

          {/* hit layer: the whole plot, so the pointer only has to be nearest a date. It extends past
              both ends so the first and last points, which sit on the edges, are fully clickable. */}
          <rect
            className={`chart-hit ${onSelect ? 'selectable' : ''}`}
            x={left - PHOTO_R}
            y={MARGIN.top}
            width={plotW + PHOTO_R * 2}
            height={plotH}
            onPointerMove={(e) => setActive(pointerIndex(e))}
            onPointerLeave={() => setActive(null)}
            onClick={onSelect && ((e) => onSelect(pointerIndex(e)))}
          />
        </svg>
      )}

      {hovered && active !== null && (
        <div
          className="chart-tooltip"
          role="status"
          style={{
            left: Math.min(Math.max(x(hovered.t), 90), width - 90),
            top: Math.max(y(hovered.value) - (photo ? PHOTO_R + 10 : 12), 0),
          }}
        >
          {tooltip(active)}
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
