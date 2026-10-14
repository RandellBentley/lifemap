import { Navigate, Route, Routes } from 'react-router'
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
          <Route path="*" element={<p className="muted">Page not found.</p>} />
        </Routes>
      </Layout>
    </RequireAuth>
  )
}
