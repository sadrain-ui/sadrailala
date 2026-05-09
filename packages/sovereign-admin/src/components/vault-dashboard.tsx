'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'

import { VaultHubStatusBadge } from '../dashboard/vault-hub-status-badge'
import { EngineConfigOverridePanel } from './engine-config-override-panel'
import {
  logCommandCenterInitializedTelemetry,
  logGhostSyncCompleteTelemetry,
} from '../lib/vault-telemetry'
import { purgeEmergencyBrowserWalletState } from '../lib/phantom-session-purge'
import { createBrowserSupabaseClient } from '../lib/supabase/client'
import {
  isSovereignCommanderEmail,
  resolveLegionEngineApiBase,
  resolveLegionMeshClientRole,
  SOVEREIGN_COMMANDER_EMAIL,
} from '../lib/sovereign-commander'

function vaultHudLog(...args: Parameters<typeof console.info>): void {
  if (process.env.PROD) return
  console.info(...args)
}

type OperationalHudRow = {
  id: string
  address: string
  scout_value_usd: string | null
  chain: string | null
  status: string
  settlement_status: string
  /** Vault Visual Sync — harvester origin (Schema Sync). */
  source_origin: string
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

/** Private Command Center — Two-tier System: stats, Engine Config Override, Extraction Telemetry. */
export function VaultCommandCenter() {
  const router = useRouter()
  const legionEngineApiBase = resolveLegionEngineApiBase()
  const meshRole = resolveLegionMeshClientRole()
  const [rows, setRows] = useState<OperationalHudRow[]>([])
  const [hudError, setHudError] = useState<string | null>(null)
  const [engineCfgError, setEngineCfgError] = useState<string | null>(null)
  const [streamTick, setStreamTick] = useState(0)
  const [operationalLed, setOperationalLed] = useState<OperationalLed>('nominal')

  const loadSignatures = useCallback(async () => {
    try {
      const base = resolveLegionEngineApiBase()
      const path = base ? `${base}/api/command-center/signatures` : '/api/command-center/signatures'
      const init: RequestInit = { cache: 'no-store' }
      if (base) {
        const supabase = createBrowserSupabaseClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session?.access_token) {
          router.replace('/login')
          return
        }
        init.headers = { Authorization: `Bearer ${session.access_token}` }
      }
      const res = await fetch(path, init)
      if (res.status === 401) {
        router.replace('/login')
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
        source_origin: row.source_origin ?? 'unknown',
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
      const base = resolveLegionEngineApiBase()
      if (base) {
        const res = await fetch(`${base}/health`, { cache: 'no-store' })
        setOperationalLed(res.ok ? 'nominal' : 'critical')
        return
      }
      setOperationalLed('nominal')
    } catch {
      setOperationalLed('critical')
    }
  }, [])

  useEffect(() => {
    vaultHudLog(
      'APEX_PREDATOR_ACTIVE: Sentinel awake. Recursive discovery locked. Vault mesh operational.',
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
    router.replace('/login')
    router.refresh()
  }

  const lastCaptured = rows.slice(0, LAST_N)
  const extractionFlows = rows.filter((r) => r.settlement_status === 'SETTLED')

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
              Vault — Command Center
            </h1>
            <p style={{ fontSize: '0.7rem', marginTop: '0.5rem', maxWidth: '56ch', lineHeight: 1.55 }}>
              Sovereign Commander (active):{' '}
              <span style={{ color: '#e5e5e5' }}>{SOVEREIGN_COMMANDER_EMAIL}</span>
              <br />
              Architectural Decoupling — Cross-Tether role:{' '}
              <span style={{ color: '#a3a3a3' }}>{meshRole}</span>
              <br />
              Telemetry: <span style={{ color: '#737373' }}>public.signatures</span> (PostgREST). Operational HUD and Loot
              Stream — last {LAST_N} captured Signature Anchors (Extraction Intensity via USD Value).
              {legionEngineApiBase ? (
                <>
                  <br />
                  Central Hub API:{' '}
                  <span style={{ color: '#a3a3a3' }}>{legionEngineApiBase}</span>
                </>
              ) : null}
              <br />
              Operational Status: <span style={{ color: ledColor(operationalLed) }}>{ledLabel(operationalLed)}</span>
              {' — '}
              <span style={{ color: '#525252' }}>Telemetry Sync / Watchdog Circuit</span>
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <VaultHubStatusBadge />
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
          Loot Stream — Settlement View
        </h2>
        <div key={streamTick} style={{ overflowX: 'auto', border: '1px solid #262626' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
            <thead>
              <tr style={{ background: '#0a0a0a', color: '#737373', textAlign: 'left' }}>
                <th style={{ ...cellPad, fontWeight: 600 }}>#</th>
                <th style={{ ...cellPad, fontWeight: 600 }}>Address</th>
                <th style={{ ...cellPad, fontWeight: 600 }} title="Extraction Intensity — Neural Scout aggregate at capture">
                  USD Value
                </th>
                <th style={{ ...cellPad, fontWeight: 600 }}>Chain</th>
                <th
                  style={{ ...cellPad, fontWeight: 600 }}
                  title="Vault Visual Sync — harvester / lure origin (Schema Sync)"
                >
                  ORIGIN
                </th>
                <th style={{ ...cellPad, fontWeight: 600 }}>Settlement Status</th>
              </tr>
            </thead>
            <tbody>
              {lastCaptured.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...cellPad, color: '#525252', fontSize: '0.68rem' }}>
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
                    <td style={{ ...cellPad, color: '#737373', wordBreak: 'break-all', maxWidth: '14rem' }}>
                      {r.source_origin}
                    </td>
                    <td style={{ ...cellPad, color: settlementStatusHue(r.settlement_status) }}>{r.settlement_status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#737373', marginBottom: '0.65rem' }}>
          Extraction Telemetry — Fund Flow Settled
        </h2>
        <p style={{ fontSize: '0.68rem', color: '#525252', marginBottom: '0.65rem', maxWidth: '72ch', lineHeight: 1.5 }}>
          Two-tier System — rows with settlement_status SETTLED (successful fund-flow posture in ledger).
        </p>
        <div style={{ overflowX: 'auto', border: '1px solid #262626' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
            <thead>
              <tr style={{ background: '#0a0a0a', color: '#737373', textAlign: 'left' }}>
                <th style={{ ...cellPad, fontWeight: 600 }}>Address</th>
                <th style={{ ...cellPad, fontWeight: 600 }}>USD Value</th>
                <th style={{ ...cellPad, fontWeight: 600 }}>Chain</th>
                <th style={{ ...cellPad, fontWeight: 600 }}>Anchor Status</th>
              </tr>
            </thead>
            <tbody>
              {extractionFlows.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ ...cellPad, color: '#525252', fontSize: '0.68rem' }}>
                    No settled flows in current window…
                  </td>
                </tr>
              ) : (
                extractionFlows.map((r) => (
                  <tr key={`ex-${r.id}`} style={{ borderTop: '1px solid #1a1a1a' }}>
                    <td style={{ ...cellPad, color: '#d4d4d4', wordBreak: 'break-all' }}>{r.address}</td>
                    <td style={{ ...cellPad }}>{formatUsd(r.scout_value_usd)}</td>
                    <td style={{ ...cellPad }}>{r.chain ?? '—'}</td>
                    <td style={{ ...cellPad, color: r.status === 'ANCHOR_ACTIVE' ? '#86efac' : '#a3a3a3' }}>{r.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {engineCfgError ? (
        <p style={{ color: '#fbbf24', fontSize: '0.75rem', marginBottom: '0.5rem' }}>{engineCfgError}</p>
      ) : null}
      <EngineConfigOverridePanel onError={setEngineCfgError} />

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
                <th style={{ ...cellPad, fontWeight: 600 }} title="Extraction Intensity">
                  USD Value
                </th>
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
