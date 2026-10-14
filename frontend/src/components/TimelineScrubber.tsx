import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { addMonths, format } from 'date-fns'
import type { TimelineSummary } from '../api/types'

interface Props {
  summary: TimelineSummary & { first: string; last: string }
  /** Instant currently centered in the timeline; positions the handle when not dragging. */
  value: string | null
  /** Called while dragging (final=false) and on release (final=true). */
  onScrub: (at: string, final: boolean) => void
}

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/**
 * A track spanning your whole history (not just what's loaded), with a bar per month
 * showing how much you wrote, and a draggable handle.
 */
export function TimelineScrubber({ summary, value, onScrub }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)

  const t0 = Date.parse(summary.first)
  const t1 = Date.parse(summary.last)
  const span = Math.max(t1 - t0, 1)
  const toFraction = (ms: number) => clamp((ms - t0) / span)
  const toInstant = (f: number) => new Date(t0 + f * span).toISOString()

  const fraction = drag ?? (value ? toFraction(Date.parse(value)) : 1)
  const shownDate = new Date(t0 + fraction * span)

  const bars = useMemo(() => {
    const max = Math.max(...summary.months.map((m) => m.count), 1)
    return summary.months.map((m) => {
      const [y, mo] = m.month.split('-').map(Number)
      const start = new Date(y, mo - 1, 1)
      const left = toFraction(start.getTime())
      const right = toFraction(addMonths(start, 1).getTime())
      return { key: m.month, left, width: Math.max(right - left, 0.004), height: 0.25 + 0.75 * (m.count / max), ...m }
    })
  }, [summary])

  const years = useMemo(() => {
    const out: { year: number; left: number }[] = []
    for (let y = new Date(t0).getFullYear() + 1; y <= new Date(t1).getFullYear(); y++) {
      out.push({ year: y, left: toFraction(new Date(y, 0, 1).getTime()) })
    }
    return out
  }, [summary])

  const fractionAt = (e: PointerEvent) => {
    const rect = track.current!.getBoundingClientRect()
    return clamp((e.clientX - rect.left) / rect.width)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const f = fractionAt(e)
    setDrag(f)
    onScrub(toInstant(f), false)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return
    const f = fractionAt(e)
    setDrag(f)
    onScrub(toInstant(f), false)
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return
    onScrub(toInstant(fractionAt(e)), true)
    setDrag(null)
  }

  // Keyboard: arrows step a month, Home/End jump to the ends.
  const onKeyDown = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, PageDown: -12, PageUp: 12 }[e.key]
    if (step) onScrub(addMonths(shownDate, step).toISOString(), true)
    else if (e.key === 'Home') onScrub(summary.first, true)
    else if (e.key === 'End') onScrub(summary.last, true)
    else return
    e.preventDefault()
  }

  return (
    <div className="scrubber">
      <span className="scrubber-end">{format(new Date(t0), 'MMM yyyy')}</span>
      <div
        className={`scrubber-track ${drag !== null ? 'dragging' : ''}`}
        ref={track}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="scrubber-bars" aria-hidden>
          {bars.map((b) => (
            <span
              key={b.key}
              className="scrubber-bar"
              style={{ left: `${b.left * 100}%`, width: `${b.width * 100}%`, height: `${b.height * 100}%` }}
              title={`${b.month}: ${b.count}`}
            />
          ))}
        </div>
        <div className="scrubber-line" />
        {years.map((y) => (
          <span key={y.year} className="scrubber-year" style={{ left: `${y.left * 100}%` }}>
            {y.year}
          </span>
        ))}
        <div
          className="scrubber-handle"
          style={{ left: `${fraction * 100}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Scrub through time"
          aria-valuemin={t0}
          aria-valuemax={t1}
          aria-valuenow={shownDate.getTime()}
          aria-valuetext={format(shownDate, 'MMMM yyyy')}
          onKeyDown={onKeyDown}
        >
          {drag !== null && <span className="scrubber-tooltip">{format(shownDate, 'MMM d, yyyy')}</span>}
        </div>
      </div>
      <span className="scrubber-end">{format(new Date(t1), 'MMM yyyy')}</span>
    </div>
  )
}
