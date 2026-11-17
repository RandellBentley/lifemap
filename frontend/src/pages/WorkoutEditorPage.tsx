import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, errorMessage } from '../api/client'
import { removeSingleMedia, useCreateExercise, useInvalidateJournal, useSaveWorkout, useWorkout } from '../api/hooks'
import type { MediaAsset, Physique, Workout } from '../api/types'
import { ExerciseSelect } from '../components/ExerciseSelect'
import { MediaThumb } from '../components/MediaGrid'
import { MediaPicker, type QueuedFile } from '../components/MediaPicker'
import { WeightInput } from '../components/WeightInput'
import { WeightUnitToggle } from '../components/WeightUnitToggle'
import { dayKey } from '../lib/dates'
import { uploadSingle } from '../lib/upload'

interface SetDraft {
  key: string
  id?: string
  reps: number | null
  weightKg: number | null
  made: boolean
  video: MediaAsset | null // already attached
  newVideo: File | null // chosen, uploads after save
  removeVideo: boolean
}

interface ExerciseDraft {
  key: string
  id?: string
  exerciseId: string
  newExerciseName?: string // typed into "+ Add new exercise…", not yet added
  sets: SetDraft[]
}

const key = () => crypto.randomUUID()
const blankSet = (from?: SetDraft): SetDraft => ({
  key: key(),
  reps: from?.reps ?? null,
  weightKg: from?.weightKg ?? null, // "+ Add set" repeats the previous set's numbers
  made: true, // ...but not a miss
  video: null,
  newVideo: null,
  removeVideo: false,
})
const blankExercise = (): ExerciseDraft => ({ key: key(), exerciseId: '', sets: [blankSet()] })

function toDrafts(workout: Workout): ExerciseDraft[] {
  return workout.exercises.map((e) => ({
    key: key(),
    id: e.id,
    exerciseId: e.exercise,
    sets: e.sets.map((s) => ({ key: key(), id: s.id, reps: s.reps, weightKg: s.weight_kg, made: s.made, video: s.video, newVideo: null, removeVideo: false })),
  }))
}

export function WorkoutEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: existing } = useWorkout(id)
  const save = useSaveWorkout()
  const createExercise = useCreateExercise()
  const invalidate = useInvalidateJournal()

  const [performedOn, setPerformedOn] = useState(() => dayKey(new Date()))
  const [notes, setNotes] = useState('')
  const [exercises, setExercises] = useState<ExerciseDraft[]>([blankExercise()])
  const [savedId, setSavedId] = useState(id)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Optional physique update. Photo removals and uploads wait for Save, like set videos.
  const [physiqueOpen, setPhysiqueOpen] = useState(false)
  const [bodyWeightKg, setBodyWeightKg] = useState<number | null>(null)
  const [savedPhysique, setSavedPhysique] = useState<Physique | null>(null)
  const [keptPhotos, setKeptPhotos] = useState<MediaAsset[]>([])
  const [photoQueue, setPhotoQueue] = useState<QueuedFile[]>([])

  // Load the saved workout once: it refetches every few seconds while media processes, and
  // copying it in again would wipe unsaved edits.
  const [loadedId, setLoadedId] = useState<string>()
  useEffect(() => {
    if (!existing || existing.id === loadedId) return
    setPerformedOn(existing.performed_on)
    setNotes(existing.notes)
    setExercises(toDrafts(existing))
    setPhysiqueOpen(!!existing.physique)
    setBodyWeightKg(existing.physique?.body_weight_kg ?? null)
    setSavedPhysique(existing.physique)
    setKeptPhotos(existing.physique?.photos ?? [])
    setLoadedId(existing.id)
  }, [existing, loadedId])

  const updateExercise = (k: string, patch: Partial<ExerciseDraft>) =>
    setExercises((list) => list.map((e) => (e.key === k ? { ...e, ...patch } : e)))
  const updateSet = (ek: string, sk: string, patch: Partial<SetDraft>) =>
    setExercises((list) => list.map((e) => (e.key === ek ? { ...e, sets: e.sets.map((s) => (s.key === sk ? { ...s, ...patch } : s)) } : e)))

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      // A typed name counts as choosing that exercise, even if "Add" wasn't clicked.
      let list = exercises
      if (list.some(pendingName)) {
        setStatus('Adding exercises…')
        list = [...list]
        for (const [i, ex] of list.entries()) {
          // One at a time: two blocks with the same new name get the same exercise.
          if (pendingName(ex)) list[i] = { ...ex, exerciseId: (await createExercise.mutateAsync(ex.newExerciseName!)).id, newExerciseName: undefined }
        }
        setExercises(list)
      }
      const problem = findProblem(list)
      if (problem) return setError(problem)

      // An open section with nothing in it counts as no update.
      const hasPhysique = physiqueOpen && (bodyWeightKg !== null || keptPhotos.length > 0 || photoQueue.length > 0)

      setStatus('Saving…')
      const workout = await save.mutateAsync({
        id: savedId,
        data: {
          performed_on: performedOn,
          notes,
          // Omitted: nothing to change. null: delete the saved one along with its photos.
          physique: hasPhysique ? { body_weight_kg: bodyWeightKg } : savedPhysique ? null : undefined,
          exercises: list.map((ex) => ({
            id: ex.id,
            exercise: ex.exerciseId,
            sets: ex.sets.map((s) => ({ id: s.id, reps: s.reps!, weight_kg: s.weightKg, made: s.made })),
          })),
        },
      })
      setSavedId(workout.id)

      // The response lists exercises and sets in the order we sent them, which maps each draft
      // to its saved set id; then attach or remove videos per set.
      const jobs: { setId: string; draft: SetDraft }[] = []
      workout.exercises.forEach((we, i) => we.sets.forEach((ws, j) => jobs.push({ setId: ws.id, draft: list[i].sets[j] })))
      // Keep ids so a retry after a failed upload updates instead of duplicating.
      setExercises((list) => list.map((ex, i) => ({ ...ex, id: workout.exercises[i].id, sets: ex.sets.map((s, j) => ({ ...s, id: workout.exercises[i].sets[j].id })) })))

      const uploads = jobs.filter((j) => j.draft.newVideo)
      let done = 0
      for (const { setId, draft } of jobs) {
        const path = `/workouts/sets/${setId}/video/`
        if (draft.newVideo) {
          setStatus(`Uploading video ${done + 1} of ${uploads.length}…`)
          await uploadSingle(path, draft.newVideo)
          done++
        } else if (draft.removeVideo && draft.video) {
          await removeSingleMedia(path)
        }
      }

      setSavedPhysique(workout.physique)
      if (workout.physique) {
        const removed = workout.physique.photos.filter((p) => !keptPhotos.some((k) => k.id === p.id))
        for (const photo of removed) await api<void>(`/media/${photo.id}/`, { method: 'DELETE' })
        setKeptPhotos(workout.physique.photos.filter((p) => !removed.includes(p)))
        for (const [i, item] of photoQueue.entries()) {
          setStatus(`Uploading photo ${i + 1} of ${photoQueue.length}…`)
          const upload = (progress: number) => setPhotoQueue((q) => q.map((x) => (x.id === item.id ? { ...x, progress } : x)))
          await uploadSingle(`/workouts/progress/${workout.physique.id}/photos/`, item.file, upload, item.tags)
          // Done ones leave the queue, so a retry after a failure doesn't upload them twice.
          setPhotoQueue((q) => q.filter((x) => x.id !== item.id))
        }
      } else {
        setKeptPhotos([])
        setPhotoQueue([]) // the section was removed before these were uploaded
      }
      await invalidate()
      navigate(`/workouts/${workout.id}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setStatus(null)
    }
  }

  const busy = status !== null

  return (
    <form className="page editor workout-editor" onSubmit={onSubmit}>
      <div className="page-header">
        <h1>{id ? 'Edit workout' : 'Log workout'}</h1>
        <WeightUnitToggle />
      </div>

      <label className="field">
        <span>Date</span>
        <input type="date" value={performedOn} onChange={(e) => setPerformedOn(e.target.value)} required />
      </label>

      {exercises.map((ex, ei) => (
        <section key={ex.key} className="card exercise-block">
          <div className="exercise-block-head">
            <span className="muted small">Exercise {ei + 1}</span>
            <ExerciseSelect
              value={ex.exerciseId}
              onChange={(exerciseId) => updateExercise(ex.key, { exerciseId })}
              newName={ex.newExerciseName}
              onNewNameChange={(newExerciseName) => updateExercise(ex.key, { newExerciseName })}
            />
            <span className="spacer" />
            {exercises.length > 1 && (
              <button type="button" className="btn ghost small" onClick={() => setExercises((l) => l.filter((x) => x.key !== ex.key))}>
                Remove exercise
              </button>
            )}
          </div>

          <table className="sets-table">
            <thead>
              <tr>
                <th>Set</th>
                <th>Reps</th>
                <th>Weight</th>
                <th>Result</th>
                <th>Video (optional)</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {ex.sets.map((s, si) => (
                <tr key={s.key}>
                  <td className="set-number">{si + 1}</td>
                  <td>
                    <input
                      className="reps-input"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={s.reps ?? ''}
                      aria-label={`Set ${si + 1} reps`}
                      onChange={(e) => updateSet(ex.key, s.key, { reps: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <WeightInput valueKg={s.weightKg} onChange={(weightKg) => updateSet(ex.key, s.key, { weightKg })} aria-label={`Set ${si + 1} weight`} />
                  </td>
                  <td>
                    <MadeToggle made={s.made} setNumber={si + 1} onChange={(made) => updateSet(ex.key, s.key, { made })} />
                  </td>
                  <td>
                    <SetVideoField set={s} disabled={busy} onChange={(patch) => updateSet(ex.key, s.key, patch)} />
                  </td>
                  <td>
                    {ex.sets.length > 1 && (
                      <button
                        type="button"
                        className="btn ghost small"
                        aria-label={`Remove set ${si + 1}`}
                        onClick={() => updateExercise(ex.key, { sets: ex.sets.filter((x) => x.key !== s.key) })}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn small" onClick={() => updateExercise(ex.key, { sets: [...ex.sets, blankSet(ex.sets.at(-1))] })}>
            + Add set
          </button>
        </section>
      ))}

      <button type="button" className="btn" onClick={() => setExercises((l) => [...l, blankExercise()])}>
        + Add exercise
      </button>

      {physiqueOpen ? (
        <section className="card physique-block">
          <div className="exercise-block-head">
            <h2 className="exercise-title">Physique update</h2>
            <span className="spacer" />
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => setPhysiqueOpen(false)}>
              Remove
            </button>
          </div>
          <label className="field">
            <span>
              Body weight <span className="muted">(optional)</span>
            </span>
            <WeightInput valueKg={bodyWeightKg} onChange={setBodyWeightKg} />
          </label>
          {keptPhotos.length > 0 && (
            <div className="existing-media">
              {keptPhotos.map((photo) => (
                <div key={photo.id} className="existing-media-item">
                  <MediaThumb asset={photo} />
                  <button type="button" className="btn ghost small" disabled={busy} onClick={() => setKeptPhotos((l) => l.filter((p) => p.id !== photo.id))}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <MediaPicker
            photosOnly
            queue={photoQueue}
            disabled={busy}
            onAdd={(files) =>
              setPhotoQueue((q) => [
                ...q,
                ...files.filter((f) => f.type.startsWith('image/')).map((file) => ({ id: crypto.randomUUID(), file, tags: [], progress: 0 })),
              ])
            }
            onRemove={(qid) => setPhotoQueue((q) => q.filter((x) => x.id !== qid))}
            onTagsChange={(qid, tags) => setPhotoQueue((q) => q.map((x) => (x.id === qid ? { ...x, tags } : x)))}
          />
          <span className="muted small">
            Photos only. They also appear under Physique, and stay off the Photos page.
            {savedPhysique && ' Removing this update deletes its photos when you save.'}
          </span>
        </section>
      ) : (
        <button type="button" className="btn" onClick={() => setPhysiqueOpen(true)}>
          + Add physique update <span className="muted">(optional)</span>
        </button>
      )}

      <label className="field">
        <span>
          Notes <span className="muted">(optional)</span>
        </span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="How it felt, technique cues…" />
      </label>

      {error && <p className="error pre">{error}</p>}
      <div className="btn-group">
        <button type="submit" className="btn primary" disabled={busy}>
          {status ?? 'Save workout'}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>
    </form>
  )
}

const pendingName = (ex: ExerciseDraft) => !!ex.newExerciseName?.trim()

function findProblem(exercises: ExerciseDraft[]): string | null {
  if (exercises.length === 0) return 'Add at least one exercise.'
  const unchosen = exercises.findIndex((e) => !e.exerciseId)
  if (unchosen >= 0) return `Choose an exercise for exercise ${unchosen + 1}.`
  if (exercises.some((e) => e.sets.length === 0)) return 'Each exercise needs at least one set.'
  if (exercises.some((e) => e.sets.some((s) => s.reps === null))) return 'Enter reps for every set.'
  return null
}

/** Made by default; one tap marks the lift as missed (and back). */
function MadeToggle({ made, setNumber, onChange }: { made: boolean; setNumber: number; onChange: (made: boolean) => void }) {
  return (
    <button
      type="button"
      className={`made-toggle ${made ? 'made' : 'missed'}`}
      aria-label={`Set ${setNumber}: ${made ? 'made' : 'missed'}. Mark as ${made ? 'missed' : 'made'}`}
      onClick={() => onChange(!made)}
    >
      {made ? '✓' : '✗'}
      <span className="made-label">{made ? 'Made' : 'Missed'}</span>
    </button>
  )
}

/** Attach, replace or remove one set's video; nothing uploads until the workout is saved. */
function SetVideoField({ set, onChange, disabled }: { set: SetDraft; onChange: (patch: Partial<SetDraft>) => void; disabled?: boolean }) {
  const shownExisting = set.video && !set.removeVideo && !set.newVideo
  return (
    <span className="set-video">
      {shownExisting && (
        <span className="set-video-thumb">
          <MediaThumb asset={set.video!} />
        </span>
      )}
      {set.newVideo && <span className="muted small set-video-name">{set.newVideo.name}</span>}
      <label className={`btn ghost small ${disabled ? 'disabled' : ''}`}>
        {shownExisting || set.newVideo ? 'Replace' : '+ Video'}
        <input
          type="file"
          accept="video/*"
          hidden
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onChange({ newVideo: file, removeVideo: false })
            e.target.value = ''
          }}
        />
      </label>
      {(shownExisting || set.newVideo) && (
        <button type="button" className="btn ghost small" disabled={disabled} onClick={() => onChange({ newVideo: null, removeVideo: !!set.video })}>
          Remove
        </button>
      )}
    </span>
  )
}
