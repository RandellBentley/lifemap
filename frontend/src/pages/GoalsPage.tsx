import { Link, useSearchParams } from 'react-router'
import { useGoals } from '../api/hooks'
import type { Goal } from '../api/types'
import { MediaThumb } from '../components/MediaGrid'
import { formatDay } from '../lib/format'
import { describeProgress } from '../lib/units'

type Filter = 'active' | 'achieved' | 'all'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'active', label: 'In progress' },
  { key: 'achieved', label: 'Achieved' },
  { key: 'all', label: 'All' },
]

export function GoalsPage() {
  const [params, setParams] = useSearchParams()
  const filter = (params.get('show') as Filter) ?? 'active'
  const { data: goals = [], isPending, isError } = useGoals()

  const counts = {
    active: goals.filter((g) => !g.achieved_on).length,
    achieved: goals.filter((g) => g.achieved_on).length,
    all: goals.length,
  }
  const shown = goals.filter((g) => filter === 'all' || (filter === 'achieved') === !!g.achieved_on)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Goals</h1>
        <Link to="/goals/new" className="btn primary">
          + New goal
        </Link>
      </div>

      {goals.length > 0 && (
        <div className="btn-group" role="tablist" aria-label="Show">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              className={`btn ${filter === key ? 'primary' : ''}`}
              onClick={() => setParams(key === 'active' ? {} : { show: key }, { replace: true })}
            >
              {label} <span className="count">{counts[key]}</span>
            </button>
          ))}
        </div>
      )}

      {isPending ? (
        <p className="muted">Loading…</p>
      ) : isError ? (
        <p className="error">Couldn’t load goals.</p>
      ) : goals.length === 0 ? (
        <div className="empty">
          <p>No goals yet. What are you working toward?</p>
          <Link to="/goals/new" className="btn primary">
            Set your first goal
          </Link>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted">{filter === 'achieved' ? 'Nothing achieved yet — keep going!' : 'No goals in progress.'}</p>
      ) : (
        <ul className="goal-grid">
          {shown.map((goal) => (
            <li key={goal.id}>
              <GoalCard goal={goal} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GoalCard({ goal }: { goal: Goal }) {
  return (
    <Link to={`/goals/${goal.id}`} className={`card goal-card ${goal.achieved_on ? 'achieved' : ''}`}>
      <div className="goal-card-photo">
        {goal.photo ? <MediaThumb asset={goal.photo} /> : <span aria-hidden>{goal.title.slice(0, 1).toUpperCase()}</span>}
        {goal.achieved_on && <span className="goal-achieved-badge">✓ Achieved</span>}
      </div>
      <div className="goal-card-body">
        <h2>{goal.title}</h2>
        {goal.description && <p className="goal-card-desc">{goal.description}</p>}
        <div className="goal-meta">
          {goal.starts_on && <span>Started {formatDay(goal.starts_on)}</span>}
          <span>
            {goal.milestone_count} {goal.milestone_count === 1 ? 'milestone' : 'milestones'}
          </span>
          {goal.achieved_on && <span>Achieved {formatDay(goal.achieved_on)}</span>}
        </div>
        {goal.metrics
          .filter((m) => m.progress.progress !== null)
          .slice(0, 2)
          .map((m) => (
            <div key={m.id} className="goal-card-metric">
              <span className="small">
                {m.name}: {describeProgress(m)}
              </span>
              <div className="progress small">
                <span style={{ width: `${(m.progress.progress ?? 0) * 100}%` }} />
              </div>
            </div>
          ))}
        {goal.reward && <div className="goal-reward">🏆 {goal.reward}</div>}
      </div>
    </Link>
  )
}
