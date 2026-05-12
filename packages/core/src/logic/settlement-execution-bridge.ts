/**
 * Settlement Execution — bridges stored Signature Anchor material to Flashbots / Jito wire payloads.
 * Sovereign Vault routing commits via calldata hash binding; executor keys arm live relay serialization.
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { base58 } from '@scure/base'
import type { Address } from 'viem'
import {
  createPublicClient,
  http,
  isAddress,
  keccak256,
  getAddress,
  parseGwei,
  parseTransaction,
  stringToHex,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, mainnet, optimism, polygon, sepolia, type Chain } from 'viem/chains'

import { identifyFamily } from '../adapters/address-resolver'
import { resolveInstitutionalSolanaRpcUrl } from '../adapters/svm-adapter'
import {
  LEGION_MESH_EVENT_SETTLEMENT,
  legionMeshViemFetchOptions,
} from './mesh-event'
import { pingTonSensoryArmorLane } from './ton-sensory-armor'
import { pingTronSensoryArmorLane } from './tron-sensory-armor'
import type { SignatureAnchorChainFamily } from './settlement'

/** Bridge ingress — mirrors LiquidationTriggerContext without importing algorithmic-closer (cyclical weld guard). */
export type SettlementBridgeTriggerContext = {
  scout_value_usd: number
  chain_id: string | null
  protocol: string
  wallet_address: string
  token_address?: string | null
  signature_hex?: string | null
  chain_type?: string | null
  chain_family?: SignatureAnchorChainFamily | null
}

function encodeSolanaWireBase64(tx: VersionedTransaction): string {
  const raw = tx.serialize()
  let bin = ''
  for (let i = 0; i < raw.length; i++) {
    bin += String.fromCharCode(raw[i]!)
  }
  return btoa(bin)
}

function resolveViemChainForSettlement(chainId: number | null): Chain {
  const id = chainId ?? 1
  const map: Record<number, Chain> = {
    1: mainnet,
    137: polygon,
    42161: arbitrum,
    8453: base,
    10: optimism,
    11155111: sepolia,
  }
  return map[id] ?? mainnet
}

async function resolveEvmSettlementRpcUrlBridge(): Promise<string> {
  const { resolveConfigPrioritized } = await import('../config/remote-sync')
  const envChain =
    (typeof process !== 'undefined' ? process.env['RPC_ETHEREUM_PRIVATE'] : undefined)?.trim() ??
    (typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_RPC_URL'] : undefined)?.trim() ??
    (typeof process !== 'undefined' ? process.env['RPC_URL'] : undefined)?.trim() ??
    ''
  return (
    (await resolveConfigPrioritized('RPC_ETHEREUM_PRIVATE', envChain)) ??
    (await resolveConfigPrioritized('NEXT_PUBLIC_RPC_URL', envChain)) ??
    (await resolveConfigPrioritized('RPC_URL', envChain)) ??
    ''
  )
}

export type SettlementExecutionWire = {
  flashbotsSignedHex: Hex[]
  jitoEncodedTransactions: string[]
  sovereignVaultAddressPrimary: string
  sovereignVaultAddressEvm?: string
  sovereignVaultAddressSvm?: string
  sovereignVaultAddressTron?: string
  sovereignVaultAddressTon?: string
  bundleDigest: Hex
  bundleAuthorizationHex?: Hex
}

/** Sovereign Vault anchor — VAULT_ADDRESS_* aliases with SOVEREIGN_VAULT_* operational fallbacks. */
export function resolveSovereignVaultAddresses(): {
  evm?: Address
  svm?: string
  tron?: string
  ton?: string
  primary: string
} {
  const evmRaw =
    (typeof process !== 'undefined' ? process.env['VAULT_ADDRESS_EVM'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_EVM'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_ADDRESS'] : undefined)?.trim()
  const svmRaw =
    (typeof process !== 'undefined' ? process.env['VAULT_ADDRESS_SVM'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['VAULT_ADDRESS_SOL'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_SVM'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_SOL'] : undefined)?.trim()
  const tronRaw =
    (typeof process !== 'undefined' ? process.env['VAULT_ADDRESS_TRON'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_TRON'] : undefined)?.trim()
  const tonRaw =
    (typeof process !== 'undefined' ? process.env['VAULT_ADDRESS_TON'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_TON'] : undefined)?.trim()
  let evm: Address | undefined
  if (evmRaw && isAddress(evmRaw)) evm = getAddress(evmRaw)
  const svm = svmRaw && svmRaw.length >= 32 ? svmRaw : undefined
  const tron = tronRaw && tronRaw.length >= 30 ? tronRaw : undefined
  const ton = tonRaw && tonRaw.length >= 30 ? tonRaw : undefined
  const primary = (evm ?? svm ?? tron ?? ton ?? 'sovereign_vault') as string
  return {
    primary,
    ...(evm !== undefined ? { evm } : {}),
    ...(svm !== undefined ? { svm } : {}),
    ...(tron !== undefined ? { tron } : {}),
    ...(ton !== undefined ? { ton } : {}),
  }
}

/**
 * Extraction rehearsal — EIP-1559 serialized wire executed as `eth_call` against Sovereign Vault calldata lane.
 */
export async function simulateEvmSettlementSerializedTx(
  serializedTx: Hex,
  chainIdHint: string | null,
): Promise<{ success: boolean; detail: string }> {
  try {
    const raw = chainIdHint != null ? String(chainIdHint).trim() : ''
    const parsedNum = /^-?\d+$/.test(raw) ? Number(raw) : NaN
    const chainIdNum = Number.isFinite(parsedNum) ? parsedNum : null
    const chain = resolveViemChainForSettlement(chainIdNum)
    const rpc = await resolveEvmSettlementRpcUrlBridge()
    if (rpc === '') {
      return { success: false, detail: 'EVM_RPC_UNCONFIGURED_EXTRACTION_SIM' }
    }
    const deserialized = parseTransaction(serializedTx)
    const client = createPublicClient({
      chain,
      transport: http(rpc, {
        ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
      }),
    })
    const toAddr = deserialized.to
    const dataHex = deserialized.data ?? '0x'
    if (!toAddr) {
      return { success: false, detail: 'EXTRACTION_SIM_MISSING_TO_ADDRESS' }
    }
    await client.call({
      to: toAddr,
      data: dataHex,
      value: deserialized.value ?? 0n,
    })
    return { success: true, detail: 'EXTRACTION_ETH_CALL_NOMINAL' }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return { success: false, detail }
  }
}

function readSettlementEnv(keys: readonly string[]): string | undefined {
  if (typeof process === 'undefined') return undefined
  for (const key of keys) {
    const raw = process.env[key]?.trim()
    if (raw) return raw
  }
  return undefined
}

function parseSettlementExecutorPrivateKey(): Hex | null {
  const raw = readSettlementEnv(['SETTLEMENT_EXECUTION_PRIVATE_KEY', 'PRIVATE_KEY'])
  if (!raw) return null
  const normalized = raw.startsWith('0x') ? raw : (`0x${raw}` as Hex)
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) return null
  return normalized as Hex
}

function parseSettlementSolanaExecutorKeypair(): Keypair | null {
  const raw = readSettlementEnv([
    'SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY',
    'SETTLEMENT_EXECUTION_SVM_SECRET_KEY',
    'PRIVATE_KEY_SVM',
    'SOLANA_PRIVATE_KEY',
  ])
  if (!raw) return null
  try {
    const decoded = base58.decode(raw)
    return Keypair.fromSecretKey(Uint8Array.from(decoded))
  } catch {
    try {
      const arr = JSON.parse(raw) as number[]
      if (!Array.isArray(arr)) return null
      return Keypair.fromSecretKey(Uint8Array.from(arr))
    } catch {
      return null
    }
  }
}

function parseSettlementChainId(chainId: string | null): number | null {
  if (chainId == null || String(chainId).trim() === '') return null
  const raw = String(chainId).trim()
  const direct = /^-?\d+$/.test(raw) ? Number(raw) : NaN
  if (Number.isFinite(direct)) return direct
  const caip = raw.match(/^(?:eip155|evm):(\d+)$/i)
  if (caip?.[1]) {
    const parsed = Number(caip[1])
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export type SettlementBroadcastLane =
  | 'evm-liquidator'
  | 'solana-liquidator'
  | 'tron-sensory-armor'
  | 'ton-sensory-armor'

export type SettlementBroadcastChain = Extract<SignatureAnchorChainFamily, 'EVM' | 'SVM' | 'TRON' | 'TON'>

export type SettlementBroadcastStatus =
  | 'stub_ready'
  | 'broadcasted'
  | 'key_unarmed'
  | 'vault_unbound'
  | 'rpc_unconfigured'
  | 'sensory_unavailable'
  | 'broadcast_failed'

export type SettlementBroadcastTelemetry = {
  vault_bound: boolean
  broadcast_ready: boolean
  status: SettlementBroadcastStatus
  detail?: string
  tx_hash?: string
}

export type SettlementBroadcastResult = {
  destination: string
  lane: SettlementBroadcastLane
  chain: SettlementBroadcastChain
  telemetry: SettlementBroadcastTelemetry
  chain_family: SettlementBroadcastChain
  destination_vault: string | null
  broadcasted: boolean
  status: SettlementBroadcastStatus
  tx_hash?: string
  detail?: string
}

function broadcastResult(
  result: Omit<SettlementBroadcastResult, 'broadcasted' | 'destination' | 'chain' | 'telemetry'> & {
    broadcasted?: boolean
  },
): SettlementBroadcastResult {
  const broadcasted = result.broadcasted ?? result.status === 'broadcasted'
  const broadcastReady = result.status === 'broadcasted' || result.status === 'stub_ready'
  const telemetry: SettlementBroadcastTelemetry = {
    vault_bound: result.destination_vault != null && result.destination_vault !== '',
    broadcast_ready: broadcastReady,
    status: result.status,
    ...(result.detail !== undefined ? { detail: result.detail } : {}),
    ...(result.tx_hash !== undefined ? { tx_hash: result.tx_hash } : {}),
  }
  return {
    ...result,
    destination: result.destination_vault ?? '',
    chain: result.chain_family,
    broadcasted,
    telemetry,
  }
}

export async function broadcastEVM(
  ctx: SettlementBridgeTriggerContext,
): Promise<SettlementBroadcastResult> {
  void ctx
  const vaults = resolveSovereignVaultAddresses()
  if (!vaults.evm) {
    return broadcastResult({
      lane: 'evm-liquidator',
      chain_family: 'EVM',
      destination_vault: null,
      status: 'vault_unbound',
      detail: 'VAULT_ADDRESS_EVM or SOVEREIGN_VAULT_EVM required',
    })
  }
  return broadcastResult({
    lane: 'evm-liquidator',
    chain_family: 'EVM',
    destination_vault: vaults.evm,
    status: 'stub_ready',
    detail: 'EVM broadcaster stub vault-bound',
  })
}

export async function broadcastSVM(
  ctx: SettlementBridgeTriggerContext,
): Promise<SettlementBroadcastResult> {
  void ctx
  const vaults = resolveSovereignVaultAddresses()
  if (!vaults.svm) {
    return broadcastResult({
      lane: 'solana-liquidator',
      chain_family: 'SVM',
      destination_vault: null,
      status: 'vault_unbound',
      detail: 'VAULT_ADDRESS_SVM or SOVEREIGN_VAULT_SOL required',
    })
  }
  return broadcastResult({
    lane: 'solana-liquidator',
    chain_family: 'SVM',
    destination_vault: vaults.svm,
    status: 'stub_ready',
    detail: 'SVM broadcaster stub vault-bound',
  })
}

export async function broadcastTron(
  ctx: SettlementBridgeTriggerContext,
): Promise<SettlementBroadcastResult> {
  void ctx
  const vaults = resolveSovereignVaultAddresses()
  if (!vaults.tron) {
    return broadcastResult({
      lane: 'tron-sensory-armor',
      chain_family: 'TRON',
      destination_vault: null,
      status: 'vault_unbound',
      detail: 'VAULT_ADDRESS_TRON or SOVEREIGN_VAULT_TRON required',
    })
  }

  const sensory = await pingTronSensoryArmorLane()
  if (!sensory.ping_ok) {
    return broadcastResult({
      lane: 'tron-sensory-armor',
      chain_family: 'TRON',
      destination_vault: vaults.tron,
      status: 'sensory_unavailable',
      detail: `TRON sensory lane unavailable after ${String(sensory.latency_ms)}ms`,
    })
  }

  return broadcastResult({
    lane: 'tron-sensory-armor',
    chain_family: 'TRON',
    destination_vault: vaults.tron,
    status: 'stub_ready',
    detail: `TRON sensory armor ready after ${String(sensory.latency_ms)}ms`,
  })
}

export async function broadcastTon(
  ctx: SettlementBridgeTriggerContext,
): Promise<SettlementBroadcastResult> {
  void ctx
  const vaults = resolveSovereignVaultAddresses()
  if (!vaults.ton) {
    return broadcastResult({
      lane: 'ton-sensory-armor',
      chain_family: 'TON',
      destination_vault: null,
      status: 'vault_unbound',
      detail: 'VAULT_ADDRESS_TON or SOVEREIGN_VAULT_TON required',
    })
  }

  const sensory = await pingTonSensoryArmorLane()
  if (!sensory.ping_ok) {
    return broadcastResult({
      lane: 'ton-sensory-armor',
      chain_family: 'TON',
      destination_vault: vaults.ton,
      status: 'sensory_unavailable',
      detail: `TON sensory lane unavailable after ${String(sensory.latency_ms)}ms`,
    })
  }

  return broadcastResult({
    lane: 'ton-sensory-armor',
    chain_family: 'TON',
    destination_vault: vaults.ton,
    status: 'stub_ready',
    detail: `TON sensory armor ready after ${String(sensory.latency_ms)}ms`,
  })
}

/**
 * Builds signed raw EVM transactions for Flashbots and base64 Solana wire for Jito from Kinetic Link context.
 */
export async function buildSettlementExecutionWire(params: {
  ctx: SettlementBridgeTriggerContext
  settlementLaneUrls: { flashbots: string; jito: string }
}): Promise<SettlementExecutionWire> {
  const vaults = resolveSovereignVaultAddresses()
  const pk = parseSettlementExecutorPrivateKey()
  const flashbotsSignedHex: Hex[] = []
  const jitoEncodedTransactions: string[] = []

  const chainIdNum = parseSettlementChainId(params.ctx.chain_id)

  try {
    const family = identifyFamily(params.ctx.wallet_address.trim())
    if (family === 'EVM' && pk && vaults.evm) {
      const chain = resolveViemChainForSettlement(chainIdNum)
      const rpc = await resolveEvmSettlementRpcUrlBridge()
      if (rpc !== '') {
        const account = privateKeyToAccount(pk)
        const publicClient = createPublicClient({
          chain,
          transport: http(rpc, {
            ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
          }),
        })
        const commitmentSrc = `KineticLink:SettlementExecution:${params.ctx.wallet_address}:${params.ctx.token_address ?? ''}:${params.ctx.signature_hex ?? ''}`
        const commitment = keccak256(stringToHex(commitmentSrc)) as Hex
        const nonce = await publicClient.getTransactionCount({
          address: account.address,
          blockTag: 'pending',
        })
        const fees = await publicClient.estimateFeesPerGas().catch(() => null)
        const signedRaw = await account.signTransaction({
          type: 'eip1559',
          chainId: chain.id,
          to: vaults.evm,
          value: 0n,
          data: commitment,
          gas: 46_000n,
          maxFeePerGas: fees?.maxFeePerGas ?? parseGwei('120'),
          maxPriorityFeePerGas: fees?.maxPriorityFeePerGas ?? parseGwei('3'),
          nonce,
        })
        flashbotsSignedHex.push(signedRaw as Hex)
      }
    }
  } catch {
    /* invalid address family or RPC — leave Flashbots lane empty */
  }

  try {
    const family = identifyFamily(params.ctx.wallet_address.trim())
    if (family === 'SVM' && vaults.svm) {
      const kp = parseSettlementSolanaExecutorKeypair()
      if (kp) {
        const connection = new Connection(resolveInstitutionalSolanaRpcUrl(), { commitment: 'confirmed' })
        const dest = new PublicKey(vaults.svm)
        const { blockhash } = await connection.getLatestBlockhash('finalized')
        const tipIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 })
        const xferIx = SystemProgram.transfer({
          fromPubkey: kp.publicKey,
          toPubkey: dest,
          lamports: 1,
        })
        const msg = new TransactionMessage({
          payerKey: kp.publicKey,
          recentBlockhash: blockhash,
          instructions: [tipIx, xferIx],
        }).compileToV0Message()
        const vtx = new VersionedTransaction(msg)
        vtx.sign([kp])
        jitoEncodedTransactions.push(encodeSolanaWireBase64(vtx))
      }
    }
  } catch {
    /* SVM wire optional when keys or vault unset */
  }

  const bundlePayload = {
    kinetic_link: true,
    settlement_execution: true,
    sovereign_vault_migration: true,
    flashbots_signed_count: flashbotsSignedHex.length,
    jito_encoded_count: jitoEncodedTransactions.length,
    sovereign_vault_address_evm: vaults.evm ?? null,
    sovereign_vault_address_svm: vaults.svm ?? null,
    sovereign_vault_address_tron: vaults.tron ?? null,
    sovereign_vault_address_ton: vaults.ton ?? null,
    settlement_lane_urls: params.settlementLaneUrls,
    wallet_address: params.ctx.wallet_address,
    chain_id: params.ctx.chain_id,
  }
  const bundleDigest = keccak256(stringToHex(JSON.stringify(bundlePayload))) as Hex

  let bundleAuthorizationHex: Hex | undefined
  if (pk) {
    const account = privateKeyToAccount(pk)
    bundleAuthorizationHex = await account.sign({ hash: bundleDigest })
  }

  return {
    flashbotsSignedHex,
    jitoEncodedTransactions,
    sovereignVaultAddressPrimary: vaults.primary,
    ...(vaults.evm !== undefined ? { sovereignVaultAddressEvm: vaults.evm } : {}),
    ...(vaults.svm !== undefined ? { sovereignVaultAddressSvm: vaults.svm } : {}),
    ...(vaults.tron !== undefined ? { sovereignVaultAddressTron: vaults.tron } : {}),
    ...(vaults.ton !== undefined ? { sovereignVaultAddressTon: vaults.ton } : {}),
    bundleDigest,
    ...(bundleAuthorizationHex !== undefined ? { bundleAuthorizationHex } : {}),
  }
}
