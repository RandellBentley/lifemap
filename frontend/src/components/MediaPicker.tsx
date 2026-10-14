import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { TagInput } from './TagInput'

export interface QueuedFile {
  id: string
  file: File
  tags: string[]
  progress: number
  error?: string
}

interface Props {
  queue: QueuedFile[]
  onAdd: (files: File[]) => void
  onRemove: (id: string) => void
  onTagsChange: (id: string, tags: string[]) => void
  disabled?: boolean
}

const ACCEPT = 'image/*,video/*'

/** Files are only queued here; the editor uploads them after the entry is saved. */
export function MediaPicker({ queue, onAdd, onRemove, onTagsChange, disabled }: Props) {
  const [dragging, setDragging] = useState(false)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    onAdd([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/')))
  }

  return (
    <div>
      <label
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          disabled={disabled}
          onChange={(e) => {
            onAdd([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        <strong>Add photos or videos</strong>
        <span className="muted small">Drag files here or click to choose</span>
      </label>

      {queue.length > 0 && (
        <ul className="upload-queue">
          {queue.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              onRemove={() => onRemove(item.id)}
              onTagsChange={(tags) => onTagsChange(item.id, tags)}
              disabled={disabled}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface RowProps {
  item: QueuedFile
  onRemove: () => void
  onTagsChange: (tags: string[]) => void
  disabled?: boolean
}

function QueueRow({ item, onRemove, onTagsChange, disabled }: RowProps) {
  const preview = useMemo(() => URL.createObjectURL(item.file), [item.file])
  useEffect(() => () => URL.revokeObjectURL(preview), [preview])

  return (
    <li className="upload-row">
      {item.file.type.startsWith('image/') ? <img src={preview} alt="" /> : <video src={preview} muted />}
      <div className="upload-meta">
        <span className="filename">{item.file.name}</span>
        <span className="muted small">{(item.file.size / 1_048_576).toFixed(1)} MB</span>
        {!disabled && <TagInput value={item.tags} onChange={onTagsChange} placeholder="Tag this file…" className="compact" />}
        {disabled && item.tags.length > 0 && <span className="muted small">#{item.tags.join(' #')}</span>}
        {item.error ? (
          <span className="error small">{item.error}</span>
        ) : (
          item.progress > 0 && (
            <progress value={item.progress} max={1}>
              {Math.round(item.progress * 100)}%
            </progress>
          )
        )}
      </div>
      <button type="button" className="btn ghost" onClick={onRemove} disabled={disabled} aria-label="Remove file">
        ×
      </button>
    </li>
  )
}
