import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useDeleteEntry, useEntry } from '../api/hooks'
import { EventBadge } from '../components/EventBadge'
import { Lightbox } from '../components/Lightbox'
import { MediaGrid } from '../components/MediaGrid'
import { TagChips } from '../components/TagChips'
import { formatEntryDate } from '../lib/dates'
import { entryTitle } from '../lib/events'

export function EntryPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: entry, isPending, isError } = useEntry(id)
  const deleteEntry = useDeleteEntry()
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)

  if (isPending) return <p className="muted">Loading…</p>
  if (isError || !entry) return <p className="error">Entry not found.</p>

  const media = entry.media.filter((m) => m.status !== 'failed')

  return (
    <article className="page entry-detail">
      <div className="page-header">
        <div>
          <Link to={`/day/${entry.occurred_on}`} className="muted small">
            {formatEntryDate(entry)}
          </Link>
          <h1>{entryTitle(entry)}</h1>
          <EventBadge entry={entry} />
        </div>
        <div className="btn-group">
          <Link to={`/entries/${entry.id}/edit`} className="btn">
            Edit
          </Link>
          {confirming ? (
            <>
              <button
                className="btn danger"
                disabled={deleteEntry.isPending}
                onClick={async () => {
                  try {
                    await deleteEntry.mutateAsync(entry.id)
                    navigate('/timeline')
                  } catch {
                    // shown below via deleteEntry.isError
                  }
                }}
              >
                Confirm delete
              </button>
              <button className="btn ghost" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn ghost" onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      {deleteEntry.isError && <p className="error">Couldn’t delete this entry. Please try again.</p>}
      <TagChips tags={entry.tags} />
      {entry.body && <div className="body">{entry.body}</div>}
      <MediaGrid media={media} onOpen={(a) => setOpenIndex(media.findIndex((m) => m.id === a.id))} />

      {openIndex !== null && (
        <Lightbox items={media} index={openIndex} onIndexChange={setOpenIndex} onClose={() => setOpenIndex(null)} />
      )}
    </article>
  )
}
