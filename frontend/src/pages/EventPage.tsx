import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { format } from 'date-fns'
import { useDeleteEvent, useEvent, useEventEntries, useInvalidateJournal } from '../api/hooks'
import type { Entry, JournalEvent } from '../api/types'
import { EventPhotoDrop } from '../components/EventPhotoDrop'
import { Lightbox } from '../components/Lightbox'
import { MediaGrid } from '../components/MediaGrid'
import { TagChips } from '../components/TagChips'
import { TagInput } from '../components/TagInput'
import { parseDay } from '../lib/dates'
import { describeUpload, eventDayCount, eventDays, eventDayNumber, formatEventRange } from '../lib/events'
import { usePhotoQueue, type UploadSummary } from '../lib/usePhotoQueue'

/** Long events only list the days that have entries, instead of hundreds of empty rows. */
const MAX_DAYS_LISTED = 62

export function EventPage() {
  const { id } = useParams()
  const { data: event, isPending, isError } = useEvent(id)
  const { data: entries = [] } = useEventEntries(id)

  if (isPending) return <p className="muted">Loading…</p>
  if (isError || !event) return <p className="error">Event not found.</p>
  return <EventView event={event} entries={entries} />
}

function EventView({ event, entries }: { event: JournalEvent; entries: Entry[] }) {
  const navigate = useNavigate()
  const location = useLocation()
  const deleteEvent = useDeleteEvent()
  const invalidate = useInvalidateJournal()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Bulk upload. The event form also hands over a summary after uploading on create.
  const queue = usePhotoQueue()
  const [showUpload, setShowUpload] = useState(false)
  const [batchTags, setBatchTags] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [summary, setSummary] = useState<string | null>(
    () => (location.state as { uploadSummary?: UploadSummary } | null)?.uploadSummary
      ? describeUpload((location.state as { uploadSummary: UploadSummary }).uploadSummary)
      : null,
  )
  const queued = queue.items.filter((i) => i.status === 'queued' || i.status === 'error').length

  // Coming back from writing about a day (#day-yyyy-MM-dd): scroll to it once it's rendered.
  const hasEntries = entries.length > 0
  useEffect(() => {
    if (location.hash && hasEntries) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [location.hash, hasEntries])

  // Show the handed-over summary once; don't bring it back on reload or Back.
  useEffect(() => {
    if (location.state) navigate(location.pathname + location.hash, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])

  const uploadQueued = async () => {
    setUploading(true)
    setSummary(null)
    const result = await queue.uploadAll(event.id, batchTags)
    await invalidate()
    setUploading(false)
    setSummary(describeUpload(result))
    if (!result.failed) {
      queue.clearFinished()
      setShowUpload(false)
    }
  }
  const [openId, setOpenId] = useState<string | null>(null)

  const media = useMemo(() => entries.flatMap((e) => e.media.filter((m) => m.status !== 'failed')), [entries])
  const openIndex = openId ? media.findIndex((m) => m.id === openId) : -1

  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const entry of entries) map.set(entry.occurred_on, [...(map.get(entry.occurred_on) ?? []), entry])
    return map
  }, [entries])

  const allDays = eventDays(event)
  const days = allDays.length <= MAX_DAYS_LISTED ? allDays : allDays.filter((d) => byDay.has(d))
  const outside = entries.filter((e) => eventDayNumber(event, e.occurred_on) === null)
  const firstEmptyDay = allDays.find((d) => !byDay.has(d)) ?? event.starts_on
  const dayCount = eventDayCount(event)

  const remove = async (withEntries: boolean) => {
    try {
      await deleteEvent.mutateAsync({ id: event.id, withEntries })
      navigate('/timeline')
    } catch {
      // shown via deleteEvent.isError
    }
  }

  return (
    <article className="page event-page">
      {event.cover_urls?.display && (
        <div className="event-hero">
          <img src={event.cover_urls.display} alt="" />
        </div>
      )}

      <div className="page-header">
        <div>
          <span className="event-kicker">◆ Event</span>
          <h1>{event.title}</h1>
          <p className="muted">
            {formatEventRange(event)} · {dayCount} {dayCount === 1 ? 'day' : 'days'} · {event.entry_count}{' '}
            {event.entry_count === 1 ? 'entry' : 'entries'} · {event.media_count} photos & videos
          </p>
        </div>
        <div className="btn-group">
          <button className="btn primary" onClick={() => setShowUpload((v) => !v)} aria-expanded={showUpload}>
            + Add photos
          </button>
          <Link className="btn" to={`/entries/new?event=${event.id}&date=${firstEmptyDay}`}>
            + Day entry
          </Link>
          <Link className="btn" to={`/events/${event.id}/edit`}>
            Edit
          </Link>
          {!confirmingDelete && (
            <button className="btn ghost" onClick={() => setConfirmingDelete(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      {deleteEvent.isError && <p className="error">Couldn’t delete the event. Please try again.</p>}
      {confirmingDelete && (
        <div className="confirm-panel" role="alertdialog" aria-label="Delete event">
          <p>
            <strong>Delete “{event.title}”?</strong>{' '}
            {event.entry_count > 0 && `Its ${event.entry_count} ${event.entry_count === 1 ? 'entry' : 'entries'} can be kept as standalone days.`}
          </p>
          <div className="btn-group">
            {event.entry_count > 0 && (
              <button className="btn" disabled={deleteEvent.isPending} onClick={() => remove(false)}>
                Delete event, keep entries
              </button>
            )}
            <button className="btn danger" disabled={deleteEvent.isPending} onClick={() => remove(true)}>
              {event.entry_count > 0 ? 'Delete event and its entries' : 'Delete event'}
            </button>
            <button className="btn ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {summary && (
        <p className="notice" role="status">
          {summary}
        </p>
      )}

      {showUpload && (
        <div className="card upload-panel">
          <EventPhotoDrop queue={queue} range={event} disabled={uploading} />
          {queue.items.length > 0 && (
            <>
              <div className="field">
                <span>Tag all of these (optional)</span>
                <TagInput value={batchTags} onChange={setBatchTags} placeholder="e.g. beach, family" />
              </div>
              <div className="btn-group">
                <button className="btn primary" disabled={uploading || queued === 0 || queue.reading > 0} onClick={uploadQueued}>
                  {uploading ? 'Uploading…' : `Upload ${queued} ${queued === 1 ? 'file' : 'files'}`}
                </button>
                {!uploading && (
                  <button className="btn ghost" onClick={() => setShowUpload(false)}>
                    Close
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <TagChips tags={event.tags} />
      {event.description && <div className="body">{event.description}</div>}

      <ol className="event-days">
        {days.map((day) => {
          const dayEntries = byDay.get(day) ?? []
          return (
            <li key={day} id={`day-${day}`} className={`event-day ${dayEntries.length ? '' : 'no-entry'}`}>
              <h2 className="event-day-heading">
                <span className="event-day-number">Day {eventDayNumber(event, day)}</span>
                <Link to={`/day/${day}`}>{format(parseDay(day), 'EEE, MMM d')}</Link>
              </h2>
              {dayEntries.length === 0 ? (
                <Link className="muted small add-day" to={`/entries/new?event=${event.id}&date=${day}`}>
                  + Add an entry for this day
                </Link>
              ) : (
                dayEntries.map((entry) => <EventDayEntry key={entry.id} entry={entry} onOpen={setOpenId} />)
              )}
            </li>
          )
        })}
      </ol>

      {allDays.length > MAX_DAYS_LISTED && (
        <p className="muted small">Showing the {days.length} days with entries out of {allDays.length}.</p>
      )}

      {outside.length > 0 && (
        <section>
          <h2 className="month-heading">Outside the event’s dates</h2>
          {outside.map((entry) => (
            <EventDayEntry key={entry.id} entry={entry} onOpen={setOpenId} showDate />
          ))}
        </section>
      )}

      {openIndex >= 0 && (
        <Lightbox
          items={media}
          index={openIndex}
          onIndexChange={(i) => setOpenId(media[i].id)}
          onClose={() => setOpenId(null)}
        />
      )}
    </article>
  )
}

function EventDayEntry({ entry, onOpen, showDate }: { entry: Entry; onOpen: (id: string) => void; showDate?: boolean }) {
  const media = entry.media.filter((m) => m.status !== 'failed')
  return (
    <div className="card event-entry">
      <div className="event-entry-header">
        <Link to={`/entries/${entry.id}`} className="event-entry-title">
          {entry.title || 'Photos'}
        </Link>
        <span className="muted small">
          {format(new Date(entry.occurred_at), showDate ? 'MMM d, yyyy · p' : 'p')}
          {(entry.title || entry.body) && (
            <>
              {' · '}
              <Link to={`/entries/${entry.id}/edit`}>Edit</Link>
            </>
          )}
        </span>
      </div>
      {entry.body && <p className="event-entry-body">{entry.body}</p>}
      {!entry.title && !entry.body && (
        <Link to={`/entries/${entry.id}/edit`} className="write-prompt">
          What happened this day? <strong>✎ Write about it</strong>
        </Link>
      )}
      <MediaGrid media={media} onOpen={(a) => onOpen(a.id)} limit={12} compact />
      <TagChips tags={entry.tags} />
    </div>
  )
}
