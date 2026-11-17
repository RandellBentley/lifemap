import { useMemo, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { useDeleteProgressReport, useProgressReports, useWorkouts } from '../api/hooks'
import type { MediaAsset, ProgressReport, Workout } from '../api/types'
import { Lightbox } from '../components/Lightbox'
import { MediaGrid } from '../components/MediaGrid'
import { WeightUnitToggle } from '../components/WeightUnitToggle'
import { formatDay } from '../lib/format'
import { formatWeight, fromKg, useWeightUnit } from '../lib/weight'

/** /workouts (sessions) and /workouts/progress (progress reports), with a shared kg/lb toggle. */
export function WorkoutsPage() {
  const progress = useLocation().pathname.endsWith('/progress')
  return (
    <div className="page">
      <div className="page-header">
        <h1>Workouts</h1>
        <div className="btn-group">
          <WeightUnitToggle />
          {progress ? (
            <Link to="/workouts/progress/new" className="btn primary">
              + Progress report
            </Link>
          ) : (
            <Link to="/workouts/new" className="btn primary">
              + Log workout
            </Link>
          )}
        </div>
      </div>
      <nav className="tabs" aria-label="Workouts sections">
        <NavLink to="/workouts" end>
          Workouts
        </NavLink>
        <NavLink to="/workouts/progress">Progress</NavLink>
      </nav>
      {progress ? <ProgressList /> : <WorkoutList />}
    </div>
  )
}

function WorkoutList() {
  const query = useWorkouts()
  const workouts = query.data?.pages.flatMap((p) => p.results) ?? []

  if (query.isPending) return <p className="muted">Loading…</p>
  if (query.isError) return <p className="error">Couldn’t load workouts.</p>
  if (workouts.length === 0) {
    return (
      <div className="empty">
        <p>No workouts yet.</p>
        <Link to="/workouts/new" className="btn primary">
          Log your first workout
        </Link>
      </div>
    )
  }
  return (
    <>
      <ul className="workout-list">
        {workouts.map((w) => (
          <li key={w.id}>
            <WorkoutCard workout={w} />
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <button className="btn" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </>
  )
}

function WorkoutCard({ workout }: { workout: Workout }) {
  const [unit] = useWeightUnit()
  const videos = workout.exercises.reduce((n, e) => n + e.sets.filter((s) => s.video).length, 0)
  return (
    <Link to={`/workouts/${workout.id}`} className="card workout-card">
      <div className="workout-card-head">
        <strong>{formatDay(workout.performed_on)}</strong>
        {videos > 0 && (
          <span className="muted small">
            🎬 {videos} {videos === 1 ? 'video' : 'videos'}
          </span>
        )}
      </div>
      <ul className="workout-summary">
        {workout.exercises.map((e) => (
          <li key={e.id}>
            <span className="workout-summary-name">{e.exercise_name}</span>
            <span className="muted">
              {e.sets
                .map((s) => (s.weight_kg === null ? `${s.reps}` : `${s.reps} × ${formatWeight(s.weight_kg, unit)}`) + (s.made ? '' : ' (missed)'))
                .join(', ')}
            </span>
          </li>
        ))}
      </ul>
      {workout.notes && <p className="muted small workout-notes">{workout.notes}</p>}
    </Link>
  )
}

function ProgressList() {
  const { data: reports = [], isPending, isError } = useProgressReports()
  const photos = useMemo(() => reports.flatMap((r) => r.photos.filter((p) => p.status !== 'failed')), [reports])
  const [openId, setOpenId] = useState<string | null>(null)
  const openIndex = openId ? photos.findIndex((p) => p.id === openId) : -1

  if (isPending) return <p className="muted">Loading…</p>
  if (isError) return <p className="error">Couldn’t load progress reports.</p>
  if (reports.length === 0) {
    return (
      <div className="empty">
        <p>No progress reports yet. Log your weight and a few photos to see change over time.</p>
        <Link to="/workouts/progress/new" className="btn primary">
          Add your first report
        </Link>
      </div>
    )
  }
  return (
    <>
      <ul className="workout-list">
        {reports.map((r, i) => (
          <li key={r.id}>
            <ProgressCard report={r} previous={reports.slice(i + 1).find((x) => x.body_weight_kg !== null)} onOpen={(a) => setOpenId(a.id)} />
          </li>
        ))}
      </ul>
      {openIndex >= 0 && (
        <Lightbox items={photos} index={openIndex} onIndexChange={(i) => setOpenId(photos[i].id)} onClose={() => setOpenId(null)} />
      )}
    </>
  )
}

function ProgressCard({ report, previous, onOpen }: { report: ProgressReport; previous?: ProgressReport; onOpen: (a: MediaAsset) => void }) {
  const [unit] = useWeightUnit()
  const remove = useDeleteProgressReport()
  const [confirming, setConfirming] = useState(false)
  const change =
    report.body_weight_kg !== null && previous?.body_weight_kg != null
      ? fromKg(report.body_weight_kg - previous.body_weight_kg, unit)
      : null

  return (
    <div className="card progress-card">
      <div className="workout-card-head">
        <strong>{formatDay(report.recorded_on)}</strong>
        <div className="btn-group">
          <Link to={`/workouts/progress/${report.id}/edit`} className="btn ghost small">
            Edit
          </Link>
          {confirming ? (
            <>
              <button className="btn danger small" disabled={remove.isPending} onClick={() => remove.mutate(report.id)}>
                Delete report & {report.photos.length} photos
              </button>
              <button className="btn ghost small" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn ghost small" onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      </div>
      {report.body_weight_kg !== null && (
        <p className="progress-weight">
          {formatWeight(report.body_weight_kg, unit)}
          {change !== null && previous && (
            <span className="muted small">
              {' '}
              {change > 0 ? '+' : change < 0 ? '−' : '±'}
              {Math.abs(Math.round(change * 10) / 10)} {unit} since {formatDay(previous.recorded_on)}
            </span>
          )}
        </p>
      )}
      {report.notes && <p className="workout-notes">{report.notes}</p>}
      <MediaGrid media={report.photos.filter((p) => p.status !== 'failed')} onOpen={onOpen} compact />
    </div>
  )
}
