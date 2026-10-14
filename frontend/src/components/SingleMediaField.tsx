import { useEffect, useState } from 'react'
import type { MediaAsset } from '../api/types'
import { removeSingleMedia } from '../api/hooks'
import { uploadSingle } from '../lib/upload'
import { MediaThumb } from './MediaGrid'
import { MediaTagEditor } from './MediaTagEditor'
import { TagInput } from './TagInput'

/** What the user did with the photo field, applied after the goal/milestone itself is saved. */
export interface MediaChoice {
  file: File | null
  remove: boolean
  /** Tags for a newly chosen file (an existing photo's tags save immediately instead). */
  tags: string[]
}

export const NO_MEDIA_CHANGE: MediaChoice = { file: null, remove: false, tags: [] }

/** Upload the new file or delete the old one. `basePath` is e.g. `/goals/<id>/photo/`. */
export async function applyMediaChoice(choice: MediaChoice, basePath: string) {
  if (choice.file) await uploadSingle(basePath, choice.file, undefined, choice.tags)
  else if (choice.remove) await removeSingleMedia(basePath)
}

interface Props {
  current: MediaAsset | null | undefined
  choice: MediaChoice
  onChange: (choice: MediaChoice) => void
  accept?: string
  label?: string
  disabled?: boolean
}

/** One optional photo (or video): pick, preview, replace, remove. Nothing uploads until save. */
export function SingleMediaField({ current, choice, onChange, accept = 'image/*', label = 'photo', disabled }: Props) {
  const [preview, setPreview] = useState<string>()
  useEffect(() => {
    if (!choice.file) return setPreview(undefined)
    const url = URL.createObjectURL(choice.file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [choice.file])

  const shownCurrent = current && !choice.remove && !choice.file
  const hasSomething = !!choice.file || shownCurrent

  return (
    <div className="single-media">
      {choice.file ? (
        <div className="single-media-preview">
          {choice.file.type.startsWith('video/') ? <video src={preview} muted /> : <img src={preview} alt="" />}
        </div>
      ) : shownCurrent ? (
        <div className="single-media-preview">
          <MediaThumb asset={current} />
        </div>
      ) : null}

      <div className="single-media-actions">
        <label className={`btn ${disabled ? 'disabled' : ''}`}>
          {hasSomething ? `Replace ${label}` : `Add a ${label}`}
          <input
            type="file"
            accept={accept}
            hidden
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onChange({ file, remove: false, tags: choice.tags })
              e.target.value = ''
            }}
          />
        </label>
        {hasSomething && (
          <button
            type="button"
            className="btn ghost"
            disabled={disabled}
            onClick={() => onChange({ file: null, remove: !!current, tags: [] })}
          >
            Remove
          </button>
        )}
        {choice.file && <span className="muted small">{choice.file.name}</span>}
        {choice.remove && !choice.file && <span className="muted small">Will be removed when you save</span>}
      </div>

      {choice.file ? (
        <div className="single-media-tags">
          <TagInput
            value={choice.tags}
            onChange={(tags) => onChange({ ...choice, tags })}
            placeholder={`Tag this ${label}…`}
            className="compact"
          />
        </div>
      ) : (
        shownCurrent && (
          <div className="single-media-tags">
            <MediaTagEditor asset={current} className="compact" />
          </div>
        )
      )}
    </div>
  )
}
