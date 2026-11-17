import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useDeleteWorkout, useWorkout } from '../api/hooks'
import type { MediaAsset } from '../api/types'
import { Lightbox } from '../components/Lightbox'
import { MediaThumb } from '../components/MediaGrid'
import { WeightUnitToggle } from '../components/WeightUnitToggle'
import { formatDay } from '../lib/format'
import { formatWeight, useWeightUnit } from '../lib/weight'

export function WorkoutPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: workout, isPending, isError } = useWorkout(id)
  const remove = useDeleteWorkout()
  const [unit] = useWeightUnit()
  const [confirming, setConfirming] = useState(false)

  const videos = useMemo(
    () => workout?.exercises.flatMap((e) => e.sets.map((s) => s.video).filter((v): v is MediaAsset => !!v && v.status !== 'failed')) ?? [],
    [workout],
  )
  const [openId, setOpenId] = useState<string | null>(null)
  const openIndex = openId ? videos.findIndex((v) => v.id === openId) : -1

  if (isPending) return <p className="muted">Loading…</p>
  if (isError || !workout) return <p className="error">Workout not found.</p>

  const totalSets = workout.exercises.reduce((n, e) => n + e.sets.length, 0)

  return (
    <article className="page workout-page">
      <div className="page-header">
        <div>
          <Link to="/workouts" className="muted small">
            ← Workouts
          </Link>
          <h1>{formatDay(workout.performed_on)}</h1>
          <p className="muted">
            {workout.exercises.length} {workout.exercises.length === 1 ? 'exercise' : 'exercises'} · {totalSets} sets
          </p>
        </div>
        <div className="btn-group">
          <WeightUnitToggle />
          <Link to={`/workouts/${workout.id}/edit`} className="btn">
            Edit
          </Link>
          {confirming ? (
            <>
              <button
                className="btn danger"
                disabled={remove.isPending}
                onClick={async () => {
                  try {
                    await remove.mutateAsync(workout.id)
                    navigate('/workouts')
                  } catch {
                    // shown below
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
      {remove.isError && <p className="error">Couldn’t delete this workout. Please try again.</p>}

      {workout.exercises.map((e) => (
        <section key={e.id} className="card exercise-block">
          <h2 className="exercise-title">{e.exercise_name}</h2>
          <table className="sets-table readonly">
            <thead>
              <tr>
                <th>Set</th>
                <th>Reps</th>
                <th>Weight</th>
                <th>Result</th>
                <th>Video</th>
              </tr>
            </thead>
            <tbody>
              {e.sets.map((s, i) => (
                <tr key={s.id} className={s.made ? undefined : 'missed-set'}>
                  <td className="set-number">{i + 1}</td>
                  <td>{s.reps}</td>
                  <td>{formatWeight(s.weight_kg, unit)}</td>
                  <td className={s.made ? 'set-result made' : 'set-result missed'}>{s.made ? 'Made' : 'Missed'}</td>
                  <td>
                    {s.video && (
                      <button className="set-video-thumb clickable" onClick={() => setOpenId(s.video!.id)} aria-label={`Play set ${i + 1} video`}>
                        <MediaThumb asset={s.video} />
                        <span className="badge play">▶</span>
                        {s.video.status !== 'ready' && <span className="badge status">Processing…</span>}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {workout.notes && <div className="body">{workout.notes}</div>}

      {openIndex >= 0 && (
        <Lightbox items={videos} index={openIndex} onIndexChange={(i) => setOpenId(videos[i].id)} onClose={() => setOpenId(null)} />
      )}
    </article>
  )
}
