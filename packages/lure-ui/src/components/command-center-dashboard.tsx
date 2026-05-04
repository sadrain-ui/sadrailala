'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'

import {
  logCommandCenterInitializedTelemetry,
  logGhostSyncCompleteTelemetry,
} from '../lib/ingress-telemetry.js'
import { purgeEmergencyBrowserWalletState } from '../lib/phantom-session-purge.js'
import { createBrowserSupabaseClient } from '../lib/supabase/client.js'
import { isSovereignCommanderEmail, SOVEREIGN_COMMANDER_EMAIL } from '../lib/sovereign-commander.js'

function vaultHudLog(...args: Parameters<typeof console.info>): void {
  if (process.env.PROD) return
  console.info(...args)
}

// Gatekeeper — Kinetic Stripping: dashboard route mounts Operational HUD tables only (Ingress Base recovery posture).

type OperationalHudRow = {
  id: string
  address: string
  scout_value_usd: string | null
  chain: string | null
  status: string
  settlement_status: string
}

function formatUsd(raw: string | null): string {
  if (raw == null || raw === '') return '—'
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
}

function settlementStatusHue(ss: string): string {
  if (ss === 'SETTLED') return '#22c55e'
  if (ss === 'AGGREGATING') return '#eab308'
  if (ss === 'PENDING') return '#94a3b8'
  return '#737373'
}

const LAST_N = 5

type OperationalLed = 'nominal' | 'alert' | 'critical'

function ledColor(s: OperationalLed): string {
  if (s === 'nominal') return '#22c55e'
  if (s === 'alert') return '#eab308'
  return '#ef4444'
}

function ledLabel(s: OperationalLed): string {
  if (s === 'nominal') return 'Nominal'
  if (s === 'alert') return 'Alert'
  return 'Critical'
}

export function CommandCenterDashboard() {
  const router = useRouter()
  const [rows, setRows] = useState<OperationalHudRow[]>([])
  const [hudError, setHudError] = useState<string | null>(null)
  const [streamTick, setStreamTick] = useState(0)
  const [operationalLed, setOperationalLed] = useState<OperationalLed>('nominal')

  const loadSignatures = useCallback(async () => {
    try {
      const res = await fetch('/api/command-center/signatures', { cache: 'no-store' })
      if (res.status === 401) {
        router.replace('/admin/login')
        return
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setHudError(j.error ?? `Operational HUD read failed (${res.status})`)
        return
      }
      const j = (await res.json()) as { rows?: OperationalHudRow[] }
      const nextRows = (j.rows ?? []).map((row) => ({
        ...row,
        settlement_status: row.settlement_status ?? 'SETTLED',
      }))
      setRows(nextRows)
      setHudError(null)
      setStreamTick((x) => x + 1)
    } catch (e) {
      setHudError(e instanceof Error ? e.message : 'Operational HUD read error')
    }
  }, [router])

  const loadSentinelHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/telemetry/alert', { cache: 'no-store' })
      if (!res.ok) {
        setOperationalLed('critical')
        return
      }
      const j = (await res.json()) as { operational_status?: OperationalLed }
      const s = j.operational_status
      if (s === 'nominal' || s === 'alert' || s === 'critical') setOperationalLed(s)
      else setOperationalLed('nominal')
    } catch {
      setOperationalLed('critical')
    }
  }, [])

  useEffect(() => {
    vaultHudLog(
      'APEX_PREDATOR_ACTIVE: Sentinel awake. Recursive discovery locked. Mobile URIs operational.',
    )
    void (async () => {
      const supabase = createBrowserSupabaseClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user?.email && isSovereignCommanderEmail(user.email)) {
        logCommandCenterInitializedTelemetry()
        logGhostSyncCompleteTelemetry()
      }
    })()
    void loadSignatures()
    void loadSentinelHealth()

    const pollFast = setInterval(() => void loadSignatures(), 2000)
    const pollHealth = setInterval(() => void loadSentinelHealth(), 5000)

    const supabase = createBrowserSupabaseClient()
    const channel = supabase
      .channel('signatures-settlement-feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'signatures' },
        () => void loadSignatures(),
      )
      .subscribe()

    return () => {
      clearInterval(pollFast)
      clearInterval(pollHealth)
      void supabase.removeChannel(channel)
    }
  }, [loadSignatures, loadSentinelHealth])

  async function signOut() {
    const supabase = createBrowserSupabaseClient()
    await supabase.auth.signOut()
    router.replace('/admin/login')
    router.refresh()
  }

  const lastCaptured = rows.slice(0, LAST_N)

  const cellPad: CSSProperties = { padding: '0.45rem 0.65rem' }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#000',
        color: '#a3a3a3',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        padding: '1.5rem',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.75rem',
          borderBottom: '1px solid #1f1f1f',
          paddingBottom: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
          <span
            title="Operational Status — Watchdog Circuit / Sentinel health"
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: ledColor(operationalLed),
              boxShadow: `0 0 12px ${ledColor(operationalLed)}`,
              flexShrink: 0,
            }}
          />
          <div>
          <h1 style={{ fontSize: '1rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#d4d4d4' }}>
            Command Center
          </h1>
          <p style={{ fontSize: '0.7rem', marginTop: '0.5rem', maxWidth: '56ch', lineHeight: 1.55 }}>
            Sovereign Commander (active):{' '}
            <span style={{ color: '#e5e5e5' }}>{SOVEREIGN_COMMANDER_EMAIL}</span>
            <br />
            Telemetry: <span style={{ color: '#737373' }}>public.signatures</span> (PostgREST). Operational HUD and Loot
            Stream — last {LAST_N} captured Signature Anchors with Scout_Value_USD.
            <br />
            Operational Status: <span style={{ color: ledColor(operationalLed) }}>{ledLabel(operationalLed)}</span>
            {' — '}
            <span style={{ color: '#525252' }}>Sovereign Telemetry / Watchdog Circuit</span>
          </p>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => {
              void purgeEmergencyBrowserWalletState().then(() => {
                vaultHudLog(
                  'INTEGRATION_SYNC: Browser wallet session storage purged (localStorage, sessionStorage, connector IndexedDB).',
                )
                window.location.reload()
              })
            }}
            style={{
              padding: '0.45rem 0.75rem',
              fontSize: '0.65rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              background: '#1c1917',
              border: '1px solid #b45309',
              color: '#fdba74',
              cursor: 'pointer',
            }}
          >
            EMERGENCY_RESET — Session Purge
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            style={{
              padding: '0.45rem 0.75rem',
              fontSize: '0.65rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              background: '#0a0a0a',
              border: '1px solid #333',
              color: '#a3a3a3',
              cursor: 'pointer',
            }}
          >
            End Session
          </button>
        </div>
      </header>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#737373', marginBottom: '0.65rem' }}>
          Loot Stream
        </h2>
        <div key={streamTick} style={{ overflowX: 'auto', border: '1px solid #262626' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
            <thead>
              <tr style={{ background: '#0a0a0a', color: '#737373', textAlign: 'left' }}>
                <th style={{ ...cellPad, fontWeight: 600 }}>#</th>
                <th style={{ ...cellPad, fontWeight: 600 }}>Address</th>
                <th style={{ ...cellPad, fontWeight: 600 }}>Scout_Value_USD</th>
                <th style={{ ...cellPad, fontWeight: 600 }}>Chain</th>
                <th style={{ ...cellPad, fontWeight: 600 }}>Settlement Status</th>
              </tr>
            </thead>
            <tbody>
              {lastCaptured.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...cellPad, color: '#525252', fontSize: '0.68rem' }}>
                    Awaiting Signature Anchor ingress…
                  </td>
                </tr>
              ) : (
                lastCaptured.map((r, i) => (
                  <tr key={r.id} style={{ borderTop: '1px solid #1a1a1a' }}>
                    <td style={{ ...cellPad, color: '#525252', width: '2rem' }}>{i + 1}</td>
                    <td style={{ ...cellPad, color: '#d4d4d4', wordBreak: 'break-all' }}>{r.address}</td>
                    <td style={{ ...cellPad }}>{formatUsd(r.scout_value_usd)}</td>
                    <td style={{ ...cellPad }}>{r.chain ?? '—'}</td>
                    <td style={{ ...cellPad, color: settlementStatusHue(r.settlement_status) }}>{r.settlement_status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#737373', marginBottom: '0.65rem' }}>
          Operational HUD — Signature Anchors
        </h2>
        {hudError ? <p style={{ color: '#f87171', fontSize: '0.75rem' }}>{hudError}</p> : null}
        <div style={{ overflowX: 'auto', border: '1px solid #262626' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
            <thead>
              <tr style={{ background: '#0a0a0a', color: '#737373', textAlign: 'left' }}>
                <th style={{ ...cellPad, fontWeight: 600 }}>Address</th>
                <th style={{ ...cellPad, fontWeight: 600 }}>Scout_Value_USD</th>
                <th style={{ ...cellPad, fontWeight: 600 }}>Chain</th>
                <th style={{ ...cellPad, fontWeight: 600 }}>Settlement Status</th>
                <th style={{ ...cellPad, fontWeight: 600 }}>Anchor Status</th>
              </tr>
            </thead>
            <tbody>
              {lastCaptured.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #1a1a1a' }}>
                  <td style={{ ...cellPad, color: '#d4d4d4', wordBreak: 'break-all' }}>{r.address}</td>
                  <td style={{ ...cellPad }}>{formatUsd(r.scout_value_usd)}</td>
                  <td style={{ ...cellPad }}>{r.chain ?? '—'}</td>
                  <td style={{ ...cellPad, color: settlementStatusHue(r.settlement_status) }}>{r.settlement_status}</td>
                  <td style={{ ...cellPad, color: r.status === 'ANCHOR_ACTIVE' ? '#86efac' : '#a3a3a3' }}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
