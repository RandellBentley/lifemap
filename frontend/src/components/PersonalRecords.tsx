import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useDeletePersonalRecord, useExercises, usePersonalRecords } from '../api/hooks'
import type { MediaAsset, PersonalRecord } from '../api/types'
import { formatDay } from '../lib/format'
import { formatWeight, useWeightUnit } from '../lib/weight'
import { Lightbox } from './Lightbox'
import { MediaThumb } from './MediaGrid'

/** Workouts → PRs: one card per lift in the exercise library, best PR first, then every PR logged. */
export function PersonalRecords() {
  const exercises = useExercises()
  const records = usePersonalRecords()
  const byLift = useMemo(() => {
    const map = new Map<string, PersonalRecord[]>()
    for (const r of records.data ?? []) map.set(r.exercise, [...(map.get(r.exercise) ?? []), r]) // newest first
    return map
  }, [records.data])
  const videos = useMemo(() => (records.data ?? []).flatMap((r) => (r.video && r.video.status !== 'failed' ? [r.video] : [])), [records.data])
  const [openId, setOpenId] = useState<string | null>(null)
  const openIndex = openId ? videos.findIndex((v) => v.id === openId) : -1

  if (exercises.isPending || records.isPending) return <p className="muted">Loading…</p>
  if (exercises.isError || records.isError) return <p className="error">Couldn’t load your PRs.</p>
  if (exercises.data.length === 0) {
    return (
      <div className="empty">
        <p>No lifts yet. Add one with your first PR, or log a workout.</p>
        <Link to="/workouts/prs/new" className="btn primary">
          Add your first PR
        </Link>
      </div>
    )
  }

  return (
    <>
      <ul className="workout-list">
        {exercises.data.map((lift) => (
          <li key={lift.id}>
            <LiftRecords liftId={lift.id} name={lift.name} records={byLift.get(lift.id) ?? []} onPlay={(v) => setOpenId(v.id)} />
          </li>
        ))}
      </ul>
      {openIndex >= 0 && (
        <Lightbox items={videos} index={openIndex} onIndexChange={(i) => setOpenId(videos[i].id)} onClose={() => setOpenId(null)} />
      )}
    </>
  )
}

function LiftRecords({ liftId, name, records, onPlay }: { liftId: string; name: string; records: PersonalRecord[]; onPlay: (v: MediaAsset) => void }) {
  const [unit] = useWeightUnit()
  // Heaviest wins; on a tie, the most recent (records arrive newest first).
  const best = records.reduce<PersonalRecord | null>((a, b) => (!a || b.weight_kg > a.weight_kg ? b : a), null)

  return (
    <section className="card pr-card">
      <div className="workout-card-head">
        <h2 className="exercise-title">{name}</h2>
        <Link to={`/workouts/prs/new?lift=${liftId}`} className="btn ghost small">
          + New PR
        </Link>
      </div>
      {best ? (
        <p className="pr-best">
          <strong>{formatWeight(best.weight_kg, unit)}</strong> <span className="muted small">best · {formatDay(best.achieved_on)}</span>
        </p>
      ) : (
        <p className="muted small">No PR yet.</p>
      )}
      {records.length > 0 && (
        <table className="sets-table readonly pr-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Weight</th>
              <th>Video</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <RecordRow key={r.id} record={r} isBest={r === best} onPlay={onPlay} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function RecordRow({ record, isBest, onPlay }: { record: PersonalRecord; isBest: boolean; onPlay: (v: MediaAsset) => void }) {
  const [unit] = useWeightUnit()
  const remove = useDeletePersonalRecord()
  const [confirming, setConfirming] = useState(false)
  return (
    <tr className={isBest ? 'pr-best-row' : undefined}>
      <td>{formatDay(record.achieved_on)}</td>
      <td>{formatWeight(record.weight_kg, unit)}</td>
      <td>
        {record.video && (
          <button className="set-video-thumb clickable" onClick={() => onPlay(record.video!)} aria-label={`Play video of ${formatWeight(record.weight_kg, unit)} PR`}>
            <MediaThumb asset={record.video} />
            <span className="badge play">▶</span>
            {record.video.status !== 'ready' && <span className="badge status">Processing…</span>}
          </button>
        )}
      </td>
      <td className="pr-actions">
        {confirming ? (
          <>
            <button className="btn danger small" disabled={remove.isPending} onClick={() => remove.mutate(record.id)}>
              Delete{record.video ? ' PR & video' : ''}
            </button>
            <button className="btn ghost small" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <Link to={`/workouts/prs/${record.id}/edit`} className="btn ghost small">
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
