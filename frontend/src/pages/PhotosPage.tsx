import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { format } from 'date-fns'
import { useMediaList, useTags, type MediaFilters } from '../api/hooks'
import type { MediaAsset } from '../api/types'
import { Lightbox } from '../components/Lightbox'
import { MediaThumb } from '../components/MediaGrid'
import { parseDay } from '../lib/dates'

/** Every photo and video across entries, grouped by month, filterable by tag and kind. */
export function PhotosPage() {
  const [params, setParams] = useSearchParams()
  const tag = params.get('tag') ?? undefined
  const kind = (params.get('kind') as MediaFilters['kind']) ?? undefined
  const query = useMediaList({ tag, kind })
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data])
  const { data: tags = [] } = useTags()
  const mediaTags = tags.filter((t) => t.media_count > 0)

  const [openId, setOpenId] = useState<string | null>(null)
  const openIndex = openId ? items.findIndex((m) => m.id === openId) : -1

  const groups = useMemo(() => {
    const byMonth = new Map<string, MediaAsset[]>()
    for (const asset of items) {
      const o = asset.owner
      const when = asset.entry_occurred_at
        ? new Date(asset.entry_occurred_at)
        : o.kind !== 'entry' && o.date
          ? parseDay(o.date)
          : new Date(asset.created_at)
      const label = format(when, 'MMMM yyyy')
      byMonth.set(label, [...(byMonth.get(label) ?? []), asset])
    }
    return [...byMonth]
  }, [items])

  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && !isFetchingNextPage && fetchNextPage(), {
      rootMargin: '800px',
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const setParam = (key: string, value?: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>{tag ? `#${tag}` : 'Photos & videos'}</h1>
        <div className="btn-group" role="group" aria-label="Kind">
          {([undefined, 'image', 'video'] as const).map((k) => (
            <button key={k ?? 'all'} className={`btn ${kind === k ? 'primary' : ''}`} onClick={() => setParam('kind', k)}>
              {k === 'image' ? 'Photos' : k === 'video' ? 'Videos' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {mediaTags.length > 0 && (
        <div className="tag-filter">
          <button className={`tag ${!tag ? 'active' : ''}`} onClick={() => setParam('tag')}>
            All
          </button>
          {mediaTags.map((t) => (
            <button
              key={t.id}
              className={`tag ${tag?.toLowerCase() === t.name.toLowerCase() ? 'active' : ''}`}
              onClick={() => setParam('tag', t.name)}
            >
              #{t.name} <span className="muted">{t.media_count}</span>
            </button>
          ))}
        </div>
      )}

      {query.isPending ? (
        <p className="muted">Loading…</p>
      ) : query.isError ? (
        <p className="error">Couldn’t load media.</p>
      ) : items.length === 0 ? (
        <p className="muted empty">
          {tag ? `No photos or videos tagged #${tag} yet. Open a photo and add tags below it.` : 'No photos or videos yet.'}
        </p>
      ) : (
        groups.map(([label, assets]) => (
          <section key={label}>
            <h2 className="month-heading">{label}</h2>
            <div className="photo-grid">
              {assets.map((asset) => (
                <button key={asset.id} className="photo-tile" onClick={() => setOpenId(asset.id)} aria-label="Open media">
                  <MediaThumb asset={asset} />
                  {asset.kind === 'video' && <span className="badge play">▶</span>}
                  {asset.owner.kind !== 'entry' && (
                    <span className="photo-owner" title={asset.owner.kind === 'milestone' ? `Milestone: ${asset.owner.title} — ${asset.owner.goal_title}` : `Goal: ${asset.owner.title}`}>
                      {asset.owner.kind === 'milestone' ? '🏁' : '🎯'} {asset.owner.title}
                    </span>
                  )}
                  {asset.tags.length > 0 && <span className="photo-tile-tags">#{asset.tags.join(' #')}</span>}
                </button>
              ))}
            </div>
          </section>
        ))
      )}

      <div ref={sentinel} />
      {isFetchingNextPage && <p className="muted center">Loading more…</p>}

      {openIndex >= 0 && (
        <Lightbox
          items={items}
          index={openIndex}
          onIndexChange={(i) => setOpenId(items[i].id)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
