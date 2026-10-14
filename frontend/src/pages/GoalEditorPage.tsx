import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { errorMessage } from '../api/client'
import { useGoal, useInvalidateJournal, useSaveGoal } from '../api/hooks'
import { NO_MEDIA_CHANGE, SingleMediaField, applyMediaChoice, type MediaChoice } from '../components/SingleMediaField'

export function GoalEditorPage() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const { data: existing } = useGoal(id)
  const save = useSaveGoal()
  const invalidate = useInvalidateJournal()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [reward, setReward] = useState('')
  const [photo, setPhoto] = useState<MediaChoice>(NO_MEDIA_CHANGE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Once created, retries (e.g. after a failed photo upload) update the same goal.
  const [savedId, setSavedId] = useState(id)

  useEffect(() => {
    if (!existing) return
    setTitle(existing.title)
    setDescription(existing.description)
    setStartsOn(existing.starts_on ?? '')
    setReward(existing.reward)
  }, [existing])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const goal = await save.mutateAsync({
        id: savedId,
        data: { title, description, starts_on: startsOn || null, reward },
      })
      setSavedId(goal.id)
      try {
        await applyMediaChoice(photo, `/goals/${goal.id}/photo/`)
      } catch (err) {
        setError(`The goal was saved, but the photo didn’t upload: ${errorMessage(err)}. Try saving again.`)
        return
      }
      await invalidate()
      navigate(`/goals/${goal.id}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="page editor" onSubmit={onSubmit}>
      <div className="page-header">
        <h1>{isNew ? 'New goal' : 'Edit goal'}</h1>
      </div>

      <label className="field">
        <span>Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Run a marathon, learn Spanish, …"
          maxLength={200}
          required
        />
      </label>

      <label className="field">
        <span>Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          placeholder="Why it matters, what done looks like…"
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span>
            Start date <span className="muted">(optional)</span>
          </span>
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </label>
        <label className="field">
          <span>
            Reward <span className="muted">(optional)</span>
          </span>
          <input
            value={reward}
            onChange={(e) => setReward(e.target.value)}
            placeholder="What you’ll treat yourself to"
            maxLength={300}
          />
        </label>
      </div>

      <div className="field">
        <span>
          Photo <span className="muted">(optional)</span>
        </span>
        <SingleMediaField current={existing?.photo} choice={photo} onChange={setPhoto} disabled={saving} />
      </div>

      {error && <p className="error pre">{error}</p>}

      <div className="btn-group">
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Create goal' : 'Save goal'}
        </button>
        <button type="button" className="btn ghost" onClick={() => navigate(-1)} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  )
}
