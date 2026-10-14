import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { format } from 'date-fns'
import { useGoalMarkers, useTags, useTimelineSummary, useTimelineWindow, type EntryFilters } from '../api/hooks'
import type { MediaAsset } from '../api/types'
import { HorizontalTimeline, type HorizontalTimelineHandle } from '../components/HorizontalTimeline'
import { Lightbox } from '../components/Lightbox'
import { TimelineScrubber } from '../components/TimelineScrubber'
import { parseDay } from '../lib/dates'

const FAR_FUTURE = new Date(8.64e15).toISOString()

export function TimelinePage() {
  const [params, setParams] = useSearchParams()
  const tag = params.get('tag') ?? undefined
  const q = params.get('q') ?? undefined
  const filters: EntryFilters = useMemo(() => ({ tag, q }), [tag, q])
  const filterKey = `${tag ?? ''}|${q ?? ''}`

  // Where the loaded window is centered (null = latest). Resets when filters change.
  const [jump, setJump] = useState<{ filterKey: string; at: string | null }>({ filterKey, at: null })
  const anchor = jump.filterKey === filterKey ? jump.at : null

  const windowQuery = useTimelineWindow(filters, anchor)
  const { data: summary } = useTimelineSummary(filters)
  const { data: tags = [] } = useTags()

  const entries = useMemo(() => windowQuery.data?.pages.flatMap((p) => p.results) ?? [], [windowQuery.data])
  const hasOlder = windowQuery.hasPreviousPage
  const hasNewer = windowQuery.hasNextPage

  // Goal markers are few, so fetch them all and show those inside the loaded stretch of time
  // (open-ended at whichever end has no more entries to load).
  const { data: allMarkers = [] } = useGoalMarkers(filters)
  const markers = useMemo(() => {
    const first = entries[0]?.occurred_on
    const last = entries.at(-1)?.occurred_on
    return allMarkers.filter(
      (m) => (!hasOlder || (first !== undefined && m.date >= first)) && (!hasNewer || (last !== undefined && m.date <= last)),
    )
  }, [allMarkers, entries, hasOlder, hasNewer])

  const timeline = useRef<HorizontalTimelineHandle>(null)
  const [center, setCenter] = useState<string | null>(null)

  const allMedia = useMemo(() => entries.flatMap((e) => e.media.filter((m) => m.status !== 'failed')), [entries])
  // Track the open photo by id: older entries can load (and shift positions) while it's open.
  const [openId, setOpenId] = useState<string | null>(null)
  const openIndex = openId ? allMedia.findIndex((m) => m.id === openId) : -1
  const openMedia = (asset: MediaAsset) => setOpenId(asset.id)

  const jumpTo = (at: string | null) => {
    setCenter(at)
    setJump({ filterKey, at })
  }

  /** Scroll within what's loaded; outside it, reload the window around the date on release. */
  const onScrub = (at: string, final: boolean) => {
    const ms = Date.parse(at)
    const loaded =
      entries.length > 0 &&
      (!hasOlder || ms >= Date.parse(entries[0].occurred_at)) &&
      (!hasNewer || ms <= Date.parse(entries.at(-1)!.occurred_at))
    if (loaded) timeline.current?.scrollToInstant(at)
    else if (final) jumpTo(at)
  }

  const goLatest = () => {
    if (anchor === null && !hasNewer) timeline.current?.scrollToInstant(FAR_FUTURE, 'smooth')
    else jumpTo(null)
  }

  const setParam = (key: string, value?: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const isEmpty = windowQuery.isSuccess && entries.length === 0 && markers.length === 0 && !hasOlder && !hasNewer

  return (
    <div className="page timeline-page">
      <div className="page-header">
        <div>
          <h1>Timeline</h1>
          <span className="muted small timeline-position">{center ? format(new Date(center), 'MMMM yyyy') : ' '}</span>
        </div>
        <div className="btn-group">
          <input
            type="date"
            className="date-jump"
            aria-label="Jump to date"
            onChange={(e) => e.target.value && jumpTo(parseDay(e.target.value).toISOString())}
          />
          <button className="btn" onClick={goLatest}>
            Latest
          </button>
          <SearchBox initial={q ?? ''} onSearch={(v) => setParam('q', v)} />
        </div>
      </div>

      {tags.length > 0 && (
        <div className="tag-filter">
          <button className={`tag ${!tag ? 'active' : ''}`} onClick={() => setParam('tag')}>
            All
          </button>
          {tags.map((t) => (
            <button
              key={t.id}
              className={`tag ${tag?.toLowerCase() === t.name.toLowerCase() ? 'active' : ''}`}
              onClick={() => setParam('tag', t.name)}
            >
              #{t.name} {t.entry_count > 0 && <span className="muted">{t.entry_count}</span>}
            </button>
          ))}
        </div>
      )}

      {isEmpty ? (
        <div className="empty">
          <p>{tag || q ? 'Nothing matches that filter.' : 'No entries yet.'}</p>
          <Link to="/entries/new" className="btn primary">
            Write your first entry
          </Link>
        </div>
      ) : (
        <>
          {windowQuery.isPending ? (
            <div className="htimeline-placeholder muted">Loading…</div>
          ) : windowQuery.isError ? (
            <div className="htimeline-placeholder error">Couldn’t load entries.</div>
          ) : (
            <HorizontalTimeline
              key={`${filterKey}|${anchor}`}
              ref={timeline}
              entries={entries}
              hasOlder={hasOlder}
              hasNewer={hasNewer}
              loadOlder={windowQuery.fetchPreviousPage}
              loadNewer={windowQuery.fetchNextPage}
              loadingOlder={windowQuery.isFetchingPreviousPage}
              loadingNewer={windowQuery.isFetchingNextPage}
              initialFocus={anchor ?? 'latest'}
              onCenterChange={setCenter}
              onOpenMedia={openMedia}
              highlightTag={tag}
              markers={markers}
            />
          )}
          {summary?.first && summary.last && (
            <TimelineScrubber summary={{ ...summary, first: summary.first, last: summary.last }} value={center} onScrub={onScrub} />
          )}
        </>
      )}

      {openIndex >= 0 && (
        <Lightbox
          items={allMedia}
          index={openIndex}
          onIndexChange={(i) => setOpenId(allMedia[i].id)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}

function SearchBox({ initial, onSearch }: { initial: string; onSearch: (v: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <form
      className="search"
      onSubmit={(e) => {
        e.preventDefault()
        onSearch(value.trim())
      }}
    >
      <input type="search" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Search entries" />
    </form>
  )
}
