import { useEffect } from 'react'
import { Link } from 'react-router'
import type { MediaAsset } from '../api/types'
import { ownerLink } from '../lib/goals'
import { MediaTagEditor } from './MediaTagEditor'

interface Props {
  items: MediaAsset[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}

/** Full-screen viewer; arrow keys step through every item in `items`, across entries. */
export function Lightbox({ items, index, onIndexChange, onClose }: Props) {
  const asset = items[index]
  const hasPrev = index > 0
  const hasNext = index < items.length - 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      // Arrow keys belong to the tag field while you're typing in it.
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'ArrowLeft' && hasPrev) onIndexChange(index - 1)
      if (e.key === 'ArrowRight' && hasNext) onIndexChange(index + 1)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [index, hasPrev, hasNext, onClose, onIndexChange])

  if (!asset) return null

  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
        {asset.kind === 'image' ? (
          <img src={asset.urls.display ?? asset.urls.original ?? ''} alt={asset.original_filename} />
        ) : (
          <video
            key={asset.id}
            src={asset.urls.original ?? undefined}
            poster={asset.urls.poster ?? undefined}
            controls
            autoPlay
            playsInline
          />
        )}
      </div>

      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span>
          {index + 1} / {items.length}
        </span>
        <MediaTagEditor asset={asset} className="dark" />
        <Link to={ownerLink(asset).to} className="btn ghost light" onClick={onClose}>
          {ownerLink(asset).label}
        </Link>
        <button className="btn ghost light" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {hasPrev && (
        <button
          className="lightbox-nav prev"
          aria-label="Previous"
          onClick={(e) => {
            e.stopPropagation()
            onIndexChange(index - 1)
          }}
        >
          ‹
        </button>
      )}
      {hasNext && (
        <button
          className="lightbox-nav next"
          aria-label="Next"
          onClick={(e) => {
            e.stopPropagation()
            onIndexChange(index + 1)
          }}
        >
          ›
        </button>
      )}
    </div>
  )
}
