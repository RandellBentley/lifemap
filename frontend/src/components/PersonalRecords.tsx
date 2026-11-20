import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useDeletePersonalRecord, useExercises, usePersonalRecords } from '../api/hooks'
import { REP_TARGETS, type MediaAsset, type PRRow } from '../api/types'
import { formatDay } from '../lib/format'
import { formatWeight, useWeightUnit } from '../lib/weight'
import { Lightbox } from './Lightbox'
import { MediaThumb } from './MediaGrid'

const repsLabel = (n: number) => `${n} ${n === 1 ? 'rep' : 'reps'}`

/** "1 rep", "1 & 2 reps", "1, 2, 3 & 5 reps" */
export function repTargetsLabel(targets: number[]) {
  const sorted = [...targets].sort((a, b) => a - b)
  if (sorted.length === 1) return repsLabel(sorted[0])
  return `${sorted.slice(0, -1).join(', ')} & ${sorted.at(-1)} reps`
}

/**
 * Workouts → PRs: a card per lift in the exercise library with its best for 1, 2, 3 and 5 reps,
 * then every PR: logged ones and sets that beat the best so far (detected from workouts).
 */
export function PersonalRecords() {
  const exercises = useExercises()
  const records = usePersonalRecords()
  const byLift = useMemo(() => {
    const map = new Map<string, PRRow[]>()
    for (const r of records.data ?? []) map.set(r.exercise, [...(map.get(r.exercise) ?? []), r]) // newest first
    return map
  }, [records.data])
  const videos = useMemo(() => {
    const seen = new Map<string, MediaAsset>() // a set can be a PR for several targets: one video
    for (const r of records.data ?? []) if (r.video && r.video.status !== 'failed') seen.set(r.video.id, r.video)
    return [...seen.values()]
  }, [records.data])
  const [openId, setOpenId] = useState<string | null>(null)
  const openIndex = openId ? videos.findIndex((v) => v.id === openId) : -1

  if (exercises.isPending || records.isPending) return <p className="muted">Loading…</p>
  if (exercises.isError || records.isError) return <p className="error">Couldn’t load your PRs.</p>
  if (exercises.data.length === 0) {
    return (
      <div className="empty">
        <p>No lifts yet. Log a workout and your PRs will show up here, or add one yourself.</p>
        <Link to="/workouts/prs/new" className="btn primary">
          Add your first PR
        </Link>
      </div>
    )
  }

  return (
    <>
      <p className="muted small">PRs from your workouts appear automatically: the heaviest made set for each rep count.</p>
      <ul className="workout-list">
        {exercises.data.map((lift) => (
          <li key={lift.id}>
            <LiftRecords liftId={lift.id} name={lift.name} rows={byLift.get(lift.id) ?? []} onPlay={(v) => setOpenId(v.id)} />
          </li>
        ))}
      </ul>
      {openIndex >= 0 && (
        <Lightbox items={videos} index={openIndex} onIndexChange={(i) => setOpenId(videos[i].id)} onClose={() => setOpenId(null)} />
      )}
    </>
  )
}

/** One history line: a logged PR or a workout set, with every rep target it was a PR for. */
interface Entry {
  first: PRRow
  targets: number[]
}

function LiftRecords({ liftId, name, rows, onPlay }: { liftId: string; name: string; rows: PRRow[]; onPlay: (v: MediaAsset) => void }) {
  const [unit] = useWeightUnit()
  // Best per target: heaviest; on a tie, the earliest (rows arrive newest first).
  const best = (n: number) => rows.filter((r) => r.reps === n).reduce<PRRow | null>((a, b) => (!a || b.weight_kg >= a.weight_kg ? b : a), null)
  const entries = useMemo(() => {
    const bySource = new Map<string, Entry>()
    for (const r of rows) {
      const entry = bySource.get(r.source_id)
      if (entry) entry.targets.push(r.reps)
      else bySource.set(r.source_id, { first: r, targets: [r.reps] })
    }
    return [...bySource.values()]
  }, [rows])

  return (
    <section className="card pr-card">
      <div className="workout-card-head">
        <h2 className="exercise-title">{name}</h2>
        <Link to={`/workouts/prs/new?lift=${liftId}`} className="btn ghost small">
          + Log PR
        </Link>
      </div>
      <div className="pr-tiles">
        {REP_TARGETS.map((n) => {
          const b = best(n)
          return (
            <div key={n} className="pr-tile">
              <span className="muted small">{repsLabel(n)}</span>
              {b ? (
                <>
                  <strong>{formatWeight(b.weight_kg, unit)}</strong>
                  <span className="muted small">{formatDay(b.achieved_on)}</span>
                </>
              ) : (
                <Link to={`/workouts/prs/new?lift=${liftId}&reps=${n}`} className="muted small pr-tile-empty" aria-label={`Log a ${repsLabel(n)} PR for ${name}`}>
                  —
                </Link>
              )}
            </div>
          )
        })}
      </div>
      {entries.length > 0 && (
        <table className="sets-table readonly pr-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Lift</th>
              <th>PR for</th>
              <th>Video</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <EntryRow key={e.first.source_id} entry={e} onPlay={onPlay} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function EntryRow({ entry: { first: r, targets }, onPlay }: { entry: Entry; onPlay: (v: MediaAsset) => void }) {
  const [unit] = useWeightUnit()
  const remove = useDeletePersonalRecord()
  const [confirming, setConfirming] = useState(false)
  return (
    <tr>
      <td>{formatDay(r.achieved_on)}</td>
      <td>
        {formatWeight(r.weight_kg, unit)}
        {r.source === 'workout' && <span className="muted"> × {r.set_reps}</span>}
      </td>
      <td>{repTargetsLabel(targets)}</td>
      <td>
        {r.video && (
          <button className="set-video-thumb clickable" onClick={() => onPlay(r.video!)} aria-label={`Play video of ${formatWeight(r.weight_kg, unit)} PR`}>
            <MediaThumb asset={r.video} />
            <span className="badge play">▶</span>
          </button>
        )}
      </td>
      <td className="pr-actions">
        {r.source === 'workout' ? (
          // Detected from a workout, so it changes with the workout.
          <Link to={`/workouts/${r.workout_id}`} className="btn ghost small">
            Workout
          </Link>
        ) : confirming ? (
          <>
            <button className="btn danger small" disabled={remove.isPending} onClick={() => remove.mutate(r.source_id)}>
              Delete{r.video ? ' PR & video' : ''}
            </button>
            <button className="btn ghost small" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <Link to={`/workouts/prs/${r.source_id}/edit`} className="btn ghost small">
              Edit
            </Link>
            <button className="btn ghost small" onClick={() => setConfirming(true)}>
              Delete
            </button>
          </>
        )}
      </td>
    </tr>
  )
}
