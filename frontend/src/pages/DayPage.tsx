import { Link, useParams } from 'react-router'
import { addDays, format } from 'date-fns'
import { useEntries, useGoalMarkers } from '../api/hooks'
import { EntryFeed } from '../components/EntryFeed'
import { dayKey, monthKey, parseDay } from '../lib/dates'
import { MARKER_ICON, MARKER_LABEL, markerKey } from '../lib/goals'

export function DayPage() {
  const { date = '' } = useParams()
  const day = parseDay(date)
  const query = useEntries({ date })
  const entries = query.data?.pages.flatMap((p) => p.results) ?? []
  const { data: allMarkers = [] } = useGoalMarkers()
  const markers = allMarkers.filter((m) => m.date === date)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Link to={`/calendar?month=${monthKey(day)}`} className="muted small">
            ← {format(day, 'MMMM yyyy')}
          </Link>
          <h1>{format(day, 'EEEE, MMMM d, yyyy')}</h1>
        </div>
        <div className="btn-group">
          <Link className="btn" to={`/day/${dayKey(addDays(day, -1))}`} aria-label="Previous day">
            ‹
          </Link>
          <Link className="btn" to={`/day/${dayKey(addDays(day, 1))}`} aria-label="Next day">
            ›
          </Link>
        </div>
      </div>

      {markers.length > 0 && (
        <section className="day-goal-list" aria-label="Goals">
          {markers.map((m) => (
            <Link key={markerKey(m)} to={`/goals/${m.goal.id}`} className={`day-goal-row kind-${m.kind}`}>
              {m.thumb && <img src={m.thumb} alt="" loading="lazy" />}
              <span className="gcard-kind">
                <span aria-hidden>{MARKER_ICON[m.kind]}</span> {MARKER_LABEL[m.kind]}
              </span>
              <strong>{m.title}</strong>
              {m.kind === 'milestone' && <span className="muted small">{m.goal.title}</span>}
            </Link>
          ))}
        </section>
      )}

      {query.isPending ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        markers.length === 0 && <p className="muted">Nothing recorded on this day.</p>
      ) : (
        <EntryFeed entries={entries} />
      )}
      {query.hasNextPage && (
        <button className="btn" onClick={() => query.fetchNextPage()}>
          Load more
        </button>
      )}
    </div>
  )
}
