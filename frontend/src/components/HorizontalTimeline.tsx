import {
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import { Link } from 'react-router'
import { format } from 'date-fns'
import type { Entry, EventSummary, GoalMarker, MediaAsset } from '../api/types'
import { parseDay } from '../lib/dates'
import { MARKER_ICON, MARKER_LABEL, markerKey } from '../lib/goals'
import { entryTitle, eventDayNumber, formatEventRange } from '../lib/events'
import { MediaStrip } from './MediaStrip'

export interface HorizontalTimelineHandle {
  /** Center the first entry at or after `at` (ISO instant). */
  scrollToInstant: (at: string, behavior?: ScrollBehavior) => void
}

interface Props {
  ref?: Ref<HorizontalTimelineHandle>
  entries: Entry[] // oldest -> newest
  hasOlder: boolean
  hasNewer: boolean
  loadOlder: () => void
  loadNewer: () => void
  loadingOlder: boolean
  loadingNewer: boolean
  /** Where to start: an ISO instant, or "latest" for the right-hand end. */
  initialFocus: string | 'latest'
  /** Reports the occurred_at of the entry nearest the viewport center as you scroll. */
  onCenterChange: (at: string) => void
  onOpenMedia: (asset: MediaAsset) => void
  highlightTag?: string
  /** Goal starts, milestones and achievements to place among the entries by date. */
  markers?: GoalMarker[]
}

type Row = { kind: 'entry'; entry: Entry; at: string; month: string } | { kind: 'marker'; marker: GoalMarker; at: string; month: string }

/** Interleave markers (date-only) with entries; a marker goes after that day's entries. */
function mergeRows(entries: Entry[], markers: GoalMarker[]): Row[] {
  const sorted = [...markers].sort((a, b) => a.date.localeCompare(b.date))
  const rows: Row[] = []
  const markerRow = (marker: GoalMarker): Row => ({
    kind: 'marker',
    marker,
    at: `${marker.date}T12:00:00`, // no zone suffix: parsed as local midday
    month: marker.date.slice(0, 7),
  })
  let next = 0
  for (const entry of entries) {
    while (next < sorted.length && sorted[next].date < entry.occurred_on) rows.push(markerRow(sorted[next++]))
    rows.push({ kind: 'entry', entry, at: entry.occurred_at, month: format(new Date(entry.occurred_at), 'yyyy-MM') })
  }
  while (next < sorted.length) rows.push(markerRow(sorted[next++]))
  return rows
}

const EDGE_PX = 600 // start loading this far before reaching either end
const BAND_ROW_PX = 30 // height of one row of event bands above the cards

interface Band {
  event: EventSummary
  left: number
  width: number
  row: number
}

/** One band per event, spanning its loaded cards; overlapping events stack into rows. */
function measureBands(list: HTMLElement, entries: Entry[]): Band[] {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const spans = new Map<string, { event: EventSummary; left: number; right: number }>()
  for (const el of list.querySelectorAll<HTMLElement>('[data-entry]')) {
    const event = byId.get(el.dataset.entry!)?.event_summary
    if (!event) continue
    const span = spans.get(event.id) ?? { event, left: Infinity, right: -Infinity }
    span.left = Math.min(span.left, el.offsetLeft)
    span.right = Math.max(span.right, el.offsetLeft + el.offsetWidth)
    spans.set(event.id, span)
  }
  const rowEnds: number[] = []
  return [...spans.values()]
    .sort((a, b) => a.left - b.left)
    .map(({ event, left, right }) => {
      let row = rowEnds.findIndex((end) => end < left - 8)
      if (row === -1) row = rowEnds.length
      rowEnds[row] = right
      return { event, left, width: right - left, row }
    })
}

/**
 * Oldest on the left, newest on the right. Loads more as you approach either end and
 * keeps your place when older entries are inserted to the left.
 */
export function HorizontalTimeline({
  ref,
  entries,
  hasOlder,
  hasNewer,
  loadOlder,
  loadNewer,
  loadingOlder,
  loadingNewer,
  initialFocus,
  onCenterChange,
  onOpenMedia,
  highlightTag,
  markers = [],
}: Props) {
  const rows = useMemo(() => mergeRows(entries, markers), [entries, markers])
  const scroller = useRef<HTMLDivElement>(null)

  const cards = () => [...(scroller.current?.querySelectorAll<HTMLElement>('[data-at]') ?? [])]

  const centerOn = (el: HTMLElement, behavior: ScrollBehavior = 'auto') => {
    const box = scroller.current!
    box.scrollTo({ left: el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2, behavior })
  }

  const scrollToInstant = useCallback((at: string, behavior: ScrollBehavior = 'auto') => {
    const all = cards()
    const ms = Date.parse(at)
    const target = all.find((el) => Date.parse(el.dataset.at!) >= ms) ?? all.at(-1)
    if (target) centerOn(target, behavior)
  }, [])

  useImperativeHandle(ref, () => ({ scrollToInstant }), [scrollToInstant])

  // Load more when near either end (also covers content narrower than the viewport).
  const checkEdges = useCallback(() => {
    const box = scroller.current
    if (!box) return
    if (hasOlder && !loadingOlder && box.scrollLeft < EDGE_PX) loadOlder()
    if (hasNewer && !loadingNewer && box.scrollLeft + box.clientWidth > box.scrollWidth - EDGE_PX) loadNewer()
  }, [hasOlder, hasNewer, loadingOlder, loadingNewer, loadOlder, loadNewer])

  // Report the entry under the viewport center (throttled to animation frames).
  const frame = useRef(0)
  const reportCenter = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const box = scroller.current
      if (!box) return
      const mid = box.scrollLeft + box.clientWidth / 2
      let best: HTMLElement | undefined
      let bestDist = Infinity
      for (const el of cards()) {
        const dist = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid)
        if (dist < bestDist) [best, bestDist] = [el, dist]
      }
      if (best) onCenterChange(best.dataset.at!)
    })
  }, [onCenterChange])

  // Keep the viewport still when older entries are prepended.
  const prev = useRef<{ firstId?: string; width: number }>({ width: 0 })
  const list = useRef<HTMLOListElement>(null)
  const [bands, setBands] = useState<Band[]>([])
  const bandRows = bands.length ? Math.max(...bands.map((b) => b.row)) + 1 : 0

  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const update = () => {
      const next = measureBands(el, entries)
      setBands((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [entries])

  // Initial positioning is pending until the target entry (or the newest end) has loaded.
  const pendingFocus = useRef<string | 'latest' | null>(initialFocus)

  useLayoutEffect(() => {
    const box = scroller.current
    if (!box) return
    const firstId = entries[0]?.id
    if (prev.current.firstId && firstId !== prev.current.firstId && entries.some((e) => e.id === prev.current.firstId)) {
      box.scrollLeft += box.scrollWidth - prev.current.width
    }
    prev.current = { firstId, width: box.scrollWidth }

    const focus = pendingFocus.current
    if (focus && rows.length) {
      const reached = focus !== 'latest' && rows.some((r) => Date.parse(r.at) >= Date.parse(focus))
      if (reached) {
        scrollToInstant(focus)
        pendingFocus.current = null
      } else {
        box.scrollLeft = box.scrollWidth // newest end; fetches newer entries if there are more
        if (!hasNewer) pendingFocus.current = null
      }
    }
  }, [entries, rows, hasNewer, scrollToInstant])

  useEffect(() => {
    checkEdges()
    reportCenter()
  }, [entries, checkEdges, reportCenter])

  // A vertical mouse wheel scrolls the timeline sideways.
  useEffect(() => {
    const box = scroller.current
    if (!box) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        box.scrollLeft += e.deltaY
        e.preventDefault()
      }
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => box.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div
      className="htimeline-scroller"
      ref={scroller}
      tabIndex={0}
      aria-label="Timeline"
      onScroll={() => {
        checkEdges()
        reportCenter()
      }}
    >
      <ol
        className="htimeline"
        ref={list}
        style={{ '--band-space': `${bandRows * BAND_ROW_PX}px` } as React.CSSProperties}
      >
        {bands.map((band) => (
          <li
            key={band.event.id}
            className="htimeline-band"
            style={{ left: band.left, width: band.width, top: 4 + band.row * BAND_ROW_PX }}
          >
            <Link to={`/events/${band.event.id}`} title={`${band.event.title} · ${formatEventRange(band.event)}`}>
              <span aria-hidden>◆</span> <strong>{band.event.title}</strong>
              <span className="htimeline-band-dates"> · {formatEventRange(band.event)}</span>
            </Link>
          </li>
        ))}
        {loadingOlder && <li className="htimeline-loading">Loading…</li>}
        {rows.map((row, i) => {
          const newMonth = i === 0 || rows[i - 1].month !== row.month
          const monthLabel = format(parseDay(`${row.month}-01`), 'MMM yyyy')
          return (
            <Fragment key={row.kind === 'entry' ? row.entry.id : markerKey(row.marker)}>
              {newMonth && (
                <li className="htimeline-month" aria-hidden>
                  <span>{monthLabel}</span>
                </li>
              )}
              {row.kind === 'entry' ? (
                <li className="htimeline-item" data-at={row.entry.occurred_at} data-entry={row.entry.id}>
                  <TimelineCard entry={row.entry} onOpenMedia={onOpenMedia} highlightTag={highlightTag} />
                  <span className="htimeline-dot" />
                  <time className="htimeline-date" dateTime={row.entry.occurred_at}>
                    {format(new Date(row.entry.occurred_at), 'MMM d')}
                  </time>
                </li>
              ) : (
                <li className={`htimeline-item goal-marker kind-${row.marker.kind}`} data-at={row.at}>
                  <GoalMarkerCard marker={row.marker} />
                  <span className="htimeline-dot goal" />
                  <time className="htimeline-date" dateTime={row.marker.date}>
                    {format(parseDay(row.marker.date), 'MMM d')}
                  </time>
                </li>
              )}
            </Fragment>
          )
        })}
        {loadingNewer && <li className="htimeline-loading">Loading…</li>}
      </ol>
    </div>
  )
}

interface CardProps {
  entry: Entry
  onOpenMedia: (a: MediaAsset) => void
  highlightTag?: string
}

function TimelineCard({ entry, onOpenMedia, highlightTag }: CardProps) {
  const media = entry.media.filter((m) => m.status !== 'failed')
  const day = entry.event_summary ? eventDayNumber(entry.event_summary, entry.occurred_on) : null
  return (
    <article className={`tcard ${entry.event_summary ? 'in-event' : ''}`}>
      {entry.event_summary && <span className="tcard-event-day">{day ? `Day ${day}` : entry.event_summary.title}</span>}
      <Link to={`/entries/${entry.id}`} className="tcard-title">
        {entryTitle(entry)}
      </Link>
      {entry.body && <p className="tcard-body">{entry.body}</p>}
      <div className="tcard-spacer" />
      <MediaStrip media={media} onOpen={onOpenMedia} highlightTag={highlightTag} />
      {entry.tags.length > 0 && (
        <div className="tcard-tags">
          {entry.tags.slice(0, 3).map((t) => (
            <Link key={t} to={`/timeline?tag=${encodeURIComponent(t)}`} className="tag small">
              #{t}
            </Link>
          ))}
        </div>
      )}
    </article>
  )
}

function GoalMarkerCard({ marker }: { marker: GoalMarker }) {
  return (
    <Link to={`/goals/${marker.goal.id}`} className={`gcard kind-${marker.kind}`} title={`${MARKER_LABEL[marker.kind]}: ${marker.title}`}>
      <span className="gcard-kind">
        <span aria-hidden>{MARKER_ICON[marker.kind]}</span> {MARKER_LABEL[marker.kind]}
      </span>
      <strong className="gcard-title">{marker.title}</strong>
      {marker.kind === 'milestone' && <span className="gcard-goal">{marker.goal.title}</span>}
      {marker.kind === 'goal_achieved' && marker.reward && <span className="gcard-goal">🎁 {marker.reward}</span>}
      <span className="tcard-spacer" />
      {marker.thumb && <img className="gcard-thumb" src={marker.thumb} alt="" loading="lazy" />}
    </Link>
  )
}
