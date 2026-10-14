import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { errorMessage } from '../api/client'
import {
  useDeleteMedia,
  useEntry,
  useEventEntries,
  useEvents,
  useInvalidateJournal,
  useMoveMedia,
  useSaveEntry,
} from '../api/hooks'
import { MediaPicker, type QueuedFile } from '../components/MediaPicker'
import { DayPhotos } from '../components/DayPhotos'
import { TagInput } from '../components/TagInput'
import { browserTimeZone, fromLocalInput, parseDay, toLocalInput } from '../lib/dates'
import { format } from 'date-fns'
import { entryTitle, eventDayNumber, formatEventRange } from '../lib/events'
import { uploadMedia } from '../lib/upload'

export function EntryEditorPage() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { data: existing } = useEntry(id)
  const { data: events = [] } = useEvents()
  const saveEntry = useSaveEntry()
  const deleteMedia = useDeleteMedia()
  const moveMedia = useMoveMedia()
  const invalidate = useInvalidateJournal()

  // "+ Add day entry" on an event page links here with ?event=<id>&date=<yyyy-MM-dd>.
  const fromEvent = params.get('event')
  const presetDate = params.get('date')

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [occurredAt, setOccurredAt] = useState(() =>
    presetDate ? `${presetDate}T12:00` : toLocalInput(new Date().toISOString()),
  )
  const [tags, setTags] = useState<string[]>([])
  const [eventId, setEventId] = useState<string>(fromEvent ?? '')
  const [queue, setQueue] = useState<QueuedFile[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!existing) return
    setTitle(existing.title)
    setBody(existing.body)
    setOccurredAt(toLocalInput(existing.occurred_at))
    setTags(existing.tags)
    setEventId(existing.event ?? '')
  }, [existing])

  const selectedEvent = events.find((e) => e.id === eventId)
  const day = occurredAt.slice(0, 10)
  const outsideEvent = selectedEvent && eventDayNumber(selectedEvent, day) === null
  const dayNumber = selectedEvent ? eventDayNumber(selectedEvent, day) : null

  // Other entries of the same event day: their photos are shown here as a reminder, and
  // (when editing) can be pulled into this entry.
  const { data: eventEntries = [] } = useEventEntries(eventId || undefined)
  const sameDay = eventEntries.filter((e) => e.occurred_on === day && e.id !== id)
  const others = sameDay.flatMap((entry) => entry.media.map((asset) => ({ asset, entry })))
  const own = existing?.media ?? []

  const updateQueued = (qid: string, patch: Partial<QueuedFile>) =>
    setQueue((q) => q.map((item) => (item.id === qid ? { ...item, ...patch } : item)))

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const entry = await saveEntry.mutateAsync({
        id,
        data: {
          title,
          body,
          tags,
          occurred_at: fromLocalInput(occurredAt),
          timezone: browserTimeZone(),
          event: eventId || null,
        },
      })

      // Upload sequentially so progress is easy to follow and we don't saturate mobile uplinks.
      let failed = false
      for (const item of queue) {
        try {
          await uploadMedia(entry.id, item.file, (progress) => updateQueued(item.id, { progress }), item.tags)
          setQueue((q) => q.filter((x) => x.id !== item.id))
        } catch (err) {
          failed = true
          updateQueued(item.id, { error: errorMessage(err) })
        }
      }
      await invalidate()

      if (failed) {
        setError('Some files failed to upload. The entry was saved; you can retry the failed files.')
        if (isNew) navigate(`/entries/${entry.id}/edit`, { replace: true })
      } else {
        // Event days go back to the event (scrolled to this day) so you can move on to the next one.
        navigate(eventId ? `/events/${eventId}#day-${entry.occurred_on}` : `/entries/${entry.id}`)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="page editor" onSubmit={onSubmit}>
      <div className="page-header">
        <div>
          {selectedEvent && dayNumber && (
            <Link to={`/events/${selectedEvent.id}`} className="event-kicker">
              ◆ {selectedEvent.title} · Day {dayNumber} · {format(parseDay(day), 'EEE, MMM d')}
            </Link>
          )}
          <h1>{isNew ? 'New day entry' : existing && !existing.title ? 'Write about this day' : 'Edit entry'}</h1>
        </div>
      </div>

      {isNew && sameDay.length > 0 && (
        <div className="notice">
          Day {dayNumber ?? ''} already has {others.length} {others.length === 1 ? 'photo' : 'photos & videos'} filed
          under “{entryTitle(sameDay[0])}”.{' '}
          <Link to={`/entries/${sameDay[0].id}/edit`}>Write in that entry instead →</Link>
        </div>
      )}

      <label className="field">
        <span>Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={dayNumber ? 'Give this day a title, e.g. “Day trip to Hvar”' : 'What happened?'}
          maxLength={200}
        />
      </label>

      <label className="field">
        <span>When</span>
        <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} required />
      </label>

      <label className="field">
        <span>Part of an event</span>
        <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">None — a standalone day</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.title} ({formatEventRange(ev)})
            </option>
          ))}
        </select>
        {selectedEvent && !outsideEvent && (
          <span className="muted small">Day {eventDayNumber(selectedEvent, day)} of {selectedEvent.title}</span>
        )}
        {outsideEvent && (
          <span className="warning small">
            This date is outside {selectedEvent.title} ({formatEventRange(selectedEvent)}). It will still be grouped
            with the event, under “Outside the event’s dates”.
          </span>
        )}
      </label>

      {(own.length > 0 || others.length > 0) && (
        <div className="field">
          <span>{selectedEvent && dayNumber ? `Photos from Day ${dayNumber}` : 'Attached photos & videos'}</span>
          <span className="muted small">
            {selectedEvent && dayNumber
              ? 'A reminder of the day while you write. Tag them here, or click one to see it full size.'
              : 'Tag them here, or click one to see it full size.'}
          </span>
          <DayPhotos
            own={own}
            others={others}
            onRemove={(asset) => deleteMedia.mutate(asset.id)}
            onMoveHere={id ? (asset) => moveMedia.mutate({ id: asset.id, entry: id }) : undefined}
            busy={deleteMedia.isPending || moveMedia.isPending}
          />
        </div>
      )}

      <label className="field">
        <span>Journal</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} placeholder="Write it down…" />
      </label>

      <div className="field">
        <span>Tags</span>
        <TagInput value={tags} onChange={setTags} />
      </div>

      <div className="field">
        <span>{own.length ? 'Add more photos & videos' : 'Photos & videos'}</span>
        <MediaPicker
          queue={queue}
          disabled={saving}
          onAdd={(files) =>
            setQueue((q) => [...q, ...files.map((file) => ({ id: crypto.randomUUID(), file, tags: [], progress: 0 }))])
          }
          onRemove={(qid) => setQueue((q) => q.filter((x) => x.id !== qid))}
          onTagsChange={(qid, tags) => updateQueued(qid, { tags })}
        />
      </div>

      {error && <p className="error pre">{error}</p>}

      <div className="btn-group">
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save entry'}
        </button>
        <button type="button" className="btn ghost" onClick={() => navigate(-1)} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  )
}
