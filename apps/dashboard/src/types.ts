export type ApiEnvelope<T> = {
  success: boolean
  message: string
  data: T | null
}

export type DashboardStats = {
  total_settled_usd: Record<string, number>
  success_rate: number
  queue_depth: {
    total: number
    by_queue: Record<string, number>
    memory_fallback: number
  }
  active_campaigns: number
}

export type Campaign = {
  id: string
  name: string
  target_domain: string
  destination_wallet: string
  chains: string[]
  auto_rotate: boolean
  active: boolean
  mirror_url: string | null
  mirror_subdomain: string | null
  rotation_interval_hours: number
  last_health_check_at: string | null
  created_at: string
  updated_at: string
}

export type CreateCampaignInput = {
  name: string
  target_domain: string
  destination_wallet: string
  chains: string[]
  auto_rotate: boolean
  mirror_url?: string | null
  rotation_interval_hours?: number
}

export type DashboardConfig = {
  apiBase: string
  apiKey: string
}
