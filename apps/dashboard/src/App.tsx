import { useCallback, useEffect, useState } from 'react'
import {
  createCampaign,
  fetchCampaigns,
  fetchStats,
  loadConfig,
  rotateCampaign,
  saveConfig,
} from './api'
import { CampaignTable } from './components/CampaignTable'
import { CreateCampaignModal } from './components/CreateCampaignModal'
import { StatsBar } from './components/StatsBar'
import type { Campaign, CreateCampaignInput, DashboardConfig, DashboardStats } from './types'

const STATS_POLL_MS = 10_000

export default function App() {
  const [config, setConfig] = useState<DashboardConfig>(() => loadConfig())
  const [configDraft, setConfigDraft] = useState<DashboardConfig>(() => loadConfig())
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [rotatingId, setRotatingId] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const refresh = useCallback(async (cfg: DashboardConfig) => {
    if (!cfg.apiKey.trim()) {
      setError('Set your DASHBOARD_API_KEY in the connection panel below.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [nextStats, campaignRes] = await Promise.all([
        fetchStats(cfg),
        fetchCampaigns(cfg),
      ])
      setStats(nextStats)
      setCampaigns(campaignRes.campaigns)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh(config)
    const timer = window.setInterval(() => void refresh(config), STATS_POLL_MS)
    return () => window.clearInterval(timer)
  }, [config, refresh])

  function applyConfig(): void {
    const next = {
      apiBase: configDraft.apiBase.trim(),
      apiKey: configDraft.apiKey.trim(),
    }
    saveConfig(next)
    setConfig(next)
  }

  async function handleCreate(input: CreateCampaignInput): Promise<void> {
    setCreating(true)
    setError(null)
    try {
      await createCampaign(config, input)
      setModalOpen(false)
      await refresh(config)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  async function handleRotate(id: string): Promise<void> {
    setRotatingId(id)
    setError(null)
    try {
      const result = await rotateCampaign(config, id)
      setCampaigns((prev) =>
        prev.map((c) => (c.id === id ? result.campaign : c)),
      )
      await refresh(config)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRotatingId(null)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Legion Campaign Dashboard</h1>
          <p>
            Mirror campaigns, rotation controls, and live settlement stats
            {lastRefresh ? ` · updated ${lastRefresh.toLocaleTimeString()}` : ''}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={loading}
          onClick={() => void refresh(config)}
        >
          {loading ? 'Refreshing…' : 'Refresh now'}
        </button>
      </header>

      <div className="panel config-panel">
        <label>
          API base URL
          <input
            value={configDraft.apiBase}
            onChange={(e) => setConfigDraft((c) => ({ ...c, apiBase: e.target.value }))}
            placeholder="https://your-api.railway.app (empty = same origin / Vite proxy)"
          />
        </label>
        <label>
          Dashboard API key
          <input
            type="password"
            value={configDraft.apiKey}
            onChange={(e) => setConfigDraft((c) => ({ ...c, apiKey: e.target.value }))}
            placeholder="DASHBOARD_API_KEY"
            autoComplete="off"
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={applyConfig} style={{ alignSelf: 'end' }}>
          Connect
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <StatsBar stats={stats} loading={loading} />

      <div className="toolbar">
        <h2>Campaigns ({campaigns.length})</h2>
        <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
          + New campaign
        </button>
      </div>

      <CampaignTable
        campaigns={campaigns}
        rotatingId={rotatingId}
        onRotate={(id) => void handleRotate(id)}
      />

      <CreateCampaignModal
        open={modalOpen}
        submitting={creating}
        onClose={() => setModalOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  )
}
