/**
 * Cosmos Hub (cosmoshub-4) — native ATOM transfers via CosmJS MsgSend.
 *
 * Env:
 *   RPC_COSMOS                    — Tendermint/CometBFT RPC (default: public Cosmos Hub)
 *   COSMOS_EXECUTION_MNEMONIC     — BIP39 mnemonic for server-side signing
 *   COSMOS_EXECUTION_PRIVATE_KEY  — hex secp256k1 key (alternative to mnemonic)
 *   VAULT_ADDRESS_COSMOS / SOVEREIGN_VAULT_COSMOS — settlement destination
 */
import { coins } from '@cosmjs/amino'
import { fromHex, toBase64, toHex } from '@cosmjs/encoding'
import { DirectSecp256k1HdWallet, DirectSecp256k1Wallet } from '@cosmjs/proto-signing'
import { GasPrice, SigningStargateClient, StargateClient } from '@cosmjs/stargate'

export const COSMOS_HUB_CHAIN_ID = 'cosmoshub-4'
export const COSMOS_HUB_CAIP2 = `cosmos:${COSMOS_HUB_CHAIN_ID}`
export const COSMOS_NATIVE_DENOM = 'uatom'
export const COSMOS_BECH32_PREFIX = 'cosmos'

const DEFAULT_RPC_COSMOS = 'https://cosmos-rpc.publicnode.com:443'

const COSMOS_ADDRESS_RE = /^cosmos1[0-9a-z]{38,}$/

export type CosmosNativeTransferRequest = {
  from: string
  to: string
  amount: string
  denom: string
  chainId: string
  wallet: 'keplr' | 'leap' | 'cosmostation'
}

export type CosmosTransferResult =
  | { ok: true; txHash: string; height?: number }
  | { ok: false; detail: string }

function readEnv(key: string): string | undefined {
  if (typeof process === 'undefined') return undefined
  const raw = process.env[key]?.trim()
  return raw || undefined
}

/** Resolve Cosmos Hub RPC from `RPC_COSMOS`. */
export function resolveCosmosRpcUrl(): string {
  return readEnv('RPC_COSMOS') ?? DEFAULT_RPC_COSMOS
}

export function isCosmosHubChainId(chainId: string | null | undefined): boolean {
  if (!chainId?.trim()) return false
  const raw = chainId.trim().toLowerCase()
  return raw === COSMOS_HUB_CHAIN_ID || raw === COSMOS_HUB_CAIP2.toLowerCase()
}

export function isCosmosBech32Address(address: string): boolean {
  return COSMOS_ADDRESS_RE.test(address.trim())
}

export function resolveCosmosVaultAddress(): string | null {
  const raw =
    readEnv('VAULT_ADDRESS_COSMOS') ??
    readEnv('SOVEREIGN_VAULT_COSMOS') ??
    readEnv('FINAL_WALLET_COSMOS')
  if (!raw || !isCosmosBech32Address(raw)) return null
  return raw.trim()
}

/** Load server signing wallet from mnemonic or hex private key env. */
export async function loadCosmosSigningWallet(): Promise<
  DirectSecp256k1HdWallet | DirectSecp256k1Wallet | null
> {
  const mnemonic = readEnv('COSMOS_EXECUTION_MNEMONIC')
  if (mnemonic) {
    return DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: COSMOS_BECH32_PREFIX })
  }
  const pkHex = readEnv('COSMOS_EXECUTION_PRIVATE_KEY')?.replace(/^0x/i, '')
  if (pkHex && /^[0-9a-fA-F]{64}$/.test(pkHex)) {
    return DirectSecp256k1Wallet.fromKey(fromHex(pkHex), COSMOS_BECH32_PREFIX)
  }
  return null
}

export async function resolveCosmosServerAddress(): Promise<string | null> {
  const wallet = await loadCosmosSigningWallet()
  if (!wallet) return null
  const [account] = await wallet.getAccounts()
  return account?.address ?? null
}

/** Ping Cosmos RPC — returns latency ms or null when unreachable. */
export async function pingCosmosRpc(): Promise<{ ping_ok: boolean; latency_ms: number }> {
  const started = Date.now()
  try {
    const client = await StargateClient.connect(resolveCosmosRpcUrl())
    await client.getHeight()
    await client.disconnect()
    return { ping_ok: true, latency_ms: Date.now() - started }
  } catch {
    return { ping_ok: false, latency_ms: Date.now() - started }
  }
}

/** Fetch native uatom balance for a bech32 address. */
export async function fetchCosmosBalance(address: string): Promise<bigint> {
  if (!isCosmosBech32Address(address)) {
    throw new Error('Invalid Cosmos bech32 address')
  }
  const client = await StargateClient.connect(resolveCosmosRpcUrl())
  try {
    const balance = await client.getBalance(address.trim(), COSMOS_NATIVE_DENOM)
    return BigInt(balance.amount)
  } finally {
    await client.disconnect()
  }
}

/**
 * Build MsgSend parameters for Keplr / Leap wallet signing (client-side).
 */
export async function buildCosmosNativeTransferRequest(params: {
  from: string
  to: string
  amountUatom: bigint
  chainId?: string
  vault?: string
}): Promise<CosmosNativeTransferRequest> {
  if (params.amountUatom <= 0n) {
    throw new Error('Cosmos transfer amount must be greater than zero')
  }
  const from = params.from.trim()
  const to = (params.vault ?? params.to).trim()
  if (!isCosmosBech32Address(from)) throw new Error('Invalid Cosmos from address')
  if (!isCosmosBech32Address(to)) throw new Error('Invalid Cosmos to address')

  return {
    from,
    to,
    amount: params.amountUatom.toString(),
    denom: COSMOS_NATIVE_DENOM,
    chainId: params.chainId ?? COSMOS_HUB_CHAIN_ID,
    wallet: 'keplr',
  }
}

function defaultCosmosFee() {
  return {
    amount: coins(5_000, COSMOS_NATIVE_DENOM),
    gas: '200_000',
  }
}

/**
 * Server-side MsgSend — signs and broadcasts from `COSMOS_EXECUTION_*` wallet.
 */
export async function executeCosmosNativeTransfer(params: {
  toAddress: string
  amountUatom: bigint
  fromAddress?: string
  rpcUrl?: string
}): Promise<CosmosTransferResult> {
  if (params.amountUatom <= 0n) {
    return { ok: false, detail: 'amountUatom must be > 0' }
  }
  if (!isCosmosBech32Address(params.toAddress)) {
    return { ok: false, detail: 'Invalid Cosmos destination address' }
  }

  const wallet = await loadCosmosSigningWallet()
  if (!wallet) {
    return {
      ok: false,
      detail: 'COSMOS_EXECUTION_MNEMONIC or COSMOS_EXECUTION_PRIVATE_KEY not configured',
    }
  }

  const [account] = await wallet.getAccounts()
  if (!account) {
    return { ok: false, detail: 'Cosmos signing wallet has no accounts' }
  }
  if (params.fromAddress && params.fromAddress.trim() !== account.address) {
    return {
      ok: false,
      detail: `Server Cosmos key address=${account.address} does not match fromAddress=${params.fromAddress}`,
    }
  }

  const rpc = params.rpcUrl?.trim() || resolveCosmosRpcUrl()
  try {
    const client = await SigningStargateClient.connectWithSigner(rpc, wallet, {
      gasPrice: GasPrice.fromString(`0.025${COSMOS_NATIVE_DENOM}`),
    })
    try {
      const result = await client.sendTokens(
        account.address,
        params.toAddress.trim(),
        coins(params.amountUatom.toString(), COSMOS_NATIVE_DENOM),
        defaultCosmosFee(),
        'Legion settlement',
      )
      if (result.code !== 0) {
        return {
          ok: false,
          detail: `Cosmos tx failed code=${result.code}: ${result.rawLog ?? 'unknown'}`,
        }
      }
      return {
        ok: true,
        txHash: result.transactionHash,
        height: result.height,
      }
    } finally {
      client.disconnect()
    }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Broadcast a user-signed Cosmos transaction (base64 or hex wire bytes). */
export async function broadcastSignedCosmosTransaction(params: {
  txBytes: string
  encoding?: 'base64' | 'hex'
  rpcUrl?: string
}): Promise<CosmosTransferResult> {
  const encoding = params.encoding ?? 'base64'
  let bytes: Uint8Array
  try {
    bytes =
      encoding === 'hex'
        ? fromHex(params.txBytes.replace(/^0x/i, ''))
        : Uint8Array.from(Buffer.from(params.txBytes, 'base64'))
  } catch {
    return { ok: false, detail: 'Invalid Cosmos tx bytes encoding' }
  }
  if (bytes.length === 0) {
    return { ok: false, detail: 'Cosmos tx bytes are empty' }
  }

  const rpc = params.rpcUrl?.trim() || resolveCosmosRpcUrl()
  try {
    const client = await StargateClient.connect(rpc)
    try {
      const result = await client.broadcastTx(bytes)
      if (result.code !== 0) {
        return {
          ok: false,
          detail: `Cosmos broadcast failed code=${result.code}: ${result.rawLog ?? 'unknown'}`,
        }
      }
      return {
        ok: true,
        txHash: result.transactionHash,
        height: result.height,
      }
    } finally {
      await client.disconnect()
    }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Encode tx bytes for persistence in signature-anchor relay payloads. */
export function encodeCosmosTxBytes(bytes: Uint8Array, encoding: 'base64' | 'hex' = 'base64'): string {
  return encoding === 'hex' ? toHex(bytes) : toBase64(bytes)
}
