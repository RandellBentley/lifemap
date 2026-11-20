import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useDeleteProgressReport, useProgressReports } from '../api/hooks'
import { Lightbox } from '../components/Lightbox'
import { MediaGrid } from '../components/MediaGrid'
import { WeightUnitToggle } from '../components/WeightUnitToggle'
import { formatDay } from '../lib/format'
import { formatWeight, fromKg, useWeightUnit } from '../lib/weight'

/** One physique update: date, body weight (and change since the last one), notes, photos. */
export function PhysiqueUpdatePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: reports, isPending, isError } = useProgressReports()
  const remove = useDeleteProgressReport()
  const [unit] = useWeightUnit()
  const [confirming, setConfirming] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const index = reports?.findIndex((r) => r.id === id) ?? -1
  const report = index >= 0 ? reports![index] : undefined
  const photos = useMemo(() => report?.photos.filter((p) => p.status !== 'failed') ?? [], [report])
  const openIndex = openId ? photos.findIndex((p) => p.id === openId) : -1

  if (isPending) return <p className="muted">Loading…</p>
  if (isError || !report) return <p className="error">Physique update not found.</p>

  // Reports are newest first, so the previous weigh-in comes later in the list.
  const previous = reports!.slice(index + 1).find((r) => r.body_weight_kg !== null)
  const change = report.body_weight_kg !== null && previous ? fromKg(report.body_weight_kg - previous.body_weight_kg!, unit) : null

  return (
    <article className="page physique-page">
      <div className="page-header">
        <div>
          <Link to="/workouts/physique" className="muted small">
            ← Physique
          </Link>
          <h1>{formatDay(report.recorded_on)}</h1>
          {report.workout && (
            <p className="muted">
              Part of <Link to={`/workouts/${report.workout}`}>that day’s workout</Link>
            </p>
          )}
        </div>
        <div className="btn-group">
          <WeightUnitToggle />
          {report.workout ? (
            // Its date and contents are edited through the workout.
            <Link to={`/workouts/${report.workout}/edit`} className="btn">
              Edit in workout
            </Link>
          ) : (
            <Link to={`/workouts/physique/${report.id}/edit`} className="btn">
              Edit
            </Link>
          )}
          {confirming ? (
            <>
              <button
                className="btn danger"
                disabled={remove.isPending}
                onClick={async () => {
                  try {
                    await remove.mutateAsync(report.id)
                    navigate('/workouts/physique')
                  } catch {
                    // shown below
                  }
                }}
              >
                Delete update{photos.length > 0 && ` & ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`}
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
      {remove.isError && <p className="error">Couldn’t delete this update. Please try again.</p>}

      <section className="card physique-block">
        {report.body_weight_kg !== null ? (
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
        ) : (
          <p className="muted">No body weight recorded.</p>
        )}
        {report.notes && <p className="workout-notes">{report.notes}</p>}
        <MediaGrid media={photos} onOpen={(a) => setOpenId(a.id)} compact />
      </section>

      {openIndex >= 0 && (
        <Lightbox items={photos} index={openIndex} onIndexChange={(i) => setOpenId(photos[i].id)} onClose={() => setOpenId(null)} />
      )}
    </article>
  )
}
