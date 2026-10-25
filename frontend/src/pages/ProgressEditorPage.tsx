import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { errorMessage } from '../api/client'
import { useDeleteMedia, useInvalidateJournal, useProgressReports, useSaveProgressReport } from '../api/hooks'
import { MediaThumb } from '../components/MediaGrid'
import { MediaPicker, type QueuedFile } from '../components/MediaPicker'
import { WeightInput } from '../components/WeightInput'
import { WeightUnitToggle } from '../components/WeightUnitToggle'
import { dayKey } from '../lib/dates'
import { uploadSingle } from '../lib/upload'

/** New or edit progress report: date, body weight, notes, photos. */
export function ProgressEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: reports = [] } = useProgressReports()
  const existing = reports.find((r) => r.id === id)
  const save = useSaveProgressReport()
  const deletePhoto = useDeleteMedia()
  const invalidate = useInvalidateJournal()

  const [recordedOn, setRecordedOn] = useState(() => dayKey(new Date()))
  const [weightKg, setWeightKg] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [queue, setQueue] = useState<QueuedFile[]>([])
  const [savedId, setSavedId] = useState(id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(!id)

  useEffect(() => {
    if (!existing || loaded) return
    setRecordedOn(existing.recorded_on)
    setWeightKg(existing.body_weight_kg)
    setNotes(existing.notes)
    setLoaded(true)
  }, [existing, loaded])

  const updateQueued = (qid: string, patch: Partial<QueuedFile>) =>
    setQueue((q) => q.map((item) => (item.id === qid ? { ...item, ...patch } : item)))

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const report = await save.mutateAsync({ id: savedId, data: { recorded_on: recordedOn, body_weight_kg: weightKg, notes } })
      setSavedId(report.id)
      let failed = false
      for (const item of queue) {
        try {
          await uploadSingle(`/workouts/progress/${report.id}/photos/`, item.file, (progress) => updateQueued(item.id, { progress }), item.tags)
          setQueue((q) => q.filter((x) => x.id !== item.id))
        } catch (err) {
          failed = true
          updateQueued(item.id, { error: errorMessage(err) })
        }
      }
      await invalidate()
      if (failed) setError('The report was saved, but some photos failed to upload. Save again to retry them.')
      else navigate('/workouts/progress')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (id && !existing && !loaded) return <p className="muted">Loading…</p>

  return (
    <form className="page editor" onSubmit={onSubmit}>
      <div className="page-header">
        <h1>{id ? 'Edit progress report' : 'Progress report'}</h1>
        <WeightUnitToggle />
      </div>

      <div className="field-row">
        <label className="field">
          <span>Date</span>
          <input type="date" value={recordedOn} onChange={(e) => setRecordedOn(e.target.value)} required />
        </label>
        <label className="field">
          <span>
            Body weight <span className="muted">(optional)</span>
          </span>
          <WeightInput valueKg={weightKg} onChange={setWeightKg} />
        </label>
      </div>

      <label className="field">
        <span>
          Notes <span className="muted">(optional)</span>
        </span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Energy, sleep, measurements…" />
      </label>

      {existing && existing.photos.length > 0 && (
        <div className="field">
          <span>Photos</span>
          <div className="existing-media">
            {existing.photos.map((photo) => (
              <div key={photo.id} className="existing-media-item">
                <MediaThumb asset={photo} />
                <button type="button" className="btn ghost small" disabled={deletePhoto.isPending} onClick={() => deletePhoto.mutate(photo.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <span>{existing?.photos.length ? 'Add more photos' : 'Photos'}</span>
        <MediaPicker
          queue={queue}
          disabled={saving}
          onAdd={(files) =>
            setQueue((q) => [
              ...q,
              ...files.filter((f) => f.type.startsWith('image/')).map((file) => ({ id: crypto.randomUUID(), file, tags: [], progress: 0 })),
            ])
          }
          onRemove={(qid) => setQueue((q) => q.filter((x) => x.id !== qid))}
          onTagsChange={(qid, tags) => updateQueued(qid, { tags })}
        />
        <span className="muted small">Photos only. They stay private to Workouts and don’t appear on the Photos page.</span>
      </div>

      {error && <p className="error pre">{error}</p>}
      <div className="btn-group">
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save report'}
        </button>
        <button type="button" className="btn ghost" disabled={saving} onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
