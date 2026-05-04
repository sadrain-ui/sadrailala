'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'

import { purgePhantomWalletSessions } from '../../../lib/phantom-session-purge.js'

type KineticAuditPayload = {
  kinetic_audit: {
    dry_run_bundle: 'VALIDATION_SUCCESS' | 'STRUCTURAL_ERROR'
    database: {
      supabase_reachable: boolean
      postgrest_latency_ms: number | null
      rls_anon_engine_config: 'restricted' | 'materializable' | 'unknown'
    }
    rpc_lanes: Array<{
      key_name: string
      latency_ms: number | null
      lane_class: 'http_probe' | 'skipped_non_url'
    }>
    settlement_core: {
      flashbots_relay_latency_ms: number | null
      jito_lane_latency_ms: number | null
      flashbots_probe_url: string
      jito_probe_url: string
    }
  }
}

const TERMINAL_GREEN = '#33ff66'
const TERMINAL_WHITE = '#f5f5f5'
const TERMINAL_BLACK = '#000000'

const STORAGE_SESSION_PROBE =
  /wagmi|walletconnect|wc@|@walletconnect|appkit|reown|wcm|ethereum-provider|phantom|solflare/i

function readSessionPlane(): { keys_found: string[]; wagmi_connected: string | null } {
  const keys_found: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && STORAGE_SESSION_PROBE.test(k)) {
        keys_found.push(k)
      }
    }
  } catch {
    /* non-fatal */
  }
  let wagmi_connected: string | null = null
  try {
    wagmi_connected = localStorage.getItem('wagmi.connected')
  } catch {
    wagmi_connected = null
  }
  return { keys_found, wagmi_connected }
}

export function SovereignDiagnostic() {
  const router = useRouter()
  const [audit, setAudit] = useState<KineticAuditPayload['kinetic_audit'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sessionPlane, setSessionPlane] = useState(readSessionPlane)
  const [reseedBusy, setReseedBusy] = useState(false)
  const [reseedMsg, setReseedMsg] = useState<string | null>(null)

  const loadAudit = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/diagnostic/kinetic-audit', { cache: 'no-store' })
      if (res.status === 401) {
        router.replace('/admin/login')
        return
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `Kinetic Audit fetch failed (${res.status})`)
        return
      }
      const j = (await res.json()) as KineticAuditPayload
      setAudit(j.kinetic_audit)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kinetic Audit error')
    }
  }, [router])

  useEffect(() => {
    if (!process.env.PROD) {
      console.log(
        'DIAGNOSTIC_SUITE_READY: Every engine pillar is now under sovereign audit.',
      )
    }
    void loadAudit()
    const id = setInterval(() => void loadAudit(), 15_000)
    return () => clearInterval(id)
  }, [loadAudit])

  useEffect(() => {
    const id = setInterval(() => setSessionPlane(readSessionPlane()), 3000)
    return () => clearInterval(id)
  }, [])

  const hudTitle: CSSProperties = useMemo(
    () => ({
      color: TERMINAL_GREEN,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: '0.72rem',
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
      marginBottom: '0.35rem',
    }),
    [],
  )

  async function sovereignReseed() {
    setReseedBusy(true)
    setReseedMsg(null)
    try {
      const res = await fetch('/api/admin/diagnostic/sovereign-reseed', { method: 'POST' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setReseedMsg(j.error ?? `Re-Seed failed (${res.status})`)
        setReseedBusy(false)
        return
      }
      purgePhantomWalletSessions()
      try {
        const keys: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k && STORAGE_SESSION_PROBE.test(k)) {
            keys.push(k)
          }
        }
        for (const k of keys) {
          localStorage.removeItem(k)
        }
      } catch {
        /* non-fatal */
      }
      setReseedMsg('Sovereign Re-Seed complete — Logic Tree defaults restored; session plane purged.')
      void loadAudit()
    } catch (e) {
      setReseedMsg(e instanceof Error ? e.message : 'Re-Seed error')
    } finally {
      setReseedBusy(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: TERMINAL_BLACK,
        color: TERMINAL_WHITE,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        padding: '1.25rem 1.5rem',
      }}
    >
      <header style={{ marginBottom: '1.25rem', borderBottom: `1px solid ${TERMINAL_GREEN}`, paddingBottom: '0.75rem' }}>
        <div style={{ color: TERMINAL_GREEN, fontSize: '0.85rem', letterSpacing: '0.12em' }}>
          PHASE 10.1.0 — KINETIC AUDIT · LOGIC TREE
        </div>
        <div style={{ color: TERMINAL_WHITE, fontSize: '1.05rem', marginTop: '0.35rem' }}>
          SovereignDiagnostic
        </div>
        <nav style={{ marginTop: '0.75rem', fontSize: '0.75rem' }}>
          <Link href="/admin/dashboard" style={{ color: TERMINAL_GREEN }}>
            ← Command Center
          </Link>
        </nav>
      </header>

      <section style={{ marginBottom: '1.25rem' }}>
        <div style={hudTitle}>[ DATABASE ] — Supabase Health &amp; RLS Status</div>
        <pre
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            color: TERMINAL_WHITE,
            fontSize: '0.78rem',
            lineHeight: 1.5,
          }}
        >
          {audit == null && error == null
            ? 'Awaiting vault telemetry…'
            : error != null
              ? `Fault: ${error}`
              : audit != null
                ? [
                    `PostgREST latency (Logic Tree): ${audit.database.postgrest_latency_ms ?? '—'} ms`,
                    `Plane reachable: ${audit.database.supabase_reachable ? 'YES' : 'NO'}`,
                    `RLS anon engine_config: ${audit.database.rls_anon_engine_config}`,
                  ].join('\n')
                : '—'}
        </pre>
      </section>

      <section style={{ marginBottom: '1.25rem' }}>
        <div style={hudTitle}>[ RPC_LANES ] — engine_config Connectivity Map</div>
        <pre
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            color: TERMINAL_WHITE,
            fontSize: '0.78rem',
            lineHeight: 1.5,
          }}
        >
          {audit == null && error == null
            ? 'Scanning RPC lanes…'
            : error != null
              ? '—'
              : audit != null
                ? audit.rpc_lanes.length === 0
                  ? '(no engine_config rows materialized)'
                  : audit.rpc_lanes
                      .map((lane) =>
                        lane.lane_class === 'skipped_non_url'
                          ? `${lane.key_name}: non-URL value — skipped (Dry-run)`
                          : `${lane.key_name}: ${lane.latency_ms != null ? `${lane.latency_ms} ms` : 'TIMEOUT / FAULT'}`,
                      )
                      .join('\n')
                : '—'}
        </pre>
      </section>

      <section style={{ marginBottom: '1.25rem' }}>
        <div style={hudTitle}>[ SETTLEMENT_CORE ] — Jito / Flashbots Relay Connectivity</div>
        <pre
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            color: TERMINAL_WHITE,
            fontSize: '0.78rem',
            lineHeight: 1.5,
          }}
        >
          {audit == null && error == null
            ? 'Probing settlement relays…'
            : error != null
              ? '—'
              : audit != null
                ? [
                    `Flashbots relay: ${audit.settlement_core.flashbots_probe_url}`,
                    `Latency: ${audit.settlement_core.flashbots_relay_latency_ms ?? '—'} ms`,
                    `Jito block-engine: ${audit.settlement_core.jito_probe_url}`,
                    `Latency: ${audit.settlement_core.jito_lane_latency_ms ?? '—'} ms`,
                    `Bundle Dry-run (PerformanceCloser): ${audit.dry_run_bundle}`,
                  ].join('\n')
                : '—'}
        </pre>
      </section>

      <section style={{ marginBottom: '1.25rem' }}>
        <div style={hudTitle}>[ SESSION ] — AppKit / Wagmi Storage Status</div>
        <pre
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            color: TERMINAL_WHITE,
            fontSize: '0.78rem',
            lineHeight: 1.5,
          }}
        >
          {[
            `wagmi.connected: ${sessionPlane.wagmi_connected ?? '(unset)'}`,
            `Matched localStorage keys: ${sessionPlane.keys_found.length}`,
            ...(sessionPlane.keys_found.length > 0 ? sessionPlane.keys_found.slice(0, 12) : ['(no connector keys matched)']),
          ].join('\n')}
        </pre>
      </section>

      <section>
        <div style={hudTitle}>[ DISPATCHER ] — Sovereign Re-Seed</div>
        <p style={{ color: TERMINAL_WHITE, fontSize: '0.78rem', maxWidth: '52rem', lineHeight: 1.55 }}>
          Restores institutional defaults on the engine_config plane via secure API. Clears corrupt wallet session keys
          on this browser (Dry-run-safe purge pattern).
        </p>
        <button
          type="button"
          onClick={() => void sovereignReseed()}
          disabled={reseedBusy}
          style={{
            marginTop: '0.5rem',
            background: TERMINAL_BLACK,
            color: TERMINAL_GREEN,
            border: `1px solid ${TERMINAL_GREEN}`,
            padding: '0.45rem 0.9rem',
            fontFamily: 'inherit',
            fontSize: '0.78rem',
            cursor: reseedBusy ? 'wait' : 'pointer',
          }}
        >
          {reseedBusy ? 'Re-Seeding…' : 'Sovereign Re-Seed'}
        </button>
        {reseedMsg != null ? (
          <div style={{ color: TERMINAL_WHITE, fontSize: '0.75rem', marginTop: '0.5rem' }}>{reseedMsg}</div>
        ) : null}
      </section>
    </div>
  )
}
