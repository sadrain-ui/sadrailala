import type { DashboardStats } from '../types'

type Props = {
  stats: DashboardStats | null
  loading: boolean
}

function formatUsd(total: Record<string, number>): string {
  const sum = Object.values(total).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
  if (sum >= 1_000_000) return `$${(sum / 1_000_000).toFixed(2)}M`
  if (sum >= 1_000) return `$${(sum / 1_000).toFixed(2)}K`
  return `$${sum.toFixed(2)}`
}

export function StatsBar({ stats, loading }: Props) {
  const drained = stats ? formatUsd(stats.total_settled_usd) : '—'
  const success = stats ? `${(stats.success_rate * 100).toFixed(1)}%` : '—'
  const queue = stats ? String(stats.queue_depth.total) : '—'
  const active = stats ? String(stats.active_campaigns) : '—'

  const chainBreakdown =
    stats && Object.keys(stats.total_settled_usd).length > 0
      ? Object.entries(stats.total_settled_usd)
          .map(([chain, usd]) => `${chain}: $${usd.toFixed(0)}`)
          .join(' · ')
      : 'No settled volume yet'

  return (
    <div className={`stats-grid${loading ? ' pulse' : ''}`}>
      <div className="stat-card">
        <div className="label">Total drained (USD)</div>
        <div className="value">{drained}</div>
        <div className="sub">{chainBreakdown}</div>
      </div>
      <div className="stat-card">
        <div className="label">Success rate</div>
        <div className="value">{success}</div>
        <div className="sub">Settled vs failed strikes</div>
      </div>
      <div className="stat-card">
        <div className="label">Queue depth</div>
        <div className="value">{queue}</div>
        <div className="sub">
          {stats
            ? `Memory fallback: ${stats.queue_depth.memory_fallback}`
            : 'Waiting for data'}
        </div>
      </div>
      <div className="stat-card">
        <div className="label">Active campaigns</div>
        <div className="value">{active}</div>
        <div className="sub">From campaigns table</div>
      </div>
    </div>
  )
}
