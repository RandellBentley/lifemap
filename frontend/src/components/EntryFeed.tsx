import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { format } from 'date-fns'
import type { Entry, MediaAsset } from '../api/types'
import { formatEntryDate } from '../lib/dates'
import { entryTitle } from '../lib/events'
import { EventBadge } from './EventBadge'
import { Lightbox } from './Lightbox'
import { MediaGrid } from './MediaGrid'
import { TagChips } from './TagChips'

interface Props {
  entries: Entry[]
  groupByMonth?: boolean
}

/** Vertical timeline of entry cards with one shared lightbox over all their media. */
export function EntryFeed({ entries, groupByMonth = false }: Props) {
  const allMedia = useMemo(() => entries.flatMap((e) => e.media.filter((m) => m.status !== 'failed')), [entries])
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const open = (asset: MediaAsset) => setOpenIndex(allMedia.findIndex((m) => m.id === asset.id))

  const groups = useMemo(() => {
    if (!groupByMonth) return [{ label: null as string | null, entries }]
    const byMonth = new Map<string, Entry[]>()
    for (const entry of entries) {
      const label = format(new Date(entry.occurred_at), 'MMMM yyyy')
      byMonth.set(label, [...(byMonth.get(label) ?? []), entry])
    }
    return [...byMonth].map(([label, entries]) => ({ label, entries }))
  }, [entries, groupByMonth])

  return (
    <>
      {groups.map((group) => (
        <section key={group.label ?? 'all'} className="feed-group">
          {group.label && <h2 className="month-heading">{group.label}</h2>}
          <ol className="timeline">
            {group.entries.map((entry) => (
              <li key={entry.id} className="timeline-item">
                <EntryCard entry={entry} onOpenMedia={open} />
              </li>
            ))}
          </ol>
        </section>
      ))}

      {openIndex !== null && openIndex >= 0 && (
        <Lightbox
          items={allMedia}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  )
}

function EntryCard({ entry, onOpenMedia }: { entry: Entry; onOpenMedia: (a: MediaAsset) => void }) {
  return (
    <article className="card entry-card">
      <header>
        <time dateTime={entry.occurred_at} className="muted small">
          {formatEntryDate(entry)}
        </time>
        <h3>
          <Link to={`/entries/${entry.id}`}>{entryTitle(entry)}</Link>
        </h3>
        <EventBadge entry={entry} />
      </header>
      {entry.body && <p className="excerpt">{entry.body}</p>}
      <MediaGrid media={entry.media} onOpen={onOpenMedia} limit={6} />
      <TagChips tags={entry.tags} />
    </article>
  )
}
