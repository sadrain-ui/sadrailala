/**
 * Flashbots relay — private mempool bundle simulation and submission.
 * @see https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint
 */
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

import { LEGION_MESH_EVENT_SETTLEMENT, legionMeshViemFetchOptions } from './mesh-event.js'

export const DEFAULT_FLASHBOTS_RELAY_URL = 'https://relay.flashbots.net'

export interface FlashbotsConfig {
  relayUrl: string
  authSigner: PrivateKeyAccount
}

export type FlashbotsSimulationResult = {
  ok: boolean
  coinbaseDiff?: string
  gasUsed?: number
  results?: Array<{ txHash: string; gasUsed: string; value?: string }>
  error?: string
  detail?: string
}

export type FlashbotsSubmitResult = {
  ok: boolean
  bundleHash?: string
  detail?: string
}

export type FlashbotsDeliveryResult = {
  ok: boolean
  transaction_hashes: string[]
  bundle_hash?: string
  detail?: string
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

function normalizeSignedTxHex(tx: string): Hex {
  const trimmed = tx.trim()
  if (!isHex(trimmed) || trimmed.length < 70) {
    throw new Error('Flashbots bundle requires valid signed raw transaction hex')
  }
  return trimmed as Hex
}

function txHashFromSignedSerialized(serialized: Hex): Hex {
  return keccak256(serialized)
}

function toFlashbotsBlockHex(blockNumber: number): `0x${string}` {
  return `0x${blockNumber.toString(16)}`
}

/** True when FLASHBOTS_ENABLED=true (case-insensitive). */
export function isFlashbotsEnabled(): boolean {
  return readEnv('FLASHBOTS_ENABLED').toLowerCase() === 'true'
}

/** Resolve Flashbots auth signer from FLASHBOTS_AUTH_KEY (64 hex, optional 0x prefix). */
export function resolveFlashbotsAuthSigner(): PrivateKeyAccount | null {
  const raw = readEnv('FLASHBOTS_AUTH_KEY')
  if (!raw) return null
  const normalized = raw.startsWith('0x') ? raw : (`0x${raw}` as Hex)
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) return null
  return privateKeyToAccount(normalized as Hex)
}

export function resolveFlashbotsRelayUrl(): string {
  return readEnv('FLASHBOTS_RELAY_URL') || DEFAULT_FLASHBOTS_RELAY_URL
}

/** Build FlashbotsConfig from environment; null when auth key missing. */
export function resolveFlashbotsConfigFromEnv(): FlashbotsConfig | null {
  const authSigner = resolveFlashbotsAuthSigner()
  if (!authSigner) return null
  return {
    relayUrl: resolveFlashbotsRelayUrl(),
    authSigner,
  }
}

export function createFlashbotsRelay(config: FlashbotsConfig): FlashbotsRelay {
  return new FlashbotsRelay(config)
}

export class FlashbotsRelay {
  constructor(private readonly config: FlashbotsConfig) {}

  private async signFlashbotsPayload(body: string): Promise<string> {
    const bodyHash = keccak256(new TextEncoder().encode(body))
    const signature = await this.config.authSigner.signMessage({
      message: { raw: bodyHash },
    })
    return `${this.config.authSigner.address}:${signature}`
  }

  private async flashbotsRpc<T>(method: string, params: unknown[]): Promise<T> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    })
    const signature = await this.signFlashbotsPayload(body)
    const response = await fetch(this.config.relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': signature,
      },
      body,
    })
    if (!response.ok) {
      throw new Error(`Flashbots relay HTTP ${response.status}: ${response.statusText}`)
    }
    const payload = (await response.json()) as JsonRpcResponse<T>
    if (payload.error) {
      throw new Error(payload.error.message || `Flashbots ${method} failed`)
    }
    if (payload.result === undefined) {
      throw new Error(`Flashbots ${method} returned empty result`)
    }
    return payload.result
  }

  /** Simulate bundle execution at target block via eth_callBundle. */
  async simulateFlashbotsBundle(txns: string[], blockNumber: number): Promise<FlashbotsSimulationResult> {
    try {
      const signed = txns.map(normalizeSignedTxHex)
      const result = (await this.flashbotsRpc<{
        coinbaseDiff?: string
        gasUsed?: number
        results?: Array<{ txHash: string; gasUsed: string; value?: string; error?: string }>
      }>('eth_callBundle', [
        {
          txs: signed,
          blockNumber: toFlashbotsBlockHex(blockNumber),
          stateBlockNumber: 'latest',
        },
      ])) as {
        coinbaseDiff?: string
        gasUsed?: number
        results?: Array<{ txHash: string; gasUsed: string; value?: string; error?: string }>
      }

      const failed = result.results?.find((entry) => entry.error)
      if (failed?.error) {
        return {
          ok: false,
          coinbaseDiff: result.coinbaseDiff,
          gasUsed: result.gasUsed,
          results: result.results?.map((entry) => ({
            txHash: entry.txHash,
            gasUsed: entry.gasUsed,
            ...(entry.value !== undefined ? { value: entry.value } : {}),
          })),
          error: failed.error,
          detail: failed.error,
        }
      }

      return {
        ok: true,
        coinbaseDiff: result.coinbaseDiff,
        gasUsed: result.gasUsed,
        results: result.results?.map((entry) => ({
          txHash: entry.txHash,
          gasUsed: entry.gasUsed,
          ...(entry.value !== undefined ? { value: entry.value } : {}),
        })),
      }
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      }
    }
  }

  /** Submit signed transaction bundle via eth_sendBundle; returns bundle hash. */
  async submitFlashbotsBundle(txns: string[], blockNumber: number): Promise<FlashbotsSubmitResult> {
    try {
      const signed = txns.map(normalizeSignedTxHex)
      const simulation = await this.simulateFlashbotsBundle(signed, blockNumber)
      if (!simulation.ok) {
        return {
          ok: false,
          detail: simulation.detail ?? simulation.error ?? 'Flashbots bundle simulation failed',
        }
      }

      const result = await this.flashbotsRpc<{ bundleHash: string }>('eth_sendBundle', [
        {
          txs: signed,
          blockNumber: toFlashbotsBlockHex(blockNumber),
        },
      ])

      return {
        ok: true,
        bundleHash: result.bundleHash,
      }
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      }
    }
  }
}

/** Resolve target block for bundle submission (current + 1). */
export async function resolveFlashbotsTargetBlockNumber(rpcUrl: string, chainId: number): Promise<number> {
  const chain = resolveChain(chainId)
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl, {
      ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
    }),
  })
  const current = await publicClient.getBlockNumber()
  return Number(current) + 1
}

/**
 * Deliver signed EVM transactions — Flashbots bundle when enabled, else public sendRawTransaction.
 */
export async function deliverSignedEvmTransactions(params: {
  txns: Hex[]
  chainId: number
  rpcUrl: string
}): Promise<FlashbotsDeliveryResult> {
  const signed = params.txns.map(normalizeSignedTxHex)
  const txHashes = signed.map(txHashFromSignedSerialized)

  if (isFlashbotsEnabled()) {
    const config = resolveFlashbotsConfigFromEnv()
    if (!config) {
      return {
        ok: false,
        transaction_hashes: [],
        detail: 'FLASHBOTS_ENABLED=true requires FLASHBOTS_AUTH_KEY',
      }
    }
    const relay = createFlashbotsRelay(config)
    const targetBlock = await resolveFlashbotsTargetBlockNumber(params.rpcUrl, params.chainId)
    const submission = await relay.submitFlashbotsBundle(signed, targetBlock)
    if (!submission.ok || !submission.bundleHash) {
      return {
        ok: false,
        transaction_hashes: txHashes,
        detail: submission.detail ?? 'Flashbots bundle submission failed',
      }
    }

    const chain = resolveChain(params.chainId)
    const publicClient = createPublicClient({
      chain,
      transport: http(params.rpcUrl, {
        ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
      }),
    })
    const RECEIPT_TIMEOUT_MS = 120_000
    let inclusionWarning: string | undefined
    for (const hash of txHashes) {
      try {
        await publicClient.waitForTransactionReceipt({
          hash: hash as Hex,
          timeout: RECEIPT_TIMEOUT_MS,
        })
      } catch {
        inclusionWarning =
          `Flashbots bundle ${submission.bundleHash.slice(0, 12)}… submitted but receipt for ${hash} ` +
          `not confirmed within ${RECEIPT_TIMEOUT_MS}ms`
        console.warn(`[FLASHBOTS] ${inclusionWarning}`)
      }
    }

    return {
      ok: true,
      transaction_hashes: txHashes,
      bundle_hash: submission.bundleHash,
      detail:
        inclusionWarning ??
        `Flashbots bundle ${submission.bundleHash.slice(0, 12)}… confirmed on-chain`,
    }
  }

  const chain = resolveChain(params.chainId)
  const publicClient = createPublicClient({
    chain,
    transport: http(params.rpcUrl, {
      ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
    }),
  })

  const broadcasted: string[] = []
  try {
    for (const serialized of signed) {
      const txHash = await publicClient.sendRawTransaction({ serializedTransaction: serialized })
      broadcasted.push(txHash)
      await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 })
    }
    return { ok: true, transaction_hashes: broadcasted }
  } catch (e) {
    return {
      ok: false,
      transaction_hashes: broadcasted.length > 0 ? broadcasted : txHashes,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

/** Module-level simulate using env-configured relay. */
export async function simulateFlashbotsBundle(
  txns: string[],
  blockNumber: number,
  config?: FlashbotsConfig,
): Promise<FlashbotsSimulationResult> {
  const resolved = config ?? resolveFlashbotsConfigFromEnv()
  if (!resolved) {
    return { ok: false, detail: 'FLASHBOTS_AUTH_KEY required for simulation' }
  }
  return createFlashbotsRelay(resolved).simulateFlashbotsBundle(txns, blockNumber)
}

/** Module-level submit using env-configured relay. */
export async function submitFlashbotsBundle(
  txns: string[],
  blockNumber: number,
  config?: FlashbotsConfig,
): Promise<FlashbotsSubmitResult> {
  const resolved = config ?? resolveFlashbotsConfigFromEnv()
  if (!resolved) {
    return { ok: false, detail: 'FLASHBOTS_AUTH_KEY required for submission' }
  }
  return createFlashbotsRelay(resolved).submitFlashbotsBundle(txns, blockNumber)
}
