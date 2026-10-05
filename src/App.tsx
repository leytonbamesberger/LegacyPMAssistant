import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ArchivePage } from './pages/ArchivePage'
import { ExportFlowReports } from './pages/ExportFlowReports'
import { FlowPage } from './pages/FlowPage'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { OverviewPage } from './pages/OverviewPage'
import { SubmittalChecker } from './pages/SubmittalChecker'
import { SHOW_TOOLS_TAB } from './lib/features'
import { TasksPage } from './pages/TasksPage'

export default function App() {
  return (
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/organization" element={<Navigate to="/organization/tasks" replace />} />

        {/* One layout route for every signed-in page, so the app shell and its data providers
            (and the first-load gate) mount once and persist across navigation. */}
        <Route element={<ProtectedRoute />}>
          <Route path="/organization/tasks" element={<TasksPage />} />
          <Route path="/organization/tasks/archive" element={<ArchivePage />} />
          <Route path="/organization/flow" element={<FlowPage />} />
          <Route path="/organization/overview" element={<OverviewPage />} />
          <Route path="/organization/export" element={<ExportFlowReports />} />
          {SHOW_TOOLS_TAB && <Route path="/tools" element={<Home />} />}
          {SHOW_TOOLS_TAB && <Route path="/tools/submittal-checker" element={<SubmittalChecker />} />}
        </Route>

        {/* Tools is hidden (see lib/features.ts): any /tools URL lands on Organization instead. */}
        {!SHOW_TOOLS_TAB && <Route path="/tools/*" element={<Navigate to="/organization/tasks" replace />} />}

        {/* Pre-reorg bookmark, kept as a redirect in case it's saved anywhere. */}
        <Route path="/home" element={<Navigate to="/organization/tasks" replace />} />
        <Route path="/" element={<Navigate to="/organization/tasks" replace />} />
        <Route path="*" element={<Navigate to="/organization/tasks" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
