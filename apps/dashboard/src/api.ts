import type {
  ApiEnvelope,
  Campaign,
  CreateCampaignInput,
  DashboardConfig,
  DashboardStats,
} from './types'

const CONFIG_KEY = 'legion-dashboard-config'

export function loadConfig(): DashboardConfig {
  const envBase = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DashboardConfig>
      return {
        apiBase: parsed.apiBase?.trim() || envBase,
        apiKey: parsed.apiKey?.trim() ?? '',
      }
    }
  } catch {
    /* ignore corrupt localStorage */
  }
  return { apiBase: envBase, apiKey: '' }
}

export function saveConfig(config: DashboardConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
}

async function request<T>(
  config: DashboardConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const base = config.apiBase.replace(/\/$/, '')
  const url = base ? `${base}${path}` : path
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  if (config.apiKey) {
    headers.set('X-API-Key', config.apiKey)
  }

  const res = await fetch(url, { ...init, headers })
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null

  if (!body) {
    throw new Error(`Invalid JSON response (${res.status})`)
  }
  if (!res.ok || body.success === false) {
    throw new Error(body.message || `Request failed (${res.status})`)
  }
  if (body.data == null) {
    throw new Error(body.message || 'Empty response data')
  }
  return body.data
}

export async function fetchStats(config: DashboardConfig): Promise<DashboardStats> {
  return request<DashboardStats>(config, '/api/v1/stats')
}

export async function fetchCampaigns(
  config: DashboardConfig,
): Promise<{ campaigns: Campaign[]; count: number }> {
  return request<{ campaigns: Campaign[]; count: number }>(config, '/api/v1/campaigns')
}

export async function createCampaign(
  config: DashboardConfig,
  input: CreateCampaignInput,
): Promise<Campaign> {
  return request<Campaign>(config, '/api/v1/campaigns', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function rotateCampaign(
  config: DashboardConfig,
  id: string,
): Promise<{ campaign: Campaign }> {
  return request<{ rotation: unknown; campaign: Campaign }>(
    config,
    `/api/v1/campaigns/${encodeURIComponent(id)}/rotate`,
    { method: 'POST', body: '{}' },
  )
}
