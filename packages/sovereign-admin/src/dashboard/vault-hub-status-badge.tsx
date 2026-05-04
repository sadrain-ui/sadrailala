'use client'

import { useEffect, useState } from 'react'

import { resolveLegionEngineApiBase } from '../lib/sovereign-commander'

const DEFAULT_CENTRAL_HUB = 'https://legion-engine-api.vercel.app'

/**
 * Telemetry Ping — Central Hub `/health` on 60s cadence (Vercel Routing + post-ignition sync).
 */
export function VaultHubStatusBadge() {
  const [hubOk, setHubOk] = useState<boolean | null>(null)
  const [pingAt, setPingAt] = useState<string | null>(null)

  useEffect(() => {
    const base = resolveLegionEngineApiBase() || DEFAULT_CENTRAL_HUB
    const url = `${base.replace(/\/+$/, '')}/health`

    const ping = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store', method: 'GET' })
        setHubOk(res.ok)
      } catch {
        setHubOk(false)
      }
      setPingAt(new Date().toISOString())
    }

    void ping()
    const id = setInterval(() => void ping(), 60_000)
    return () => clearInterval(id)
  }, [])

  const label =
    hubOk === null ? 'Hub: …' : hubOk ? 'Vault Status: Hub Nominal' : 'Vault Status: Hub Degraded'

  return (
    <div
      title={pingAt ? `Telemetry Ping — last ${pingAt}` : 'Telemetry Ping'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.4rem 0.65rem',
        fontSize: '0.62rem',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        background: '#000',
        border: '1px solid #2a2a2a',
        color: hubOk === null ? '#737373' : hubOk ? '#86efac' : '#f87171',
        fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: hubOk === null ? '#525252' : hubOk ? '#22c55e' : '#ef4444',
          boxShadow:
            hubOk === null
              ? 'none'
              : hubOk
                ? '0 0 8px #22c55e'
                : '0 0 8px #ef4444',
        }}
      />
      {label}
    </div>
  )
}
