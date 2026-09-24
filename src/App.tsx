import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { ProjectDashboard } from './pages/ProjectDashboard'
import { SubmittalChecker } from './pages/SubmittalChecker'

export default function App() {
  return (
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/organization"
          element={
            <ProtectedRoute>
              <ProjectDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tools"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tools/submittal-checker"
          element={
            <ProtectedRoute>
              <SubmittalChecker />
            </ProtectedRoute>
          }
        />
        {/* Pre-reorg bookmark, kept as a redirect in case it's saved anywhere. */}
        <Route path="/home" element={<Navigate to="/organization" replace />} />
        <Route path="/" element={<Navigate to="/organization" replace />} />
        <Route path="*" element={<Navigate to="/organization" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
