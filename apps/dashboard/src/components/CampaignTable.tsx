import type { Campaign } from '../types'

type Props = {
  campaigns: Campaign[]
  rotatingId: string | null
  onRotate: (id: string) => void
}

function statusLabel(campaign: Campaign): { text: string; className: string } {
  if (!campaign.active) return { text: 'Inactive', className: 'badge-inactive' }
  if (campaign.auto_rotate) return { text: 'Active · Auto', className: 'badge-auto' }
  return { text: 'Active', className: 'badge-active' }
}

export function CampaignTable({ campaigns, rotatingId, onRotate }: Props) {
  if (campaigns.length === 0) {
    return <div className="empty panel">No campaigns yet. Create one to get started.</div>
  }

  return (
    <div className="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Target domain</th>
            <th>Mirror URL</th>
            <th>Status</th>
            <th>Chains</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => {
            const status = statusLabel(campaign)
            const isRotating = rotatingId === campaign.id
            return (
              <tr key={campaign.id}>
                <td>
                  <strong>{campaign.name}</strong>
                  <div className="mono" style={{ color: '#64748b', marginTop: 4 }}>
                    {campaign.id.slice(0, 8)}…
                  </div>
                </td>
                <td className="mono">{campaign.target_domain}</td>
                <td>
                  {campaign.mirror_url ? (
                    <a href={campaign.mirror_url} target="_blank" rel="noreferrer">
                      {campaign.mirror_url}
                    </a>
                  ) : (
                    <span style={{ color: '#64748b' }}>—</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${status.className}`}>{status.text}</span>
                </td>
                <td>{campaign.chains.join(', ')}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={isRotating || !campaign.active}
                    onClick={() => onRotate(campaign.id)}
                  >
                    {isRotating ? 'Rotating…' : 'Rotate domain'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
