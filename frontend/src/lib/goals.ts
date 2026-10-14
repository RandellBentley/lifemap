import type { GoalMarker, GoalMarkerKind, MediaAsset } from '../api/types'

export const MARKER_ICON: Record<GoalMarkerKind, string> = {
  goal_start: '🎯',
  milestone: '🏁',
  goal_achieved: '🏆',
}

export const MARKER_LABEL: Record<GoalMarkerKind, string> = {
  goal_start: 'Goal started',
  milestone: 'Milestone',
  goal_achieved: 'Goal achieved',
}

/** "🏁 Half marathon — Run a marathon" style one-liner for tooltips. */
export function markerSummary(m: GoalMarker): string {
  return m.kind === 'milestone' ? `${MARKER_ICON[m.kind]} ${m.title} — ${m.goal.title}` : `${MARKER_ICON[m.kind]} ${MARKER_LABEL[m.kind]}: ${m.title}`
}

export const markerKey = (m: GoalMarker) => `${m.kind}:${m.milestone?.id ?? m.goal.id}`

/** Where a photo/video lives, for "View …" links. */
export function ownerLink(asset: MediaAsset): { to: string; label: string } {
  const o = asset.owner
  if (o.kind === 'entry') return { to: `/entries/${o.id}`, label: 'View entry' }
  return { to: `/goals/${o.goal_id}`, label: 'View goal' }
}
