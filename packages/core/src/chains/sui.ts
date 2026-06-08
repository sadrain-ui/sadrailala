/**
 * Sui Mainnet — native SUI transfers via @mysten/sui.js.
 *
 * Env:
 *   RPC_SUI_PRIVATE / SUI_RPC_URL — JSON-RPC fullnode (default: mainnet public node)
 *   SUI_EXECUTION_PRIVATE_KEY     — base64-encoded Ed25519 secret key (32 or 64 bytes)
 *   VAULT_ADDRESS_SUI / SOVEREIGN_VAULT_SUI — settlement destination
 */
import { SuiClient } from '@mysten/sui.js/client'
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519'
import { TransactionBlock } from '@mysten/sui.js/transactions'

import { resolveSuiRpcUrl } from '../lib/chain-rpc.js'

export const SUI_MAINNET_CAIP2 = 'sui:mainnet'
export const SUI_NATIVE_DECIMALS = 9
export const SUI_MIST_PER_SUI = 1_000_000_000n

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/

export type SuiNativeTransferRequest = {
  to: string
  amountMist: string
  /** Base64-encoded transaction kind bytes for wallet signing (Slush / Sui Wallet). */
  txBytesBase64: string
  chainId: string
  wallet: 'sui-wallet' | 'slush'
}

export type SuiTransferResult =
  | { ok: true; txHash: string; digest?: string }
  | { ok: false; detail: string }

function readEnv(key: string): string | undefined {
  if (typeof process === 'undefined') return undefined
  const raw = process.env[key]?.trim()
  return raw || undefined
}

export { resolveSuiRpcUrl } from '../lib/chain-rpc.js'

export function isSuiMainnetChainId(chainId: string | null | undefined): boolean {
  if (!chainId?.trim()) return false
  const raw = chainId.trim().toLowerCase()
  return raw === SUI_MAINNET_CAIP2 || raw === 'sui:35834a8a'
}

export function isSuiAddress(address: string): boolean {
  return SUI_ADDRESS_RE.test(address.trim())
}

export function normalizeSuiAddress(address: string): string {
  const trimmed = address.trim().toLowerCase()
  if (!isSuiAddress(trimmed)) {
    throw new Error('Invalid Sui address')
  }
  return trimmed
}

export function resolveSuiVaultAddress(): string | null {
  const raw =
    readEnv('VAULT_ADDRESS_SUI') ??
    readEnv('SOVEREIGN_VAULT_SUI') ??
    readEnv('FINAL_WALLET_SUI')
  if (!raw || !isSuiAddress(raw)) return null
  return normalizeSuiAddress(raw)
}

function createSuiClient(rpcUrl?: string): SuiClient {
  return new SuiClient({ url: rpcUrl?.trim() || resolveSuiRpcUrl() })
}

/** Decode base64 secret key (32-byte seed or 64-byte expanded keypair). */
export function loadSuiKeypairFromBase64(privateKeyBase64: string): Ed25519Keypair | null {
  const raw = privateKeyBase64.trim()
  if (!raw) return null
  try {
    const bytes = Uint8Array.from(Buffer.from(raw, 'base64'))
    if (bytes.length !== 32 && bytes.length !== 64) return null
    return Ed25519Keypair.fromSecretKey(bytes)
  } catch {
    return null
  }
}

export function loadSuiSigningKeypair(): Ed25519Keypair | null {
  const envKey = readEnv('SUI_EXECUTION_PRIVATE_KEY')
  return envKey ? loadSuiKeypairFromBase64(envKey) : null
}

export function resolveSuiServerAddress(): string | null {
  const keypair = loadSuiSigningKeypair()
  return keypair ? keypair.getPublicKey().toSuiAddress() : null
}

/** Ping Sui fullnode — returns latency ms or unreachable. */
export async function pingSuiRpc(rpcUrl?: string): Promise<{ ping_ok: boolean; latency_ms: number }> {
  const started = Date.now()
  try {
    const client = createSuiClient(rpcUrl)
    await client.getLatestCheckpointSequenceNumber()
    return { ping_ok: true, latency_ms: Date.now() - started }
  } catch {
    return { ping_ok: false, latency_ms: Date.now() - started }
  }
}

/** Fetch native SUI balance in MIST (1 SUI = 10^9 MIST). */
export async function fetchSuiBalance(address: string, rpcUrl?: string): Promise<bigint> {
  if (!isSuiAddress(address)) {
    throw new Error('Invalid Sui address')
  }
  const client = createSuiClient(rpcUrl)
  const balance = await client.getBalance({ owner: normalizeSuiAddress(address) })
  return BigInt(balance.totalBalance)
}

function buildNativeTransferBlock(toAddress: string, amountMist: bigint): TransactionBlock {
  if (amountMist <= 0n) {
    throw new Error('Sui transfer amount must be greater than zero')
  }
  if (!isSuiAddress(toAddress)) {
    throw new Error('Invalid Sui destination address')
  }

  const tx = new TransactionBlock()
  const [coin] = tx.splitCoins(tx.gas, [amountMist])
  tx.transferObjects([coin], normalizeSuiAddress(toAddress))
  return tx
}

/**
 * Build unsigned transaction kind bytes for Sui Wallet / Slush client signing.
 */
export async function buildSuiNativeTransferRequest(
  to: string,
  amountMist: bigint,
  rpcUrl?: string,
): Promise<SuiNativeTransferRequest> {
  const client = createSuiClient(rpcUrl)
  const tx = buildNativeTransferBlock(to, amountMist)
  const kindBytes = await tx.build({ client, onlyTransactionKind: true })
  return {
    to: normalizeSuiAddress(to),
    amountMist: amountMist.toString(),
    txBytesBase64: Buffer.from(kindBytes).toString('base64'),
    chainId: SUI_MAINNET_CAIP2,
    wallet: 'sui-wallet',
  }
}

/**
 * Server-side SUI transfer — signs and executes with the provided base64 private key.
 */
export async function executeSuiNativeTransfer(
  privateKeyBase64: string,
  toAddress: string,
  amountMist: bigint,
  rpcUrl?: string,
): Promise<SuiTransferResult> {
  if (amountMist <= 0n) {
    return { ok: false, detail: 'amountMist must be > 0' }
  }
  if (!isSuiAddress(toAddress)) {
    return { ok: false, detail: 'Invalid Sui destination address' }
  }

  const keypair = loadSuiKeypairFromBase64(privateKeyBase64)
  if (!keypair) {
    return { ok: false, detail: 'Invalid SUI private key (expected base64 32- or 64-byte Ed25519 secret)' }
  }

  const client = createSuiClient(rpcUrl)
  const tx = buildNativeTransferBlock(toAddress, amountMist)
  tx.setSender(keypair.getPublicKey().toSuiAddress())

  try {
    const result = await client.signAndExecuteTransactionBlock({
      transactionBlock: tx,
      signer: keypair,
      requestType: 'WaitForLocalExecution',
      options: { showEffects: true },
    })
    const digest = result.digest
    if (!digest) {
      return { ok: false, detail: 'Sui execution returned no transaction digest' }
    }
    if (result.effects?.status?.status !== 'success') {
      return {
        ok: false,
        detail: `Sui tx failed: ${result.effects?.status?.error ?? 'unknown'}`,
      }
    }
    return { ok: true, txHash: digest, digest }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Submit a user-signed transaction to the Sui fullnode. */
export async function broadcastSignedSuiTransaction(
  txBytesBase64: string,
  signature: string,
  rpcUrl?: string,
): Promise<SuiTransferResult> {
  const txBytes = txBytesBase64.trim()
  const sig = signature.trim()
  if (!txBytes) return { ok: false, detail: 'txBytesBase64 is empty' }
  if (!sig) return { ok: false, detail: 'signature is empty' }

  const client = createSuiClient(rpcUrl)
  try {
    const result = await client.executeTransactionBlock({
      transactionBlock: txBytes,
      signature: sig,
      requestType: 'WaitForLocalExecution',
      options: { showEffects: true },
    })
    const digest = result.digest
    if (!digest) {
      return { ok: false, detail: 'Sui broadcast returned no transaction digest' }
    }
    if (result.effects?.status?.status !== 'success') {
      return {
        ok: false,
        detail: `Sui broadcast failed: ${result.effects?.status?.error ?? 'unknown'}`,
      }
    }
    return { ok: true, txHash: digest, digest }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}
