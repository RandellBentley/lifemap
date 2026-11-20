// Shapes returned by the Django API (see backend/journal/serializers.py).

export interface User {
  id: number
  email: string
  display_name: string
}

export interface Tag {
  id: number
  name: string
  slug: string
  /** Entries matching directly or through their photos/videos. */
  entry_count: number
  media_count: number
}

export type MediaKind = 'image' | 'video'
export type MediaStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface MediaUrls {
  original: string | null
  thumb: string | null
  display: string | null
  poster: string | null
}

/** What a photo/video belongs to: a journal entry, a goal, or a goal's milestone. */
export type MediaOwner =
  | { kind: 'entry'; id: string }
  | { kind: 'goal'; id: string; title: string; goal_id: string; date: string | null }
  | { kind: 'milestone'; id: string; title: string; goal_id: string; goal_title: string; date: string | null }
  | { kind: 'workout_set'; id: string; workout_id: string; title: string; date: string }
  | { kind: 'progress_report'; id: string; date: string }
  | { kind: 'personal_record'; id: string; title: string; date: string }

export interface MediaAsset {
  id: string
  /** Null for goal and milestone photos, which don't belong to a journal entry. */
  entry: string | null
  entry_occurred_at: string | null
  owner: MediaOwner
  kind: MediaKind
  status: MediaStatus
  content_type: string
  original_filename: string
  width: number | null
  height: number | null
  duration_seconds: number | null
  taken_at: string | null
  tags: string[]
  urls: MediaUrls
  created_at: string
}

/** Enough of an event to label entries and draw its span. ends_on is null while ongoing. */
export interface EventSummary {
  id: string
  title: string
  starts_on: string
  ends_on: string | null
}

export interface JournalEvent extends EventSummary {
  description: string
  timezone: string
  tags: string[]
  cover: string | null
  cover_urls: MediaUrls | null
  entry_count: number
  media_count: number
  created_at: string
  updated_at: string
}

export interface EventInput {
  title: string
  description: string
  starts_on: string
  ends_on: string | null
  timezone: string
  tags: string[]
  cover?: string | null
}

export interface Entry {
  id: string
  title: string
  body: string
  occurred_at: string
  timezone: string
  occurred_on: string
  tags: string[]
  media: MediaAsset[]
  event: string | null
  event_summary: EventSummary | null
  created_at: string
  updated_at: string
}

export interface EntryInput {
  title: string
  body: string
  occurred_at: string
  timezone: string
  tags: string[]
  event?: string | null
}

export interface Page<T> {
  next: string | null
  previous: string | null
  results: T[]
}

export interface CalendarDay {
  date: string
  entry_count: number
  media_count: number
  cover_thumb: string | null
}

export interface CalendarMonth {
  month: string
  days: CalendarDay[]
  events: EventSummary[]
  goal_markers: GoalMarker[]
}

export interface UploadTicket {
  asset: MediaAsset
  upload: { url: string; fields: Record<string, string> }
}

export interface WindowSlice {
  /** Oldest -> newest. */
  results: Entry[]
  has_more: boolean
}

export interface TimelineSummary {
  first: string | null
  last: string | null
  months: { month: string; count: number }[]
}

export interface Goal {
  id: string
  title: string
  description: string
  starts_on: string | null
  reward: string
  /** Null while the goal is in progress. */
  achieved_on: string | null
  photo: MediaAsset | null
  milestone_count: number
  metrics: Metric[]
  created_at: string
  updated_at: string
}

export type MetricKind = 'count' | 'weight' | 'distance' | 'duration' | 'money' | 'percent'
export type MetricMode = 'latest' | 'total'

/** All values are in the metric's display unit. */
export interface MetricProgress {
  current: number | null
  start: number | null
  target: number | null
  change: number | null
  direction: 'up' | 'down'
  /** Share of the way from start to target, 0..1; null without a target or readings. */
  progress: number | null
  reached: boolean | null
  count: number
  last_recorded_on: string | null
}

export interface Metric {
  id: string
  goal: string
  name: string
  kind: MetricKind
  unit: string
  mode: MetricMode
  start_value: number | null
  target_value: number | null
  position: number
  progress: MetricProgress
  created_at: string
}

export interface MetricInput {
  name: string
  kind: MetricKind
  unit: string
  mode: MetricMode
  start_value: number | null
  target_value: number | null
}

export interface Measurement {
  id: string
  metric: string
  value: number
  recorded_on: string
  note: string
  milestone: { id: string; title: string } | null
  created_at: string
}

export interface MeasurementInput {
  value: number
  recorded_on: string
  note: string
}

export interface GoalInput {
  title: string
  description: string
  starts_on: string | null
  reward: string
  achieved_on?: string | null
}

export interface Milestone {
  id: string
  goal: string
  title: string
  description: string
  occurred_on: string | null
  media: MediaAsset | null
  measurements: { id: string; metric: string; value: number }[]
  created_at: string
  updated_at: string
}

export interface MilestoneInput {
  title: string
  description: string
  occurred_on: string | null
  /** Values in each metric's display unit; null clears the milestone's value for that metric. */
  readings?: { metric: string; value: number | null }[]
}

export type GoalMarkerKind = 'goal_start' | 'milestone' | 'goal_achieved'

/** A goal's start, a dated milestone, or an achievement, placed on a day. */
export interface GoalMarker {
  kind: GoalMarkerKind
  date: string
  title: string
  goal: { id: string; title: string }
  milestone: { id: string } | null
  thumb: string | null
  reward?: string
}

/** Per-environment switches (GET /api/config/). Mirrors KNOWN_FEATURES in backend settings. */
export type Feature = 'workouts'

export interface AppConfig {
  features: Feature[]
}

// --- Workouts (personal site only; behind the `workouts` feature flag) -------------------

export interface Exercise {
  id: string
  name: string
  use_count: number
  created_at: string
}

/** Weights are always kilograms over the API; the UI shows kg or lb. */
export interface WorkoutSet {
  id: string
  reps: number
  weight_kg: number | null
  made: boolean // false = a missed lift
  video: MediaAsset | null
}

export interface WorkoutExercise {
  id: string
  exercise: string
  exercise_name: string
  sets: WorkoutSet[]
}

/** One point on a lift's progress chart: that workout's heaviest made set. */
export interface LiftPoint {
  workout_id: string
  date: string
  weight_kg: number
  reps: number
}

export const REP_TARGETS = [1, 2, 3, 5] as const
export type RepTarget = (typeof REP_TARGETS)[number]

/** A PR you log yourself; `exercise` is from the same library as workouts. */
export interface PersonalRecord {
  id: string
  exercise: string
  exercise_name: string
  reps: RepTarget
  weight_kg: number
  achieved_on: string
  video: MediaAsset | null
  created_at: string
  updated_at: string
}

export interface PersonalRecordInput {
  exercise: string
  reps: RepTarget
  weight_kg: number
  achieved_on: string
}

/**
 * One line of the PR board: a logged PR, or a workout set that beat the best so far, for one
 * rep target. A set counts toward every target up to its reps, so one set can give several rows.
 */
export interface PRRow {
  key: string
  source: 'logged' | 'workout'
  source_id: string // the PersonalRecord or WorkoutSet id
  workout_id: string | null
  exercise: string
  exercise_name: string
  reps: RepTarget
  set_reps: number // e.g. a 3-rep PR from a set of 5
  weight_kg: number
  achieved_on: string
  video: MediaAsset | null
}

/** A workout's optional physique update (stored as a progress report dated the workout's day). */
export interface Physique {
  id: string
  body_weight_kg: number | null
  photos: MediaAsset[]
}

export interface Workout {
  id: string
  performed_on: string
  notes: string
  exercises: WorkoutExercise[]
  physique: Physique | null
  created_at: string
  updated_at: string
}

/** Nested write: ids keep existing exercises/sets (and their videos); omit them for new ones.
 * `physique`: omit to keep it as is, null to delete it (and its photos). */
export interface WorkoutInput {
  performed_on: string
  notes: string
  exercises: { id?: string; exercise: string; sets: { id?: string; reps: number; weight_kg: number | null; made: boolean }[] }[]
  physique?: { body_weight_kg: number | null } | null
}

export interface ProgressReport {
  id: string
  recorded_on: string
  body_weight_kg: number | null
  notes: string
  photos: MediaAsset[]
  workout: string | null // set when it's part of a workout, which then owns its date
  created_at: string
  updated_at: string
}

export interface ProgressReportInput {
  recorded_on: string
  body_weight_kg: number | null
  notes: string
}
