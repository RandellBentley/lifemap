import type { MediaAsset } from '../api/types'

interface Props {
  media: MediaAsset[]
  onOpen: (asset: MediaAsset) => void
  /** Collapse to this many tiles with a "+N" overlay on the last one. */
  limit?: number
  /** Small fixed-size square tiles instead of filling the width (for long, many-day pages). */
  compact?: boolean
}

export function MediaGrid({ media, onOpen, limit, compact }: Props) {
  if (media.length === 0) return null
  const shown = limit ? media.slice(0, limit) : media
  const hidden = media.length - shown.length

  return (
    <div className={compact ? 'media-grid compact' : `media-grid count-${Math.min(shown.length, 4)}`}>
      {shown.map((asset, i) => (
        <button key={asset.id} className="media-tile" onClick={() => onOpen(asset)} aria-label="Open media">
          <MediaThumb asset={asset} />
          {asset.kind === 'video' && <span className="badge play">▶</span>}
          {asset.status !== 'ready' && <span className="badge status">{statusLabel(asset)}</span>}
          {hidden > 0 && i === shown.length - 1 && <span className="more">+{hidden}</span>}
        </button>
      ))}
    </div>
  )
}

export function MediaThumb({ asset }: { asset: MediaAsset }) {
  const src = asset.urls.thumb ?? asset.urls.poster
  if (src) return <img src={src} alt={asset.original_filename} loading="lazy" />
  if (asset.kind === 'video' && asset.urls.original) {
    // No poster yet: let the browser grab the first frame.
    return <video src={`${asset.urls.original}#t=0.1`} preload="metadata" muted playsInline />
  }
  return <div className="thumb-placeholder" />
}

function statusLabel(asset: MediaAsset) {
  if (asset.status === 'failed') return 'Failed'
  return 'Processing…'
}
