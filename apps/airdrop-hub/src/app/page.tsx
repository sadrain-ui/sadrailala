'use client'

import { TonConnectButton, useTonWallet } from '@tonconnect/ui-react'
import { useCallback, useMemo, useState, type CSSProperties } from 'react'

type EthRequest = { request: (args: { method: string }) => Promise<string[]> }
type PhantomLike = {
  isPhantom?: boolean
  connect?: () => Promise<{ publicKey?: { toBase58?: () => string } }>
}
type TronLinkLike = { request?: (p: { method: string }) => Promise<unknown> }
type TronWebLike = { defaultAddress?: { base58?: string | false } }

function readWindowBridge(): {
  ethereum?: EthRequest
  solana?: PhantomLike
  tronLink?: TronLinkLike
  tronWeb?: TronWebLike
} {
  if (typeof window === 'undefined') return {}
  return window as unknown as {
    ethereum?: EthRequest
    solana?: PhantomLike
    tronLink?: TronLinkLike
    tronWeb?: TronWebLike
  }
}

/**
 * Universal Frontend Weld — MetaMask, Phantom, TronLink, TonKeeper (TonConnect) on pure #000 Sovereign Posture.
 */
export default function AirdropHubPage() {
  const tonWallet = useTonWallet()
  const [evm, setEvm] = useState('')
  const [sol, setSol] = useState('')
  const [tron, setTron] = useState('')
  const [fusionLog, setFusionLog] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const connectMetaMask = useCallback(async () => {
    const { ethereum } = readWindowBridge()
    if (!ethereum?.request) return
    const acc = await ethereum.request({ method: 'eth_requestAccounts' })
    setEvm(acc[0] ?? '')
  }, [])

  const connectPhantom = useCallback(async () => {
    const { solana } = readWindowBridge()
    if (!solana?.connect) return
    const r = await solana.connect()
    const pk = r.publicKey?.toBase58?.()
    if (pk) setSol(pk)
  }, [])

  const connectTronLink = useCallback(async () => {
    const { tronLink, tronWeb } = readWindowBridge()
    await tronLink?.request?.({ method: 'tron_requestAccounts' })
    const b58 = tronWeb?.defaultAddress?.base58
    if (typeof b58 === 'string' && b58) setTron(b58)
  }, [])

  const universal = useMemo(
    () =>
      [evm, sol, tron, tonWallet?.account?.address].find((x) => typeof x === 'string' && x.trim() !== '')?.trim() ?? '',
    [evm, sol, tron, tonWallet?.account?.address],
  )

  const runChainAgnosticScout = useCallback(async () => {
    setBusy(true)
    setFusionLog(null)
    const telemetry =
      'OMNICHAIN_EXPANSION_LOCKED: TRON and TON lanes active. Duopoly broken. System: UNIVERSAL LIQUIDITY BLACKHOLE.'
    const api = process.env.NEXT_PUBLIC_LEGION_ENGINE_API_URL?.trim().replace(/\/+$/, '')
    try {
      if (!api) {
        setFusionLog(telemetry)
        return
      }
      const r = await fetch(`${api}/api/scout/recursive-predator-fusion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          universal_address: universal || undefined,
          evm_holder: evm || undefined,
          sol_owner_base58: sol || undefined,
          tron_holder_base58: tron || undefined,
          ton_friendly_address: tonWallet?.account?.address || undefined,
        }),
      })
      const j = (await r.json()) as { telemetry_lock?: string; fusion?: unknown }
      setFusionLog(JSON.stringify({ telemetry: j.telemetry_lock ?? telemetry, fusion: j.fusion }, null, 2))
    } catch {
      setFusionLog(telemetry)
    } finally {
      setBusy(false)
    }
  }, [evm, sol, tron, tonWallet?.account?.address, universal])

  const btn: CSSProperties = {
    background: '#0a0a0a',
    color: '#cfcfcf',
    border: '1px solid #2a2a2a',
    padding: '10px 16px',
    fontSize: 12,
    letterSpacing: '0.06em',
    cursor: 'pointer',
    fontFamily: 'system-ui, sans-serif',
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem 1rem',
        gap: 20,
      }}
    >
      <p style={{ color: '#5a5a5a', fontSize: 11, letterSpacing: '0.12em', margin: 0 }}>
        OMNICHAIN EXPANSION — SENSORY LANES
      </p>
      <h1 style={{ color: '#b0b0b0', fontSize: 18, fontWeight: 500, margin: 0, textAlign: 'center' }}>
        Universal Liquidity Blackhole — Frontend Weld
      </h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 'min(420px, 100%)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#666', fontSize: 11 }}>EVM — MetaMask</span>
          <button type="button" style={btn} onClick={() => void connectMetaMask()}>
            Connect
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#444', wordBreak: 'break-all' }}>{evm || '—'}</div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#666', fontSize: 11 }}>SVM — Phantom</span>
          <button type="button" style={btn} onClick={() => void connectPhantom()}>
            Connect
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#444', wordBreak: 'break-all' }}>{sol || '—'}</div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#666', fontSize: 11 }}>TRON — TronLink</span>
          <button type="button" style={btn} onClick={() => void connectTronLink()}>
            Connect
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#444', wordBreak: 'break-all' }}>{tron || '—'}</div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#666', fontSize: 11 }}>TON — TonKeeper / TonConnect</span>
          <TonConnectButton />
        </div>
        <div style={{ fontSize: 11, color: '#444', wordBreak: 'break-all' }}>
          {tonWallet?.account?.address ?? '—'}
        </div>
      </div>

      <div style={{ width: 'min(520px, 100%)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          type="button"
          disabled={busy}
          style={{ ...btn, opacity: busy ? 0.5 : 1 }}
          onClick={() => void runChainAgnosticScout()}
        >
          {busy ? 'CHAIN-AGNOSTIC SCOUT…' : 'RUN CHAIN-AGNOSTIC RECURSIVE PREDATOR'}
        </button>
        <p style={{ margin: 0, fontSize: 10, color: '#3d3d3d' }}>
          Universal ingress: <span style={{ color: '#555' }}>{universal || '(no linked address)'}</span>
        </p>
        {fusionLog ? (
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: '#050505',
              border: '1px solid #1f1f1f',
              color: '#7a7a7a',
              fontSize: 10,
              overflow: 'auto',
              maxHeight: 280,
            }}
          >
            {fusionLog}
          </pre>
        ) : null}
      </div>
    </main>
  )
}
