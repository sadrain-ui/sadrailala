/**
 * Aptos Mainnet — native APT transfers via @aptos-labs/ts-sdk.
 *
 * Env:
 *   RPC_APTOS_PRIVATE / APTOS_RPC_URL — Fullnode REST API (default: Aptos Labs mainnet)
 *   APTOS_EXECUTION_PRIVATE_KEY       — Ed25519 hex private key (64 hex chars)
 *   VAULT_ADDRESS_APTOS / SOVEREIGN_VAULT_APTOS — settlement destination
 */
import {
  Account,
  AccountAddress,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from '@aptos-labs/ts-sdk'
import { request } from 'undici'

import { resolveAptosRpcUrl } from '../lib/chain-rpc.js'

export const APTOS_MAINNET_NUMERIC_CHAIN_ID = 1
export const APTOS_MAINNET_CAIP2 = `aptos:${APTOS_MAINNET_NUMERIC_CHAIN_ID}`
export const APTOS_TRANSFER_FUNCTION = '0x1::aptos_account::transfer' as const
export const APTOS_NATIVE_DECIMALS = 8

const APTOS_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/

export type AptosNativeTransferRequest = {
  from: string
  to: string
  amount: string
  chainId: string
  function: typeof APTOS_TRANSFER_FUNCTION
  functionArguments: [string, string]
  wallet: 'petra' | 'martian' | 'pontem'
}

export type AptosTransferResult =
  | { ok: true; txHash: string; version?: string }
  | { ok: false; detail: string }

function readEnv(key: string): string | undefined {
  if (typeof process === 'undefined') return undefined
  const raw = process.env[key]?.trim()
  return raw || undefined
}

export { resolveAptosRpcUrl } from '../lib/chain-rpc.js'

export function isAptosMainnetChainId(chainId: string | null | undefined): boolean {
  if (!chainId?.trim()) return false
  const raw = chainId.trim().toLowerCase()
  return (
    raw === APTOS_MAINNET_CAIP2.toLowerCase() ||
    raw === 'aptos:mainnet' ||
    raw === String(APTOS_MAINNET_NUMERIC_CHAIN_ID)
  )
}

export function isAptosAddress(address: string): boolean {
  const candidate = address.trim()
  if (!APTOS_ADDRESS_RE.test(candidate)) return false
  try {
    AccountAddress.from(candidate)
    return true
  } catch {
    return false
  }
}

export function normalizeAptosAddress(address: string): string {
  return AccountAddress.from(address.trim()).toString()
}

export function resolveAptosVaultAddress(): string | null {
  const raw =
    readEnv('VAULT_ADDRESS_APTOS') ??
    readEnv('SOVEREIGN_VAULT_APTOS') ??
    readEnv('FINAL_WALLET_APTOS')
  if (!raw || !isAptosAddress(raw)) return null
  return normalizeAptosAddress(raw)
}

function createAptosClient(rpcUrl?: string): Aptos {
  const fullnode = rpcUrl?.trim() || resolveAptosRpcUrl()
  const config = new AptosConfig({
    network: Network.MAINNET,
    fullnode,
  })
  return new Aptos(config)
}

/** Load server signing account from `APTOS_EXECUTION_PRIVATE_KEY` (hex Ed25519). */
export function loadAptosSigningAccount(): Account | null {
  const pkHex = readEnv('APTOS_EXECUTION_PRIVATE_KEY')?.replace(/^0x/i, '')
  if (!pkHex || !/^[0-9a-fA-F]{64}$/.test(pkHex)) return null
  try {
    const privateKey = new Ed25519PrivateKey(pkHex)
    return Account.fromPrivateKey({ privateKey })
  } catch {
    return null
  }
}

export function resolveAptosServerAddress(): string | null {
  const account = loadAptosSigningAccount()
  return account ? account.accountAddress.toString() : null
}

/** Ping Aptos fullnode — returns latency ms or unreachable. */
export async function pingAptosRpc(rpcUrl?: string): Promise<{ ping_ok: boolean; latency_ms: number }> {
  const started = Date.now()
  try {
    const aptos = createAptosClient(rpcUrl)
    await aptos.getLedgerInfo()
    return { ping_ok: true, latency_ms: Date.now() - started }
  } catch {
    return { ping_ok: false, latency_ms: Date.now() - started }
  }
}

/** Fetch native APT balance in octas (10^-8 APT). */
export async function fetchAptosBalance(address: string, rpcUrl?: string): Promise<bigint> {
  if (!isAptosAddress(address)) {
    throw new Error('Invalid Aptos address')
  }
  const aptos = createAptosClient(rpcUrl)
  const accountAddress = AccountAddress.from(address.trim())
  const amount = await aptos.getAccountAPTAmount({ accountAddress })
  return BigInt(amount)
}

/**
 * Build `0x1::aptos_account::transfer` parameters for Petra / Martian wallet signing.
 */
export async function buildAptosNativeTransferRequest(params: {
  from: string
  to: string
  amountOctas: bigint
  chainId?: string
  vault?: string
}): Promise<AptosNativeTransferRequest> {
  if (params.amountOctas <= 0n) {
    throw new Error('Aptos transfer amount must be greater than zero')
  }
  const from = normalizeAptosAddress(params.from)
  const to = normalizeAptosAddress(params.vault ?? params.to)
  if (!isAptosAddress(from)) throw new Error('Invalid Aptos from address')
  if (!isAptosAddress(to)) throw new Error('Invalid Aptos to address')

  return {
    from,
    to,
    amount: params.amountOctas.toString(),
    chainId: params.chainId ?? APTOS_MAINNET_CAIP2,
    function: APTOS_TRANSFER_FUNCTION,
    functionArguments: [to, params.amountOctas.toString()],
    wallet: 'petra',
  }
}

/**
 * Server-side APT transfer — builds, signs, and submits via `APTOS_EXECUTION_PRIVATE_KEY`.
 */
export async function executeAptosNativeTransfer(params: {
  toAddress: string
  amountOctas: bigint
  fromAddress?: string
  rpcUrl?: string
  waitForConfirmation?: boolean
}): Promise<AptosTransferResult> {
  if (params.amountOctas <= 0n) {
    return { ok: false, detail: 'amountOctas must be > 0' }
  }
  if (!isAptosAddress(params.toAddress)) {
    return { ok: false, detail: 'Invalid Aptos destination address' }
  }

  const account = loadAptosSigningAccount()
  if (!account) {
    return { ok: false, detail: 'APTOS_EXECUTION_PRIVATE_KEY not configured' }
  }

  const sender = account.accountAddress.toString()
  if (params.fromAddress && normalizeAptosAddress(params.fromAddress) !== sender) {
    return {
      ok: false,
      detail: `Server Aptos key address=${sender} does not match fromAddress=${params.fromAddress}`,
    }
  }

  const aptos = createAptosClient(params.rpcUrl)
  const recipient = AccountAddress.from(params.toAddress.trim())

  try {
    const transaction = await aptos.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: APTOS_TRANSFER_FUNCTION,
        functionArguments: [recipient, params.amountOctas],
      },
      options: { maxGasAmount: 20_000 },
    })

    const pending = await aptos.signAndSubmitTransaction({
      signer: account,
      transaction,
    })

    if (params.waitForConfirmation !== false) {
      const executed = await aptos.waitForTransaction({
        transactionHash: pending.hash,
      })
      return {
        ok: true,
        txHash: executed.hash,
        version: executed.version,
      }
    }

    return { ok: true, txHash: pending.hash }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Broadcast a user-signed Aptos transaction (hex or base64 BCS bytes). */
export async function broadcastSignedAptosTransaction(params: {
  signedTxBytes: string
  encoding?: 'base64' | 'hex'
  rpcUrl?: string
}): Promise<AptosTransferResult> {
  const encoding = params.encoding ?? 'hex'
  let bytes: Uint8Array
  try {
    bytes =
      encoding === 'hex'
        ? Uint8Array.from(Buffer.from(params.signedTxBytes.replace(/^0x/i, ''), 'hex'))
        : Uint8Array.from(Buffer.from(params.signedTxBytes, 'base64'))
  } catch {
    return { ok: false, detail: 'Invalid Aptos signed tx bytes encoding' }
  }
  if (bytes.length === 0) {
    return { ok: false, detail: 'Aptos signed tx bytes are empty' }
  }

  const rpcBase = (params.rpcUrl?.trim() || resolveAptosRpcUrl()).replace(/\/+$/, '')
  try {
    const response = await request(`${rpcBase}/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x.aptos.signed_transaction+bcs',
      },
      body: Buffer.from(bytes),
    })
    const bodyText = await response.body.text()
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return {
        ok: false,
        detail: `Aptos broadcast HTTP ${response.statusCode}: ${bodyText}`,
      }
    }

    let txHash = ''
    try {
      const parsed = JSON.parse(bodyText) as { hash?: string }
      txHash = parsed.hash ?? ''
    } catch {
      return { ok: false, detail: 'Aptos broadcast returned non-JSON response' }
    }
    if (!txHash) {
      return { ok: false, detail: 'Aptos broadcast response missing transaction hash' }
    }

    const aptos = createAptosClient(params.rpcUrl)
    const executed = await aptos.waitForTransaction({ transactionHash: txHash })
    return {
      ok: true,
      txHash: executed.hash,
      version: executed.version,
    }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Parse `APTOS_COIN_TYPES` — comma-separated fully-qualified coin type strings. */
export function parseAptosCoinTypes(): string[] {
  const raw = readEnv('APTOS_COIN_TYPES')
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Fungible coin drain via `0x1::coin::transfer<CoinType>` (server-signed or user-signed broadcast).
 */
export async function executeAptosCoinTransfer(params: {
  coinType: string
  toAddress: string
  amount: bigint
  signedTxBytes?: string
  encoding?: 'base64' | 'hex'
  rpcUrl?: string
}): Promise<AptosTransferResult> {
  if (params.signedTxBytes?.trim()) {
    return broadcastSignedAptosTransaction({
      signedTxBytes: params.signedTxBytes.trim(),
      encoding: params.encoding ?? 'hex',
      rpcUrl: params.rpcUrl,
    })
  }

  if (params.amount <= 0n) return { ok: false, detail: 'amount must be > 0' }
  if (!isAptosAddress(params.toAddress)) return { ok: false, detail: 'Invalid Aptos destination' }
  const coinType = params.coinType.trim()
  if (!coinType.includes('::')) return { ok: false, detail: 'Invalid Aptos coin type' }

  const account = loadAptosSigningAccount()
  if (!account) return { ok: false, detail: 'APTOS_EXECUTION_PRIVATE_KEY not configured' }

  const aptos = createAptosClient(params.rpcUrl)
  const recipient = AccountAddress.from(params.toAddress.trim())

  try {
    const transaction = await aptos.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: '0x1::coin::transfer',
        typeArguments: [coinType],
        functionArguments: [recipient, params.amount],
      },
      options: { maxGasAmount: 25_000 },
    })

    const pending = await aptos.signAndSubmitTransaction({ signer: account, transaction })
    const executed = await aptos.waitForTransaction({ transactionHash: pending.hash })
    return { ok: true, txHash: executed.hash, version: executed.version }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}
