import type { MediaAsset } from '../api/types'
import { MediaThumb } from './MediaGrid'

/** One optional video: the saved one, a newly chosen file, or a pending removal. */
export interface VideoDraft {
  video: MediaAsset | null // already attached
  newVideo: File | null // chosen, uploads after save
  removeVideo: boolean
}

/** Attach, replace or remove one video; nothing uploads until the form is saved. */
export function VideoField({ value, onChange, disabled }: { value: VideoDraft; onChange: (patch: Partial<VideoDraft>) => void; disabled?: boolean }) {
  const shownExisting = value.video && !value.removeVideo && !value.newVideo
  return (
    <span className="set-video">
      {shownExisting && (
        <span className="set-video-thumb">
          <MediaThumb asset={value.video!} />
        </span>
      )}
      {value.newVideo && <span className="muted small set-video-name">{value.newVideo.name}</span>}
      <label className={`btn ghost small ${disabled ? 'disabled' : ''}`}>
        {shownExisting || value.newVideo ? 'Replace' : '+ Video'}
        <input
          type="file"
          accept="video/*"
          hidden
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onChange({ newVideo: file, removeVideo: false })
            e.target.value = ''
          }}
        />
      </label>
      {(shownExisting || value.newVideo) && (
        <button type="button" className="btn ghost small" disabled={disabled} onClick={() => onChange({ newVideo: null, removeVideo: !!value.video })}>
          Remove
        </button>
      )}
    </span>
  )
}
