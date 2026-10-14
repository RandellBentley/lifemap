import { useState, type FormEvent } from 'react'
import { format } from 'date-fns'
import { errorMessage } from '../api/client'
import { useDeleteMeasurement, useDeleteMetric, useMeasurements, useSaveMeasurement, useSaveMetric } from '../api/hooks'
import type { Measurement, Metric, MetricKind, MetricMode } from '../api/types'
import { dayKey, parseDay } from '../lib/dates'
import { DEFAULT_UNIT, KINDS, UNIT_LABEL, convertUnit, describeProgress, formatValue } from '../lib/units'
import { MetricChart } from './MetricChart'
import { MetricValueInput } from './MetricValueInput'

/** The goal page's metrics: progress per metric, logging readings, and editing metrics. */
export function GoalMetrics({ goalId, metrics }: { goalId: string; metrics: Metric[] }) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <section className="metrics">
      <div className="milestones-header">
        <h2>Metrics</h2>
        {!adding && (
          <button className="btn" onClick={() => setAdding(true)}>
            + Track a metric
          </button>
        )}
      </div>
      {adding && <MetricForm goalId={goalId} onDone={() => setAdding(false)} />}
      {metrics.length === 0 && !adding && (
        <p className="muted small">
          Measure progress in pounds, dollars, hours, sessions — whatever fits this goal.
        </p>
      )}
      {metrics.map((metric) =>
        editingId === metric.id ? (
          <MetricForm key={metric.id} goalId={goalId} metric={metric} onDone={() => setEditingId(null)} />
        ) : (
          <MetricCard key={metric.id} metric={metric} onEdit={() => setEditingId(metric.id)} />
        ),
      )}
    </section>
  )
}

function MetricCard({ metric, onEdit }: { metric: Metric; onEdit: () => void }) {
  const [logging, setLogging] = useState(false)
  const [showReadings, setShowReadings] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const deleteMetric = useDeleteMetric()
  const p = metric.progress
  const kindLabel = KINDS.find((k) => k.kind === metric.kind)?.label ?? metric.kind

  return (
    <div className={`card metric-card ${p.reached ? 'reached' : ''}`}>
      <div className="metric-head">
        <div>
          <h3>
            {metric.name}
            {p.reached && <span className="metric-reached"> ✓ Target reached</span>}
          </h3>
          <span className="muted small">
            {kindLabel} · {metric.mode === 'latest' ? 'latest reading' : 'running total'}
            {metric.target_value !== null && ` · target ${formatValue(metric, metric.target_value)}`}
          </span>
        </div>
        <div className="btn-group">
          {!logging && (
            <button className="btn primary small" onClick={() => setLogging(true)}>
              + Log a reading
            </button>
          )}
          <button className="btn ghost small" onClick={onEdit}>
            Edit
          </button>
          {confirmingDelete ? (
            <>
              <button className="btn danger small" disabled={deleteMetric.isPending} onClick={() => deleteMetric.mutate(metric.id)}>
                Delete metric & {p.count} readings
              </button>
              <button className="btn ghost small" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn ghost small" onClick={() => setConfirmingDelete(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      <p className="metric-summary">{describeProgress(metric)}</p>
      {p.progress !== null && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.progress * 100)}>
          <span style={{ width: `${p.progress * 100}%` }} />
        </div>
      )}

      <MetricChartSection metric={metric} />

      {logging && <ReadingForm metric={metric} onDone={() => setLogging(false)} />}

      {p.count > 0 && (
        <button className="link-button small" onClick={() => setShowReadings((v) => !v)} aria-expanded={showReadings}>
          {showReadings ? 'Hide' : 'Show'} {p.count} {p.count === 1 ? 'reading' : 'readings'}
          {p.last_recorded_on && !showReadings && ` · last ${format(parseDay(p.last_recorded_on), 'MMM d')}`}
        </button>
      )}
      {showReadings && <ReadingsList metric={metric} />}
    </div>
  )
}

function MetricChartSection({ metric }: { metric: Metric }) {
  const { data: readings, isPending } = useMeasurements(metric.id)
  if (isPending || !readings) return <div className="chart-empty muted small">Loading chart…</div>
  return <MetricChart metric={metric} readings={readings} />
}

function ReadingsList({ metric }: { metric: Metric }) {
  const { data: readings = [], isPending } = useMeasurements(metric.id)
  const [editingId, setEditingId] = useState<string | null>(null)
  if (isPending) return <p className="muted small">Loading…</p>
  return (
    <ul className="readings">
      {[...readings].reverse().map((r) =>
        editingId === r.id ? (
          <li key={r.id}>
            <ReadingForm metric={metric} reading={r} onDone={() => setEditingId(null)} />
          </li>
        ) : (
          <ReadingRow key={r.id} metric={metric} reading={r} onEdit={() => setEditingId(r.id)} />
        ),
      )}
    </ul>
  )
}

function ReadingRow({ metric, reading, onEdit }: { metric: Metric; reading: Measurement; onEdit: () => void }) {
  const remove = useDeleteMeasurement()
  return (
    <li className="reading">
      <span className="reading-date">{format(parseDay(reading.recorded_on), 'MMM d, yyyy')}</span>
      <strong>{formatValue(metric, reading.value)}</strong>
      {reading.milestone && <span className="reading-milestone">🏁 {reading.milestone.title}</span>}
      {reading.note && <span className="muted small">{reading.note}</span>}
      <span className="spacer" />
      <button className="btn ghost small" onClick={onEdit}>
        Edit
      </button>
      <button className="btn ghost small" disabled={remove.isPending} onClick={() => remove.mutate(reading.id)}>
        Delete
      </button>
    </li>
  )
}

function ReadingForm({ metric, reading, onDone }: { metric: Metric; reading?: Measurement; onDone: () => void }) {
  const save = useSaveMeasurement()
  const [value, setValue] = useState<number | null>(reading?.value ?? null)
  const [recordedOn, setRecordedOn] = useState(reading?.recorded_on ?? dayKey(new Date()))
  const [note, setNote] = useState(reading?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (value === null) return
    try {
      await save.mutateAsync({ id: reading?.id, metricId: metric.id, data: { value, recorded_on: recordedOn, note } })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form className="reading-form" onSubmit={onSubmit}>
      <label className="field">
        <span>{metric.mode === 'total' ? 'Amount to add' : 'Reading'}</span>
        <MetricValueInput metric={metric} value={value} onChange={setValue} />
      </label>
      <label className="field">
        <span>Date</span>
        <input type="date" value={recordedOn} onChange={(e) => setRecordedOn(e.target.value)} required />
      </label>
      <label className="field grow">
        <span>
          Note <span className="muted">(optional)</span>
        </span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </label>
      <div className="btn-group">
        <button type="submit" className="btn primary small" disabled={save.isPending || value === null}>
          {reading ? 'Save' : 'Log it'}
        </button>
        <button type="button" className="btn ghost small" onClick={onDone}>
          Cancel
        </button>
      </div>
      {error && <p className="error small pre">{error}</p>}
    </form>
  )
}

function MetricForm({ goalId, metric, onDone }: { goalId: string; metric?: Metric; onDone: () => void }) {
  const save = useSaveMetric()
  const [name, setName] = useState(metric?.name ?? '')
  const [kind, setKind] = useState<MetricKind>(metric?.kind ?? 'weight')
  const [unit, setUnit] = useState(metric?.unit ?? DEFAULT_UNIT.weight)
  const [mode, setMode] = useState<MetricMode>(metric?.mode ?? 'latest')
  const [start, setStart] = useState<number | null>(metric?.start_value ?? null)
  const [target, setTarget] = useState<number | null>(metric?.target_value ?? null)
  const [error, setError] = useState<string | null>(null)
  const kindLocked = !!metric && metric.progress.count > 0
  const kindInfo = KINDS.find((k) => k.kind === kind)!

  const changeKind = (next: MetricKind) => {
    setKind(next)
    setUnit(next === 'count' ? '' : DEFAULT_UNIT[next])
    // Sensible default: things you add up are totals; levels you check are latest readings.
    setMode(next === 'count' || next === 'duration' ? 'total' : 'latest')
  }

  // The start/target boxes show values in the selected unit, so switching lb -> kg must
  // convert them; otherwise "180" would be saved as 180 kg.
  const changeUnit = (next: string) => {
    setStart((v) => convertUnit(v, unit, next))
    setTarget((v) => convertUnit(v, unit, next))
    setUnit(next)
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await save.mutateAsync({
        id: metric?.id,
        goalId,
        data: { name, kind, unit, mode, start_value: start, target_value: target },
      })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form className="card metric-form" onSubmit={onSubmit}>
      <div className="field-row">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weight, Debt balance, Study sessions…" maxLength={100} required autoFocus />
        </label>
        <label className="field">
          <span>Kind</span>
          <select value={kind} onChange={(e) => changeKind(e.target.value as MetricKind)} disabled={kindLocked}>
            {KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label} — {k.hint}
              </option>
            ))}
          </select>
          {kindLocked && <span className="muted small">Kind can’t change once there are readings.</span>}
        </label>
        <label className="field">
          <span>{kind === 'count' ? 'What are you counting?' : kind === 'money' ? 'Currency' : 'Unit'}</span>
          {kindInfo.units ? (
            <select value={unit} onChange={(e) => changeUnit(e.target.value)}>
              {kindInfo.units.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u] ?? u}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={unit}
              onChange={(e) => setUnit(kind === 'money' ? e.target.value.toUpperCase() : e.target.value)}
              placeholder={kind === 'money' ? 'USD' : 'study sessions'}
              maxLength={kind === 'money' ? 3 : 32}
              required
            />
          )}
        </label>
      </div>

      <fieldset className="field mode-choice">
        <span>Measure progress by</span>
        <label className="checkbox">
          <input type="radio" name="mode" checked={mode === 'latest'} onChange={() => setMode('latest')} />
          <span>
            <strong>Latest reading</strong> <span className="muted small">— where it stands now (weight, a balance)</span>
          </span>
        </label>
        <label className="checkbox">
          <input type="radio" name="mode" checked={mode === 'total'} onChange={() => setMode('total')} />
          <span>
            <strong>Running total</strong> <span className="muted small">— readings add up (sessions, hours, payments)</span>
          </span>
        </label>
      </fieldset>

      <div className="field-row">
        <label className="field">
          <span>
            {mode === 'total' ? 'Already done' : 'Starting value'} <span className="muted">(optional)</span>
          </span>
          <MetricValueInput metric={{ kind, unit }} value={start} onChange={setStart} placeholder={mode === 'latest' ? 'first reading' : '0'} />
        </label>
        <label className="field">
          <span>
            Target <span className="muted">(optional)</span>
          </span>
          <MetricValueInput metric={{ kind, unit }} value={target} onChange={setTarget} />
        </label>
      </div>

      {error && <p className="error small pre">{error}</p>}
      <div className="btn-group">
        <button type="submit" className="btn primary" disabled={save.isPending}>
          {metric ? 'Save metric' : 'Add metric'}
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}
