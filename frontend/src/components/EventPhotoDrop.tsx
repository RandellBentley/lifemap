import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { format } from 'date-fns'
import { captureDay } from '../lib/captureDate'
import { parseDay } from '../lib/dates'
import { eventDayNumber, eventEnd } from '../lib/events'
import type { PhotoQueue, QueuedPhoto } from '../lib/usePhotoQueue'

interface Range {
  starts_on: string
  ends_on: string | null
  timezone: string
}

interface Props {
  queue: PhotoQueue
  range: Range
  disabled?: boolean
}

const THUMBS_PER_DAY = 10

/** Same rule as the server: the capture day in the event's zone, clamped into its dates. */
function plannedDay(item: QueuedPhoto, range: Range) {
  const day = captureDay(item.capturedAt, range.timezone)
  const end = eventEnd({ id: '', title: '', ...range })
  const clamped = day < range.starts_on ? range.starts_on : day > end && range.ends_on ? end : day
  return { day: clamped, outside: clamped !== day }
}

/** Drop a trip's photos here; they're previewed under the day each will be filed on. */
export function EventPhotoDrop({ queue, range, disabled }: Props) {
  const [dragging, setDragging] = useState(false)

  const groups = useMemo(() => {
    const byDay = new Map<string, { item: QueuedPhoto; outside: boolean }[]>()
    for (const item of queue.items) {
      const { day, outside } = item.placement
        ? { day: item.placement.date, outside: item.placement.outside }
        : plannedDay(item, range)
      byDay.set(day, [...(byDay.get(day) ?? []), { item, outside }])
    }
    return [...byDay].sort(([a], [b]) => a.localeCompare(b))
  }, [queue.items, range])

  const undated = queue.items.filter((i) => i.source === 'file').length

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (!disabled) queue.add([...e.dataTransfer.files])
  }

  return (
    <div className="event-drop">
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
          accept="image/*,video/*"
          multiple
          hidden
          disabled={disabled}
          onChange={(e) => {
            queue.add([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        <strong>Add the event’s photos & videos</strong>
        <span className="muted small">Drop them all at once — each is filed under the day it was taken</span>
      </label>

      {queue.reading > 0 && <p className="muted small">Reading capture dates for {queue.reading} files…</p>}

      {groups.map(([day, members]) => {
        const outside = members.filter((m) => m.outside).length
        const n = eventDayNumber({ id: '', title: '', ...range }, day)
        return (
          <section key={day} className="drop-day">
            <h3>
              <span className="event-day-number">Day {n}</span> {format(parseDay(day), 'EEE, MMM d')}
              <span className="muted small">
                {' '}
                · {members.length} {members.length === 1 ? 'file' : 'files'}
              </span>
              {outside > 0 && (
                <span className="warning small"> · {outside} taken outside the event’s dates, filed here</span>
              )}
            </h3>
            <div className="drop-thumbs">
              {members.slice(0, THUMBS_PER_DAY).map(({ item }) => (
                <QueuedThumb key={item.id} item={item} onRemove={disabled ? undefined : () => queue.remove(item.id)} />
              ))}
              {members.length > THUMBS_PER_DAY && (
                <span className="drop-more">+{members.length - THUMBS_PER_DAY}</span>
              )}
            </div>
          </section>
        )
      })}

      {undated > 0 && (
        <p className="muted small">
          {undated} {undated === 1 ? 'file has' : 'files have'} no “date taken” in its metadata, so the file’s own
          date is used. You can move photos to another day later from their entry.
        </p>
      )}
    </div>
  )
}

function QueuedThumb({ item, onRemove }: { item: QueuedPhoto; onRemove?: () => void }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    const url = URL.createObjectURL(item.file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [item.file])

  return (
    <div className={`drop-thumb ${item.status}`} title={item.error ?? item.file.name}>
      {item.file.type.startsWith('image/') ? <img src={src} alt="" /> : <video src={src} muted />}
      {item.status === 'uploading' && (
        <span className="drop-progress" style={{ width: `${Math.round(item.progress * 100)}%` }} />
      )}
      {item.status === 'done' && <span className="drop-status">✓</span>}
      {item.status === 'error' && <span className="drop-status">!</span>}
      {onRemove && item.status === 'queued' && (
        <button type="button" className="drop-remove" onClick={onRemove} aria-label={`Remove ${item.file.name}`}>
          ×
        </button>
      )}
    </div>
  )
}
