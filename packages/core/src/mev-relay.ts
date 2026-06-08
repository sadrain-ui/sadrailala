/**
 * MEV relay — private transaction submission with public-RPC fallback.
 *
 * EVM: `eth_sendPrivateTransaction` via Protect / MEV relay RPC (maxBlock window).
 * Solana: Jito `sendBundle` when `chainId === SOLANA_MEV_CHAIN_ID` (101).
 *
 * Env:
 *   MEV_PROTECT=true|false
 *   MEV_RELAY_URL          — primary EVM private-tx RPC (e.g. https://rpc.flashbots.net)
 *   FLASHBOTS_RELAY_URL    — legacy relay URL; mapped to Protect RPC when relay host
 *   MEV_MAX_BLOCK_AHEAD    — maxBlock offset for eth_sendPrivateTransaction (default 25)
 *   JITO_BLOCK_ENGINE_URL / JITO_SETTLEMENT_LANE_URL / MEV_JITO_URL — Solana private lane
 */
import { Connection } from '@solana/web3.js'
import type { Hex, PrivateKeyAccount } from 'viem'
import {
  createPublicClient,
  http,
  isHex,
  keccak256,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, mainnet, optimism, polygon, sepolia } from 'viem/chains'

import { resolveInstitutionalSolanaRpcUrl } from './adapters/svm-adapter.js'
import { getRpcUrlForChainWithFallback } from './lib/chain-rpc.js'
import { getJitoSettlementLaneUrl } from './logic/algorithmic-closer.js'
import { LEGION_MESH_EVENT_SETTLEMENT, legionMeshViemFetchOptions } from './logic/mesh-event.js'
import {
  DEFAULT_FLASHBOTS_RELAY_URL,
  resolveFlashbotsAuthSigner,
} from './logic/flashbots-relay.js'

export const DEFAULT_MEV_PROTECT_RPC = 'https://rpc.flashbots.net'
export const DEFAULT_JITO_BUNDLE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles'
/** Pass as `chainId` to {@link submitPrivateTransaction} for Solana / Jito ingress. */
export const SOLANA_MEV_CHAIN_ID = 101

export type MevRelayConfig = {
  mevProtect: boolean
  evmRelayUrl: string | null
  jitoBundleUrl: string | null
  maxBlockAhead: number
}

type JsonRpcResponse<T> = {
  jsonrpc: '2.0'
  id: number
  result?: T
  error?: { code: number; message: string; data?: unknown }
}

function readEnv(key: string): string {
  if (typeof process === 'undefined') return ''
  return process.env[key]?.trim() ?? ''
}

function resolveChain(chainId: number): Chain {
  const map: Record<number, Chain> = {
    1: mainnet,
    137: polygon,
    42161: arbitrum,
    8453: base,
    10: optimism,
    11155111: sepolia,
  }
  return map[chainId] ?? mainnet
}

function normalizeRawTxHex(rawTxHex: string): Hex {
  const trimmed = rawTxHex.trim()
  if (!isHex(trimmed) || trimmed.length < 70) {
    throw new Error('submitPrivateTransaction requires valid signed raw transaction hex')
  }
  return trimmed as Hex
}

function txHashFromSerialized(serialized: Hex): Hex {
  return keccak256(serialized)
}

/** True when MEV_PROTECT is true / 1 / yes (case-insensitive). */
export function isMevProtectEnabled(): boolean {
  const v = readEnv('MEV_PROTECT').toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

function resolveMaxBlockAhead(): number {
  const raw = Number(readEnv('MEV_MAX_BLOCK_AHEAD'))
  return Number.isFinite(raw) && raw > 0 && raw <= 100 ? Math.floor(raw) : 25
}

/**
 * Map relay host to Protect RPC when needed — `relay.flashbots.net` serves bundles,
 * while `eth_sendPrivateTransaction` lives on the Protect RPC plane.
 */
export function resolveEvmPrivateRelayUrl(): string | null {
  if (!isMevProtectEnabled()) return null

  const mevRelay = readEnv('MEV_RELAY_URL')
  if (mevRelay) return mevRelay

  const flashbotsRelay = readEnv('FLASHBOTS_RELAY_URL') || DEFAULT_FLASHBOTS_RELAY_URL
  if (flashbotsRelay.includes('relay.flashbots.net')) {
    return readEnv('PRIVACY_RPC_EVM_URL') || readEnv('FLASHBOTS_PROTECT_RPC_URL') || DEFAULT_MEV_PROTECT_RPC
  }

  if (flashbotsRelay) return flashbotsRelay

  return readEnv('PRIVACY_RPC_EVM_URL') || DEFAULT_MEV_PROTECT_RPC
}

export function resolveJitoBundleUrl(): string | null {
  if (!isMevProtectEnabled()) return null
  const explicit =
    readEnv('MEV_JITO_URL') ||
    readEnv('JITO_BLOCK_ENGINE_URL') ||
    readEnv('JITO_SETTLEMENT_LANE_URL') ||
    getJitoSettlementLaneUrl()
  if (explicit) {
    return explicit.includes('/api/v1/bundles') ? explicit : `${explicit.replace(/\/+$/, '')}/api/v1/bundles`
  }
  return DEFAULT_JITO_BUNDLE_URL
}

export function resolveMevRelayConfig(): MevRelayConfig {
  return {
    mevProtect: isMevProtectEnabled(),
    evmRelayUrl: resolveEvmPrivateRelayUrl(),
    jitoBundleUrl: resolveJitoBundleUrl(),
    maxBlockAhead: resolveMaxBlockAhead(),
  }
}

async function flashbotsSignPayload(body: string, authSigner: PrivateKeyAccount): Promise<string> {
  const bodyHash = keccak256(new TextEncoder().encode(body))
  const signature = await authSigner.signMessage({ message: { raw: bodyHash } })
  return `${authSigner.address}:${signature}`
}

async function jsonRpcPost<T>(
  url: string,
  method: string,
  params: unknown[],
  headers?: Record<string, string>,
): Promise<T> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  })
  if (!response.ok) {
    throw new Error(`MEV relay HTTP ${response.status}: ${response.statusText}`)
  }
  const payload = (await response.json()) as JsonRpcResponse<T>
  if (payload.error) {
    throw new Error(payload.error.message || `MEV relay ${method} failed`)
  }
  if (payload.result === undefined) {
    throw new Error(`MEV relay ${method} returned empty result`)
  }
  return payload.result
}

async function resolveMaxBlockNumber(rpcUrl: string, chainId: number, ahead: number): Promise<number> {
  const chain = resolveChain(chainId)
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl, {
      ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
    }),
  })
  const current = await client.getBlockNumber()
  return Number(current) + ahead
}

async function ethSendPrivateTransaction(params: {
  relayUrl: string
  serializedTx: Hex
  chainId: number
  maxBlockAhead: number
}): Promise<string> {
  const publicRpc = getRpcUrlForChainWithFallback(params.chainId)
  const maxBlock = await resolveMaxBlockNumber(publicRpc, params.chainId, params.maxBlockAhead)

  const rpcParams = {
    tx: params.serializedTx,
    maxBlockNumber: `0x${maxBlock.toString(16)}`,
  }

  const authSigner = resolveFlashbotsAuthSigner()
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendPrivateTransaction',
    params: [rpcParams],
  })

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authSigner && params.relayUrl.includes('relay.flashbots.net')) {
    headers['X-Flashbots-Signature'] = await flashbotsSignPayload(body, authSigner)
  }

  const response = await fetch(params.relayUrl, { method: 'POST', headers, body })
  if (!response.ok) {
    throw new Error(`eth_sendPrivateTransaction HTTP ${response.status}`)
  }
  const payload = (await response.json()) as JsonRpcResponse<string>
  if (payload.error) {
    throw new Error(payload.error.message || 'eth_sendPrivateTransaction failed')
  }
  if (typeof payload.result === 'string' && payload.result.startsWith('0x')) {
    return payload.result
  }
  return txHashFromSerialized(params.serializedTx)
}

async function publicSendRawTransaction(serializedTx: Hex, chainId: number): Promise<string> {
  const rpcUrl = getRpcUrlForChainWithFallback(chainId)
  const chain = resolveChain(chainId)
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl, {
      ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
    }),
  })
  return client.sendRawTransaction({ serializedTransaction: serializedTx })
}

/**
 * Submit a signed Solana transaction via Jito `sendBundle` (base64 wire).
 * Returns the transaction signature (base58) when derivable, else bundle id.
 */
export async function submitPrivateSolanaTransaction(
  rawTxWire: string | Uint8Array,
): Promise<string> {
  const config = resolveMevRelayConfig()
  const bytes =
    typeof rawTxWire === 'string'
      ? rawTxWire.trim().startsWith('0x')
        ? Uint8Array.from(Buffer.from(rawTxWire.trim().slice(2), 'hex'))
        : Uint8Array.from(Buffer.from(rawTxWire, 'base64'))
      : rawTxWire

  let txSig: string | null = null
  try {
    const { VersionedTransaction } = await import('@solana/web3.js')
    const tx = VersionedTransaction.deserialize(bytes)
    if (tx.signatures[0]) {
      const nonzero = tx.signatures[0].some((b) => b !== 0)
      if (nonzero) {
        txSig = (await import('@scure/base')).base58.encode(tx.signatures[0])
      }
    }
  } catch {
    // fall through — Jito may still accept wire
  }

  if (config.mevProtect && config.jitoBundleUrl) {
    try {
      const b64 = Buffer.from(bytes).toString('base64')
      const bundleId = await jsonRpcPost<string>(config.jitoBundleUrl, 'sendBundle', [[b64]])
      if (txSig) return txSig
      if (typeof bundleId === 'string' && bundleId.length > 0) return bundleId
    } catch (e) {
      console.warn(
        '[MEV_RELAY] Jito sendBundle failed, falling back to public RPC:',
        e instanceof Error ? e.message : String(e),
      )
    }
  }

  const rpc = resolveInstitutionalSolanaRpcUrl() || 'https://api.mainnet-beta.solana.com'
  const connection = new Connection(rpc, { commitment: 'confirmed' })
  const sig = await connection.sendRawTransaction(bytes, {
    preflightCommitment: 'confirmed',
    skipPreflight: false,
    maxRetries: 3,
  })
  return sig
}

/**
 * Submit a private transaction with MEV protection, falling back to public broadcast.
 *
 * @param rawTxHex — signed raw transaction (EVM hex) or base64/hex wire when `chainId === 101` (Solana)
 * @param chainId — EVM chain id (1, 137, …) or {@link SOLANA_MEV_CHAIN_ID} for Jito
 * @returns transaction hash (EVM) or signature / bundle id (Solana)
 */
export async function submitPrivateTransaction(
  rawTxHex: string,
  chainId: number,
): Promise<string> {
  if (chainId === SOLANA_MEV_CHAIN_ID) {
    return submitPrivateSolanaTransaction(rawTxHex)
  }

  const serialized = normalizeRawTxHex(rawTxHex)
  const config = resolveMevRelayConfig()

  if (config.mevProtect && config.evmRelayUrl) {
    try {
      const hash = await ethSendPrivateTransaction({
        relayUrl: config.evmRelayUrl,
        serializedTx: serialized,
        chainId,
        maxBlockAhead: config.maxBlockAhead,
      })
      return hash
    } catch (e) {
      console.warn(
        '[MEV_RELAY] eth_sendPrivateTransaction failed, falling back to public RPC:',
        e instanceof Error ? e.message : String(e),
      )
    }
  }

  return publicSendRawTransaction(serialized, chainId)
}
