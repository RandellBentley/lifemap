import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, cursorQuery } from './client'
import type {
  CalendarMonth,
  Entry,
  EntryInput,
  EventInput,
  Goal,
  GoalInput,
  GoalMarker,
  JournalEvent,
  Measurement,
  MeasurementInput,
  MediaAsset,
  Metric,
  MetricInput,
  Milestone,
  MilestoneInput,
  Page,
  Tag,
  TimelineSummary,
  User,
  WindowSlice,
} from './types'

/**
 * Thumbnails are generated asynchronously after upload, so poll while anything shown is
 * still pending/processing, and stop once it's all ready.
 */
const PROCESSING_POLL_MS = 3000
const isProcessing = (m: MediaAsset) => m.status === 'pending' || m.status === 'processing'
const pollWhile = (busy: boolean) => (busy ? PROCESSING_POLL_MS : false)

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<User | null> => {
      try {
        return await api<User>('/auth/me/')
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null
        throw err
      }
    },
    staleTime: 5 * 60_000,
  })
}

export async function logout() {
  const { redirect_url } = await api<{ redirect_url: string }>('/auth/logout/', { method: 'POST' })
  window.location.assign(redirect_url)
}

export interface EntryFilters {
  tag?: string
  q?: string
  date?: string
}

function filterQuery(filters: EntryFilters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  return params.toString()
}

/** Cursor-paginated entries, newest first. Feeds both the timeline and day views. */
export function useEntries(filters: EntryFilters) {
  return useInfiniteQuery({
    queryKey: ['entries', filters],
    queryFn: ({ pageParam }) => api<Page<Entry>>(`/entries/?${pageParam ?? filterQuery(filters)}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => cursorQuery(last.next),
    refetchInterval: (q) =>
      pollWhile(!!q.state.data?.pages.some((p) => p.results.some((e) => e.media.some(isProcessing)))),
  })
}

interface TimelineCursor {
  at: string
  id?: string
}

type WindowParam = { before?: TimelineCursor; after?: TimelineCursor }

export interface TimelinePage {
  results: Entry[]
  hasOlder: boolean
  hasNewer: boolean
}

/**
 * Bidirectional slice of the timeline around `anchor` (an ISO instant; null = latest).
 * Pages are ordered oldest -> newest: fetchPreviousPage loads older entries (left),
 * fetchNextPage loads newer ones (right).
 */
export function useTimelineWindow(filters: EntryFilters, anchor: string | null) {
  return useInfiniteQuery({
    queryKey: ['entries', 'window', filters, anchor],
    initialPageParam: (anchor ? { before: { at: anchor } } : {}) as WindowParam,
    queryFn: async ({ pageParam }): Promise<TimelinePage> => {
      const params = new URLSearchParams(filterQuery(filters))
      params.set('limit', '30')
      const dir = pageParam.after ? 'after' : 'before'
      const cursor = pageParam.after ?? pageParam.before
      if (cursor) {
        params.set(dir, cursor.at)
        if (cursor.id) params.set(`${dir}_id`, cursor.id)
      }
      const slice = await api<WindowSlice>(`/entries/window/?${params}`)
      const isInitial = !pageParam.after && (!pageParam.before || !pageParam.before.id)
      return {
        results: slice.results,
        hasOlder: dir === 'before' ? slice.has_more : true,
        // The first slice ends at the anchor; whatever comes after it is still unknown.
        hasNewer: dir === 'after' ? slice.has_more : isInitial && anchor !== null,
      }
    },
    getPreviousPageParam: (first) =>
      first.hasOlder && first.results.length
        ? { before: { at: first.results[0].occurred_at, id: first.results[0].id } }
        : undefined,
    getNextPageParam: (last, pages) => {
      if (!last.hasNewer) return undefined
      const newest = pages.flatMap((p) => p.results).at(-1)
      return { after: newest ? { at: newest.occurred_at, id: newest.id } : { at: anchor! } }
    },
    refetchInterval: (q) =>
      pollWhile(!!q.state.data?.pages.some((p) => p.results.some((e) => e.media.some(isProcessing)))),
  })
}

export interface MediaFilters {
  tag?: string
  kind?: 'image' | 'video'
}

/** Every photo/video across entries, newest event first (Photos page). */
export function useMediaList(filters: MediaFilters) {
  return useInfiniteQuery({
    queryKey: ['entries', 'media', filters],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (filters.tag) params.set('tag', filters.tag)
      if (filters.kind) params.set('kind', filters.kind)
      return api<Page<MediaAsset>>(`/media/?${pageParam ?? params}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => cursorQuery(last.next),
    refetchInterval: (q) => pollWhile(!!q.state.data?.pages.some((p) => p.results.some(isProcessing))),
  })
}

export function useTimelineSummary(filters: EntryFilters = {}) {
  return useQuery({
    queryKey: ['entries', 'summary', filters],
    queryFn: () => api<TimelineSummary>(`/entries/summary/?${filterQuery(filters)}`),
  })
}

export function useEntry(id: string | undefined) {
  return useQuery({
    queryKey: ['entry', id],
    queryFn: () => api<Entry>(`/entries/${id}/`),
    enabled: !!id,
    refetchInterval: (q) => pollWhile(!!q.state.data?.media.some(isProcessing)),
  })
}

export function useCalendar(month: string) {
  return useQuery({
    queryKey: ['calendar', month],
    queryFn: () => api<CalendarMonth>(`/calendar/?month=${month}`),
    placeholderData: (prev) => prev,
  })
}

export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: () => api<Tag[]>('/tags/') })
}

const JOURNAL_KEYS = ['entries', 'entry', 'calendar', 'tags', 'events', 'event', 'goals', 'goal']

/**
 * Anything that changes entries or media can affect every list view.
 * `passive` keys are only marked stale, not refetched: after a delete, refetching the
 * detail view you're on would 404 and swap the page out before it can navigate away.
 */
export function useInvalidateJournal() {
  const qc = useQueryClient()
  return ({ passive = [] }: { passive?: string[] } = {}) =>
    Promise.all(
      JOURNAL_KEYS.map((key) =>
        qc.invalidateQueries({ queryKey: [key], refetchType: passive.includes(key) ? 'none' : 'active' }),
      ),
    )
}

export function useSaveEntry() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: EntryInput }) =>
      id
        ? api<Entry>(`/entries/${id}/`, { method: 'PATCH', json: data })
        : api<Entry>('/entries/', { method: 'POST', json: data }),
    onSuccess: () => invalidate(),
  })
}

export function useDeleteEntry() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/entries/${id}/`, { method: 'DELETE' }),
    onSuccess: () => invalidate({ passive: ['entry'] }),
  })
}

export function useDeleteMedia() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/media/${id}/`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
  })
}

/** Move a photo/video to another of your entries (e.g. another day of an event). */
export function useMoveMedia() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: ({ id, entry }: { id: string; entry: string }) =>
      api<MediaAsset>(`/media/${id}/`, { method: 'PATCH', json: { entry } }),
    onSuccess: () => invalidate(),
  })
}

export function useUpdateMediaTags() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: ({ id, tags }: { id: string; tags: string[] }) =>
      api<MediaAsset>(`/media/${id}/`, { method: 'PATCH', json: { tags } }),
    onSuccess: () => invalidate(),
  })
}

// --- Events ------------------------------------------------------------------------

export interface EventFilters {
  start?: string
  end?: string
  q?: string
}

/** Events overlapping an optional date range, newest first. */
export function useEvents(filters: EventFilters = {}) {
  return useQuery({
    queryKey: ['events', filters],
    queryFn: () => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
      return api<JournalEvent[]>(`/events/?${params}`)
    },
  })
}

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: ['event', id],
    queryFn: () => api<JournalEvent>(`/events/${id}/`),
    enabled: !!id,
  })
}

/** The event's day entries, oldest first. */
export function useEventEntries(id: string | undefined) {
  return useQuery({
    queryKey: ['event', id, 'entries'],
    queryFn: () => api<Entry[]>(`/events/${id}/entries/`),
    enabled: !!id,
    refetchInterval: (q) => pollWhile(!!q.state.data?.some((e) => e.media.some(isProcessing))),
  })
}

export function useSaveEvent() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: Partial<EventInput> }) =>
      id
        ? api<JournalEvent>(`/events/${id}/`, { method: 'PATCH', json: data })
        : api<JournalEvent>('/events/', { method: 'POST', json: data }),
    onSuccess: () => invalidate(),
  })
}

export function useDeleteEvent() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: ({ id, withEntries }: { id: string; withEntries: boolean }) =>
      api<void>(`/events/${id}/${withEntries ? '?with_entries=true' : ''}`, { method: 'DELETE' }),
    onSuccess: () => invalidate({ passive: ['event'] }),
  })
}

// --- Goals ----------------------------------------------------------------------------

const mediaBusy = (m: MediaAsset | null | undefined) => !!m && isProcessing(m)

export function useGoals() {
  return useQuery({
    queryKey: ['goals'],
    queryFn: () => api<Goal[]>('/goals/'),
    refetchInterval: (q) => pollWhile(!!q.state.data?.some((g) => mediaBusy(g.photo))),
  })
}

export function useGoal(id: string | undefined) {
  return useQuery({
    queryKey: ['goal', id],
    queryFn: () => api<Goal>(`/goals/${id}/`),
    enabled: !!id,
    refetchInterval: (q) => pollWhile(mediaBusy(q.state.data?.photo)),
  })
}

/** Dated milestones in order, then undated ones. */
export function useMilestones(goalId: string | undefined) {
  return useQuery({
    queryKey: ['goal', goalId, 'milestones'],
    queryFn: () => api<Milestone[]>(`/goals/${goalId}/milestones/`),
    enabled: !!goalId,
    refetchInterval: (q) => pollWhile(!!q.state.data?.some((m) => mediaBusy(m.media))),
  })
}

export function useSaveGoal() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: Partial<GoalInput> }) =>
      id ? api<Goal>(`/goals/${id}/`, { method: 'PATCH', json: data }) : api<Goal>('/goals/', { method: 'POST', json: data }),
    onSuccess: () => invalidate(),
  })
}

export function useDeleteGoal() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/goals/${id}/`, { method: 'DELETE' }),
    onSuccess: () => invalidate({ passive: ['goal'] }),
  })
}

export function useSaveMilestone() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: ({ id, goalId, data }: { id?: string; goalId: string; data: MilestoneInput }) =>
      id
        ? api<Milestone>(`/milestones/${id}/`, { method: 'PATCH', json: data })
        : api<Milestone>(`/goals/${goalId}/milestones/`, { method: 'POST', json: data }),
    onSuccess: () => invalidate(),
  })
}

export function useDeleteMilestone() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/milestones/${id}/`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
  })
}

/** Remove the photo of a goal (`/goals/{id}/photo/`) or milestone (`/milestones/{id}/media/`). */
export async function removeSingleMedia(path: string) {
  await api<void>(path, { method: 'DELETE' })
}

/** Goal starts, dated milestones and achievements, for the timeline and day view. */
export function useGoalMarkers(filters: { tag?: string; q?: string } = {}) {
  return useQuery({
    queryKey: ['goals', 'markers', filters],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters.tag) params.set('tag', filters.tag)
      if (filters.q) params.set('q', filters.q)
      return api<GoalMarker[]>(`/goals/markers/?${params}`)
    },
  })
}

// --- Goal metrics -----------------------------------------------------------------------

export function useSaveMetric() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: ({ id, goalId, data }: { id?: string; goalId: string; data: Partial<MetricInput> }) =>
      id
        ? api<Metric>(`/metrics/${id}/`, { method: 'PATCH', json: data })
        : api<Metric>(`/goals/${goalId}/metrics/`, { method: 'POST', json: data }),
    onSuccess: () => invalidate(),
  })
}

export function useDeleteMetric() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/metrics/${id}/`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
  })
}

/** A metric's readings, oldest first. */
export function useMeasurements(metricId: string | undefined) {
  return useQuery({
    queryKey: ['goal', 'measurements', metricId],
    queryFn: () => api<Measurement[]>(`/metrics/${metricId}/measurements/`),
    enabled: !!metricId,
  })
}

export function useSaveMeasurement() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: ({ id, metricId, data }: { id?: string; metricId: string; data: Partial<MeasurementInput> }) =>
      id
        ? api<Measurement>(`/measurements/${id}/`, { method: 'PATCH', json: data })
        : api<Measurement>(`/metrics/${metricId}/measurements/`, { method: 'POST', json: data }),
    onSuccess: () => invalidate(),
  })
}

export function useDeleteMeasurement() {
  const invalidate = useInvalidateJournal()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/measurements/${id}/`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
  })
}
