import type { MediaAsset } from '../api/types'
import { MediaThumb } from './MediaGrid'

interface Props {
  media: MediaAsset[]
  onOpen: (asset: MediaAsset) => void
  limit?: number
  /** Outline (and show first) items carrying this tag. */
  highlightTag?: string
}

/** Row of small square thumbnails for compact cards. */
export function MediaStrip({ media, onOpen, limit = 4, highlightTag }: Props) {
  if (media.length === 0) return null
  const wanted = highlightTag?.toLowerCase()
  const matches = (a: MediaAsset) => !!wanted && a.tags.some((t) => t.toLowerCase() === wanted)
  const ordered = wanted ? [...media.filter(matches), ...media.filter((a) => !matches(a))] : media
  const shown = ordered.slice(0, limit)
  const hidden = media.length - shown.length

  return (
    <div className="media-strip">
      {shown.map((asset, i) => (
        <button
          key={asset.id}
          className={`media-strip-tile ${matches(asset) ? 'match' : ''}`}
          onClick={() => onOpen(asset)}
          aria-label="Open media"
        >
          <MediaThumb asset={asset} />
          {asset.kind === 'video' && <span className="strip-play">▶</span>}
          {hidden > 0 && i === shown.length - 1 && <span className="strip-more">+{hidden}</span>}
        </button>
      ))}
    </div>
  )
}
