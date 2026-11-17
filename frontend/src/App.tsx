import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { FeatureGate } from './components/FeatureGate'
import { Layout } from './components/Layout'
import { RequireAuth } from './components/RequireAuth'
import { CalendarPage } from './pages/CalendarPage'
import { DayPage } from './pages/DayPage'
import { EntryEditorPage } from './pages/EntryEditorPage'
import { EntryPage } from './pages/EntryPage'
import { EventEditorPage } from './pages/EventEditorPage'
import { EventPage } from './pages/EventPage'
import { GoalDetailPage } from './pages/GoalDetailPage'
import { GoalEditorPage } from './pages/GoalEditorPage'
import { GoalsPage } from './pages/GoalsPage'
import { PhotosPage } from './pages/PhotosPage'
import { TimelinePage } from './pages/TimelinePage'

export default function App() {
  return (
    <RequireAuth>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/timeline" replace />} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/photos" element={<PhotosPage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/goals/new" element={<GoalEditorPage />} />
          <Route path="/goals/:id" element={<GoalDetailPage />} />
          <Route path="/goals/:id/edit" element={<GoalEditorPage />} />
          <Route path="/day/:date" element={<DayPage />} />
          <Route path="/entries/new" element={<EntryEditorPage />} />
          <Route path="/entries/:id" element={<EntryPage />} />
          <Route path="/entries/:id/edit" element={<EntryEditorPage />} />
          <Route path="/events/new" element={<EventEditorPage />} />
          <Route path="/events/:id" element={<EventPage />} />
          <Route path="/events/:id/edit" element={<EventEditorPage />} />
          <Route path="/workouts" element={<Workouts page={<WorkoutsPage />} />} />
          <Route path="/workouts/physique" element={<Workouts page={<WorkoutsPage />} />} />
          <Route path="/workouts/physique/new" element={<Workouts page={<ProgressEditorPage />} />} />
          <Route path="/workouts/physique/:id/edit" element={<Workouts page={<ProgressEditorPage />} />} />
          <Route path="/workouts/new" element={<Workouts page={<WorkoutEditorPage />} />} />
          <Route path="/workouts/:id" element={<Workouts page={<WorkoutPage />} />} />
          <Route path="/workouts/:id/edit" element={<Workouts page={<WorkoutEditorPage />} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </RequireAuth>
  )
}

// Workout pages load on demand: environments without the feature (the demo) never download them.
const WorkoutsPage = lazy(() => import('./pages/WorkoutsPage').then((m) => ({ default: m.WorkoutsPage })))
const WorkoutPage = lazy(() => import('./pages/WorkoutPage').then((m) => ({ default: m.WorkoutPage })))
const WorkoutEditorPage = lazy(() => import('./pages/WorkoutEditorPage').then((m) => ({ default: m.WorkoutEditorPage })))
const ProgressEditorPage = lazy(() => import('./pages/ProgressEditorPage').then((m) => ({ default: m.ProgressEditorPage })))

const NotFound = () => <p className="muted">Page not found.</p>

/** Workout pages exist only where the `workouts` feature is on (the personal site, not the demo). */
function Workouts({ page }: { page: ReactNode }) {
  return (
    <FeatureGate feature="workouts" fallback={<NotFound />} loading={<p className="muted">Loading…</p>}>
      <Suspense fallback={<p className="muted">Loading…</p>}>{page}</Suspense>
    </FeatureGate>
  )
}
