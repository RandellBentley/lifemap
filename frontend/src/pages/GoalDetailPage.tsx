import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { errorMessage } from '../api/client'
import {
  useDeleteGoal,
  useDeleteMilestone,
  useGoal,
  useInvalidateJournal,
  useMilestones,
  useSaveGoal,
  useSaveMilestone,
} from '../api/hooks'
import type { Goal, MediaAsset, Metric, Milestone } from '../api/types'
import { GoalMetrics } from '../components/GoalMetrics'
import { Lightbox } from '../components/Lightbox'
import { MetricValueInput } from '../components/MetricValueInput'
import { MediaThumb } from '../components/MediaGrid'
import { TagChips } from '../components/TagChips'
import { NO_MEDIA_CHANGE, SingleMediaField, applyMediaChoice, type MediaChoice } from '../components/SingleMediaField'
import { dayKey } from '../lib/dates'
import { formatDay } from '../lib/format'
import { formatValue } from '../lib/units'

export function GoalDetailPage() {
  const { id } = useParams()
  const { data: goal, isPending, isError } = useGoal(id)
  const { data: milestones = [] } = useMilestones(id)
  if (isPending) return <p className="muted">Loading…</p>
  if (isError || !goal) return <p className="error">Goal not found.</p>
  return <GoalView goal={goal} milestones={milestones} />
}

function GoalView({ goal, milestones }: { goal: Goal; milestones: Milestone[] }) {
  const navigate = useNavigate()
  const saveGoal = useSaveGoal()
  const deleteGoal = useDeleteGoal()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // One viewer across the goal photo and every milestone's photo/video.
  const media = useMemo(
    () => [goal.photo, ...milestones.map((m) => m.media)].filter((m): m is MediaAsset => !!m && m.status !== 'failed'),
    [goal.photo, milestones],
  )
  const [openId, setOpenId] = useState<string | null>(null)
  const openIndex = openId ? media.findIndex((m) => m.id === openId) : -1

  const lastDated = [...milestones].reverse().find((m) => m.occurred_on)

  const setAchieved = (achieved_on: string | null) => saveGoal.mutate({ id: goal.id, data: { achieved_on } })

  const remove = async () => {
    try {
      await deleteGoal.mutateAsync(goal.id)
      navigate('/goals')
    } catch {
      // shown via deleteGoal.isError
    }
  }

  return (
    <article className="page goal-page">
      <div className="goal-header">
        {goal.photo && (
          <button className="goal-photo" onClick={() => setOpenId(goal.photo!.id)} aria-label="View goal photo">
            <MediaThumb asset={goal.photo} />
          </button>
        )}
        <div className="goal-header-text">
          <span className={`goal-status ${goal.achieved_on ? 'achieved' : ''}`}>
            {goal.achieved_on ? `✓ Achieved ${formatDay(goal.achieved_on)}` : 'In progress'}
          </span>
          <h1>{goal.title}</h1>
          <div className="goal-meta">
            {goal.starts_on && <span>Started {formatDay(goal.starts_on)}</span>}
            <span>
              {milestones.length} {milestones.length === 1 ? 'milestone' : 'milestones'}
              {lastDated && ` · latest ${formatDay(lastDated.occurred_on!)}`}
            </span>
          </div>
          {goal.reward && (
            <div className="goal-reward">
              🏆 <strong>Reward:</strong> {goal.reward}
            </div>
          )}
          {goal.photo && goal.photo.tags.length > 0 && <TagChips tags={goal.photo.tags} />}
        </div>
        <div className="btn-group goal-actions">
          {goal.achieved_on ? (
            <button className="btn" disabled={saveGoal.isPending} onClick={() => setAchieved(null)}>
              Mark in progress
            </button>
          ) : (
            <button className="btn primary" disabled={saveGoal.isPending} onClick={() => setAchieved(dayKey(new Date()))}>
              ✓ Mark achieved
            </button>
          )}
          <Link className="btn" to={`/goals/${goal.id}/edit`}>
            Edit
          </Link>
          {!confirmingDelete && (
            <button className="btn ghost" onClick={() => setConfirmingDelete(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      {saveGoal.isError && <p className="error">{errorMessage(saveGoal.error)}</p>}
      {confirmingDelete && (
        <div className="confirm-panel" role="alertdialog" aria-label="Delete goal">
          <p>
            <strong>Delete “{goal.title}”?</strong> Its {milestones.length}{' '}
            {milestones.length === 1 ? 'milestone' : 'milestones'} and photos will be deleted too.
          </p>
          <div className="btn-group">
            <button className="btn danger" disabled={deleteGoal.isPending} onClick={remove}>
              Delete goal
            </button>
            <button className="btn ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
          </div>
          {deleteGoal.isError && <p className="error">Couldn’t delete the goal. Please try again.</p>}
        </div>
      )}

      {goal.description && <div className="body">{goal.description}</div>}

      {!goal.achieved_on && targetsReached(goal.metrics) && (
        <div className="notice goal-reached" role="status">
          <span>🎉 You’ve reached {goal.metrics.filter((m) => m.target_value !== null).length > 1 ? 'all your targets' : 'your target'}!</span>
          <button className="btn primary small" disabled={saveGoal.isPending} onClick={() => setAchieved(dayKey(new Date()))}>
            ✓ Mark achieved
          </button>
        </div>
      )}

      <GoalMetrics goalId={goal.id} metrics={goal.metrics} />

      <section className="milestones">
        <div className="milestones-header">
          <h2>Milestones</h2>
          {!adding && (
            <button className="btn primary" onClick={() => setAdding(true)}>
              + Add milestone
            </button>
          )}
        </div>

        {adding && <MilestoneForm goalId={goal.id} metrics={goal.metrics} onDone={() => setAdding(false)} />}

        {milestones.length === 0 && !adding ? (
          <p className="muted">No milestones yet. Add the first step you’ve taken — or plan to.</p>
        ) : (
          <ol className="milestone-list">
            {milestones.map((m) => (
              <li key={m.id} className={`milestone ${m.occurred_on ? '' : 'undated'}`}>
                {editingId === m.id ? (
                  <MilestoneForm goalId={goal.id} metrics={goal.metrics} milestone={m} onDone={() => setEditingId(null)} />
                ) : (
                  <MilestoneCard milestone={m} metrics={goal.metrics} onEdit={() => setEditingId(m.id)} onOpenMedia={setOpenId} />
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {openIndex >= 0 && (
        <Lightbox items={media} index={openIndex} onIndexChange={(i) => setOpenId(media[i].id)} onClose={() => setOpenId(null)} />
      )}
    </article>
  )
}

/** Every metric with a target has reached it (and there's at least one). */
function targetsReached(metrics: Metric[]) {
  const targeted = metrics.filter((m) => m.target_value !== null)
  return targeted.length > 0 && targeted.every((m) => m.progress.reached)
}

function MilestoneCard({
  milestone,
  metrics,
  onEdit,
  onOpenMedia,
}: {
  milestone: Milestone
  metrics: Metric[]
  onEdit: () => void
  onOpenMedia: (id: string) => void
}) {
  const byId = new Map(metrics.map((m) => [m.id, m]))
  const deleteMilestone = useDeleteMilestone()
  const [confirming, setConfirming] = useState(false)
  const media = milestone.media
  return (
    <div className="card milestone-card">
      <div className="milestone-text">
        <span className="milestone-date">{milestone.occurred_on ? formatDay(milestone.occurred_on) : 'No date'}</span>
        <h3>{milestone.title}</h3>
        {milestone.description && <p className="milestone-desc">{milestone.description}</p>}
        {milestone.measurements.length > 0 && (
          <div className="milestone-readings">
            {milestone.measurements.map((r) => {
              const metric = byId.get(r.metric)
              return (
                metric && (
                  <span key={r.id} className="reading-chip">
                    {metric.name}: <strong>{formatValue(metric, r.value)}</strong>
                  </span>
                )
              )
            })}
          </div>
        )}
        {media && media.tags.length > 0 && <TagChips tags={media.tags} />}
        <div className="milestone-actions">
          <button className="btn ghost small" onClick={onEdit}>
            Edit
          </button>
          {confirming ? (
            <>
              <button
                className="btn danger small"
                disabled={deleteMilestone.isPending}
                onClick={() => deleteMilestone.mutate(milestone.id)}
              >
                Confirm delete
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
      {media && media.status !== 'failed' && (
        <button className="milestone-media" onClick={() => onOpenMedia(media.id)} aria-label="View milestone media">
          <MediaThumb asset={media} />
          {media.kind === 'video' && <span className="badge play">▶</span>}
          {media.status !== 'ready' && <span className="badge status">Processing…</span>}
        </button>
      )}
    </div>
  )
}

function MilestoneForm({
  goalId,
  metrics,
  milestone,
  onDone,
}: {
  goalId: string
  metrics: Metric[]
  milestone?: Milestone
  onDone: () => void
}) {
  // One optional value per metric, prefilled from what this milestone already recorded.
  const initialReadings = Object.fromEntries(
    metrics.map((m) => [m.id, milestone?.measurements.find((r) => r.metric === m.id)?.value ?? null]),
  )
  const [readings, setReadings] = useState<Record<string, number | null>>(initialReadings)
  const save = useSaveMilestone()
  const invalidate = useInvalidateJournal()
  const [title, setTitle] = useState(milestone?.title ?? '')
  const [description, setDescription] = useState(milestone?.description ?? '')
  const [occurredOn, setOccurredOn] = useState(milestone?.occurred_on ?? '')
  const [media, setMedia] = useState<MediaChoice>(NO_MEDIA_CHANGE)
  const [savedId, setSavedId] = useState(milestone?.id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setError(null), [title])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const saved = await save.mutateAsync({
        id: savedId,
        goalId,
        data: {
          title,
          description,
          occurred_on: occurredOn || null,
          // Send set values, and nulls only to clear values the milestone had.
          readings: metrics
            .filter((m) => readings[m.id] !== null || initialReadings[m.id] !== null)
            .map((m) => ({ metric: m.id, value: readings[m.id] })),
        },
      })
      setSavedId(saved.id)
      await applyMediaChoice(media, `/milestones/${saved.id}/media/`)
      await invalidate()
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="card milestone-form" onSubmit={onSubmit}>
      <label className="field">
        <span>Milestone</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ran my first 10k"
          maxLength={200}
          required
          autoFocus
        />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </label>
      <label className="field">
        <span>
          Date <span className="muted">(optional)</span>
        </span>
        <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
      </label>
      {metrics.length > 0 && (
        <div className="field">
          <span>
            Readings <span className="muted">(optional)</span>
          </span>
          <div className="milestone-reading-fields">
            {metrics.map((m) => (
              <label key={m.id} className="field">
                <span className="muted small">
                  {m.name}
                  {m.mode === 'total' && ' (adds to total)'}
                </span>
                <MetricValueInput metric={m} value={readings[m.id]} onChange={(v) => setReadings((r) => ({ ...r, [m.id]: v }))} />
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <span>
          Photo or video <span className="muted">(optional)</span>
        </span>
        <SingleMediaField
          current={milestone?.media}
          choice={media}
          onChange={setMedia}
          accept="image/*,video/*"
          label="photo or video"
          disabled={saving}
        />
      </div>
      {error && <p className="error pre">{error}</p>}
      <div className="btn-group">
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? 'Saving…' : milestone ? 'Save milestone' : 'Add milestone'}
        </button>
        <button type="button" className="btn ghost" onClick={onDone} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  )
}
