import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { errorMessage } from '../api/client'
import { useEvent, useEventEntries, useInvalidateJournal, useSaveEvent } from '../api/hooks'
import { EventPhotoDrop } from '../components/EventPhotoDrop'
import { MediaThumb } from '../components/MediaGrid'
import { TagInput } from '../components/TagInput'
import { browserTimeZone, dayKey } from '../lib/dates'
import { describeUpload } from '../lib/events'
import { usePhotoQueue } from '../lib/usePhotoQueue'

/** Every IANA zone the browser knows (plus the current value, in case it's unusual). */
function zoneOptions(current: string): string[] {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return zones.includes(current) ? zones : [current, ...zones]
}

export function EventEditorPage() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const { data: existing } = useEvent(id)
  const { data: entries = [] } = useEventEntries(id)
  const save = useSaveEvent()
  const invalidate = useInvalidateJournal()
  const queue = usePhotoQueue()
  const [uploading, setUploading] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startsOn, setStartsOn] = useState(() => dayKey(new Date()))
  const [endsOn, setEndsOn] = useState(() => dayKey(new Date()))
  const [ongoing, setOngoing] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [cover, setCover] = useState<string | null>(null)
  const [timeZone, setTimeZone] = useState(browserTimeZone)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!existing) return
    setTitle(existing.title)
    setDescription(existing.description)
    setStartsOn(existing.starts_on)
    setEndsOn(existing.ends_on ?? existing.starts_on)
    setOngoing(existing.ends_on === null)
    setTags(existing.tags)
    setCover(existing.cover)
    setTimeZone(existing.timezone)
  }, [existing])

  const photos = entries.flatMap((e) => e.media).filter((m) => m.kind === 'image' && m.status !== 'failed')
  const endBeforeStart = !ongoing && endsOn < startsOn

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (endBeforeStart) return
    setError(null)
    try {
      const event = await save.mutateAsync({
        id,
        data: {
          title,
          description,
          starts_on: startsOn,
          ends_on: ongoing ? null : endsOn,
          tags,
          timezone: timeZone,
          ...(isNew ? {} : { cover }),
        },
      })
      if (queue.items.length === 0) {
        navigate(`/events/${event.id}`)
        return
      }
      setUploading(true)
      const summary = await queue.uploadAll(event.id, [])
      await invalidate()
      setUploading(false)
      if (summary.failed) {
        // Stay so the failed files can be retried; the event itself exists now.
        setError(describeUpload(summary))
        if (isNew) navigate(`/events/${event.id}/edit`, { replace: true })
      } else {
        navigate(`/events/${event.id}`, { state: { uploadSummary: summary } })
      }
    } catch (err) {
      setUploading(false)
      setError(errorMessage(err))
    }
  }

  return (
    <form className="page editor" onSubmit={onSubmit}>
      <div className="page-header">
        <div>
          <span className="muted small">Event · spans one or more days</span>
          <h1>{isNew ? 'New event' : 'Edit event'}</h1>
        </div>
      </div>

      <label className="field">
        <span>Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Hawaii trip, Grandma's 90th, …"
          maxLength={200}
          required
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span>Starts</span>
          <input
            type="date"
            value={startsOn}
            onChange={(e) => {
              setStartsOn(e.target.value)
              if (endsOn < e.target.value) setEndsOn(e.target.value) // keep the range valid
            }}
            required
          />
        </label>
        <label className="field">
          <span>Ends</span>
          <input
            type="date"
            value={endsOn}
            min={startsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            disabled={ongoing}
            required={!ongoing}
          />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} />
          Still going
        </label>
      </div>
      {endBeforeStart && <p className="error small">The end date can’t be before the start date.</p>}

      <label className="field">
        <span>Time zone</span>
        <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
          {zoneOptions(timeZone).map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        <span className="muted small">
          Where the event takes place. Photos are filed by the date they were taken there; this zone is used for
          files without a “date taken”.
        </span>
      </label>

      <label className="field">
        <span>About this event</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          placeholder="An overview; each day can have its own entry."
        />
      </label>

      <div className="field">
        <span>Tags</span>
        <TagInput value={tags} onChange={setTags} />
        <span className="muted small">Entries in this event also match these tags on the timeline.</span>
      </div>

      {!isNew && (
        <div className="field">
          <span>Cover photo</span>
          {photos.length === 0 ? (
            <span className="muted small">Add photos to the event’s days to choose a cover.</span>
          ) : (
            <div className="cover-picker">
              <button
                type="button"
                className={`cover-option auto ${cover === null ? 'selected' : ''}`}
                onClick={() => setCover(null)}
              >
                Automatic
                <span className="muted small">first photo</span>
              </button>
              {photos.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className={`cover-option ${cover === asset.id ? 'selected' : ''}`}
                  onClick={() => setCover(asset.id)}
                  aria-label={`Use ${asset.original_filename} as cover`}
                >
                  <MediaThumb asset={asset} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="field">
        <span>Photos & videos</span>
        <EventPhotoDrop
          queue={queue}
          range={{ starts_on: startsOn, ends_on: ongoing ? null : endsOn, timezone: timeZone }}
          disabled={uploading}
        />
      </div>

      {error && <p className="error pre">{error}</p>}

      <div className="btn-group">
        <button
          type="submit"
          className="btn primary"
          disabled={save.isPending || uploading || endBeforeStart || queue.reading > 0}
        >
          {uploading
            ? `Uploading ${queue.items.filter((i) => i.status === 'done').length} / ${queue.items.length}…`
            : save.isPending
              ? 'Saving…'
              : isNew
                ? queue.items.length ? `Create event & upload ${queue.items.length}` : 'Create event'
                : queue.items.length ? `Save & upload ${queue.items.length}` : 'Save event'}
        </button>
        <button type="button" className="btn ghost" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
