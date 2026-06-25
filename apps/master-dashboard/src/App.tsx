import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store/authStore'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Trading from './pages/Trading'
import Portfolio from './pages/Portfolio'
import Campaigns from './pages/Campaigns'
import Admin from './pages/Admin'
import Diagnostics from './pages/Diagnostics'
import LegionTool from './pages/LegionTool'
import Monitoring from './pages/Monitoring'
import Alerts from './pages/Alerts'
import Config from './pages/Config'
import Profile from './pages/Profile'

export default function App() {
  const { isAuthenticated } = useStore()

  return (
    <Router>
      {!isAuthenticated ? (
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      ) : (
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/trading" element={<Trading />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/diagnostics" element={<Diagnostics />} />
            <Route path="/legion-tool" element={<LegionTool />} />
            <Route path="/monitoring" element={<Monitoring />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/config" element={<Config />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      )}
    </Router>
  )
}
