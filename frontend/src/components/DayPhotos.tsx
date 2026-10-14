import { useState } from 'react'
import type { Entry, MediaAsset } from '../api/types'
import { entryTitle } from '../lib/events'
import { Lightbox } from './Lightbox'
import { MediaThumb } from './MediaGrid'
import { MediaTagEditor } from './MediaTagEditor'

export interface ForeignPhoto {
  asset: MediaAsset
  entry: Entry
}

interface Props {
  /** Photos on the entry being edited. */
  own: MediaAsset[]
  /** Photos filed under other entries of the same event day. */
  others?: ForeignPhoto[]
  onRemove?: (asset: MediaAsset) => void
  /** Present when the entry exists, so other entries' photos can be pulled into it. */
  onMoveHere?: (asset: MediaAsset) => void
  busy?: boolean
}

// The processor stores EXIF "date taken" (a wall-clock time with no zone) as if it were UTC,
// so formatting it in UTC shows the time as it read on the camera.
const takenFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })

/** A day's photos in the entry editor: a memory aid while writing, with tagging in place. */
export function DayPhotos({ own, others = [], onRemove, onMoveHere, busy }: Props) {
  // In capture order, so the day reads in sequence (the viewer steps through the same order).
  const sorted = [...own, ...others.map((o) => o.asset)]
    .filter((m) => m.status !== 'failed')
    .sort((a, b) => (a.taken_at ?? a.created_at).localeCompare(b.taken_at ?? b.created_at))
  const [openId, setOpenId] = useState<string | null>(null)
  const openIndex = openId ? sorted.findIndex((m) => m.id === openId) : -1
  const foreign = new Map(others.map((o) => [o.asset.id, o.entry]))

  return (
    <>
      <div className="day-photos">
        {sorted.map((asset) => {
          const from = foreign.get(asset.id)
          return (
            <figure key={asset.id} className={`day-photo ${from ? 'foreign' : ''}`}>
              <button type="button" className="day-photo-thumb" onClick={() => setOpenId(asset.id)} aria-label="View">
                <MediaThumb asset={asset} />
                {asset.kind === 'video' && <span className="badge play">▶</span>}
                {asset.taken_at && <span className="day-photo-time">{takenFormat.format(new Date(asset.taken_at))}</span>}
              </button>
              <MediaTagEditor asset={asset} className="compact" />
              <figcaption>
                {from ? (
                  <>
                    <span className="muted small" title={entryTitle(from)}>
                      In “{entryTitle(from)}”
                    </span>
                    {onMoveHere && (
                      <button type="button" className="btn small" disabled={busy} onClick={() => onMoveHere(asset)}>
                        Move here
                      </button>
                    )}
                  </>
                ) : (
                  onRemove && (
                    <button type="button" className="btn ghost small" disabled={busy} onClick={() => onRemove(asset)}>
                      Remove
                    </button>
                  )
                )}
              </figcaption>
            </figure>
          )
        })}
      </div>
      {openIndex >= 0 && (
        <Lightbox
          items={sorted}
          index={openIndex}
          onIndexChange={(i) => setOpenId(sorted[i].id)}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  )
}
