import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { errorMessage } from '../api/client'
import { removeSingleMedia, useCreateExercise, useInvalidateJournal, usePersonalRecords, useSavePersonalRecord } from '../api/hooks'
import { REP_TARGETS, type RepTarget } from '../api/types'
import { ExerciseSelect } from '../components/ExerciseSelect'
import { VideoField, type VideoDraft } from '../components/VideoField'
import { WeightInput } from '../components/WeightInput'
import { WeightUnitToggle } from '../components/WeightUnitToggle'
import { dayKey } from '../lib/dates'
import { uploadSingle } from '../lib/upload'

/** New or edit a logged PR: lift, rep target, weight, date, optional video. ?lift=<id>&reps=<n> preselect. */
export function PersonalRecordEditorPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { data: records = [] } = usePersonalRecords()
  const existing = records.find((r) => r.source === 'logged' && r.source_id === id)
  const save = useSavePersonalRecord()
  const createExercise = useCreateExercise()
  const invalidate = useInvalidateJournal()

  const [exerciseId, setExerciseId] = useState(params.get('lift') ?? '')
  const [newExerciseName, setNewExerciseName] = useState<string>()
  const [reps, setReps] = useState<RepTarget>(() => REP_TARGETS.find((n) => String(n) === params.get('reps')) ?? 1)
  const [weightKg, setWeightKg] = useState<number | null>(null)
  const [achievedOn, setAchievedOn] = useState(() => dayKey(new Date()))
  const [video, setVideo] = useState<VideoDraft>({ video: null, newVideo: null, removeVideo: false })
  const [savedId, setSavedId] = useState(id)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load once: the list refetches while a video processes, which mustn't wipe unsaved edits.
  const [loaded, setLoaded] = useState(!id)
  useEffect(() => {
    if (!existing || loaded) return
    setExerciseId(existing.exercise)
    setReps(existing.reps)
    setWeightKg(existing.weight_kg)
    setAchievedOn(existing.achieved_on)
    setVideo({ video: existing.video, newVideo: null, removeVideo: false })
    setLoaded(true)
  }, [existing, loaded])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      let exercise = exerciseId
      if (!exercise && newExerciseName?.trim()) {
        // A typed name counts as choosing that lift, even if "Add" wasn't clicked.
        setStatus('Adding lift…')
        exercise = (await createExercise.mutateAsync(newExerciseName)).id
        setExerciseId(exercise)
        setNewExerciseName(undefined)
      }
      if (!exercise) return setError('Choose a lift.')
      if (weightKg === null) return setError('Enter the weight.')

      setStatus('Saving…')
      const record = await save.mutateAsync({ id: savedId, data: { exercise, reps, weight_kg: weightKg, achieved_on: achievedOn } })
      setSavedId(record.id)
      const path = `/workouts/records/${record.id}/video/`
      if (video.newVideo) {
        setStatus('Uploading video…')
        await uploadSingle(path, video.newVideo)
      } else if (video.removeVideo && video.video) {
        await removeSingleMedia(path)
      }
      await invalidate()
      navigate('/workouts/prs')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setStatus(null)
    }
  }

  if (id && !loaded) return <p className="muted">Loading…</p>
  const busy = status !== null

  return (
    <form className="page editor" onSubmit={onSubmit}>
      <div className="page-header">
        <h1>{id ? 'Edit PR' : 'New PR'}</h1>
        <WeightUnitToggle />
      </div>

      <div className="field">
        <span>Lift</span>
        <ExerciseSelect value={exerciseId} onChange={setExerciseId} newName={newExerciseName} onNewNameChange={setNewExerciseName} />
      </div>

      <div className="field-row">
        <label className="field">
          <span>Reps</span>
          <select value={reps} onChange={(e) => setReps(Number(e.target.value) as RepTarget)}>
            {REP_TARGETS.map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'rep' : 'reps'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Weight</span>
          <WeightInput valueKg={weightKg} onChange={setWeightKg} />
        </label>
        <label className="field">
          <span>Date</span>
          <input type="date" value={achievedOn} onChange={(e) => setAchievedOn(e.target.value)} required />
        </label>
      </div>

      <div className="field">
        <span>
          Video <span className="muted">(optional)</span>
        </span>
        <VideoField value={video} disabled={busy} onChange={(patch) => setVideo((v) => ({ ...v, ...patch }))} />
      </div>

      {error && <p className="error pre">{error}</p>}
      <div className="btn-group">
        <button type="submit" className="btn primary" disabled={busy}>
          {status ?? 'Save PR'}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
