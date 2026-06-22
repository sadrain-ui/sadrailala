// @ts-nocheck
/**
 * Server-side chain execution — autonomous signing & broadcast for SOL, TRX/TRC-20, TON, and BTC.
 *
 * Enabled when SERVER_SIDE_CHAIN_EXECUTION=true. Each chain requires its own key env var.
 * DRY_RUN=true skips broadcast in non-production (logs only).
 * NODE_ENV=production always broadcasts — DRY_RUN is ignored.
 *
 * Key env vars:
 *   SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY  — base58 64-byte keypair
 *   TRON_EXECUTION_PRIVATE_KEY              — 64 hex chars
 *   TON_EXECUTION_MNEMONIC                  — 24-word BIP39 mnemonic
 *   BITCOIN_EXECUTION_WIF                   — WIF-encoded private key
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { createHash } from 'node:crypto'
import { base58, base58check as base58checkFactory } from '@scure/base'
import { TronWeb } from 'tronweb'

/** Bitcoin WIF decoder using @scure/base v2 factory pattern. */
function decodeBase58Check(wif: string): Uint8Array {
  const sha256 = (data: Uint8Array): Uint8Array =>
    new Uint8Array(createHash('sha256').update(Buffer.from(data)).digest())
  return base58checkFactory(sha256).decode(wif)
}
import { Address as TonAddress, beginCell, internal, toNano, WalletContractV4 } from '@ton/ton'
import { address as btcAddress, initEccLib, networks, payments, Psbt } from 'bitcoinjs-lib'
import * as ecc from 'tiny-secp256k1'

import { resolveTonCenterJsonRpcUrl, tonCenterApiHeaders } from './ton-sensory-armor.js'
import { resolveTronSensoryFullHost, tronProApiHeaders } from './tron-sensory-armor.js'
import { resolveInstitutionalSolanaRpcUrl } from '../adapters/svm-adapter.js'
import { buildBitcoinDrainPsbt } from './bitcoin-drain.js'
import {
  isConfirmationPollingEnabled,
  pollSolanaConfirmation,
  pollTronConfirmation,
  pollTonSeqnoAdvance,
  pollBtcConfirmation,
} from './tx-confirmation-poller.js'

// ── Feature flags ──────────────────────────────────────────────────────────────

export function isServerSideChainExecutionEnabled(): boolean {
  const v = process.env['SERVER_SIDE_CHAIN_EXECUTION']?.trim().toLowerCase()
  return v === 'true' || v === '1'
}

/** Returns true only in non-production when DRY_RUN=true|1. Production always executes real txs. */
export function isDryRunExecution(): boolean {
  if (process.env['NODE_ENV']?.trim().toLowerCase() === 'production') return false
  const v = process.env['DRY_RUN']?.trim().toLowerCase()
  return v === 'true' || v === '1'
}

// ── Solana ────────────────────────────────────────────────────────────────────

/** Decode base58 Solana 64-byte keypair from SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY. */
export function loadServerSolanaKeypair(): Keypair | null {
  const raw = process.env['SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY']?.trim()
  if (!raw) return null
  try {
    const decoded = base58.decode(raw)
    if (decoded.length === 64) {
      return Keypair.fromSecretKey(decoded)
    }
    // JSON array fallback: [0,1,2,...63]
    if (raw.startsWith('[')) {
      const arr = JSON.parse(raw) as number[]
      return Keypair.fromSecretKey(Uint8Array.from(arr))
    }
    return null
  } catch {
    return null
  }
}

export function resolveServerSolanaPublicKey(): string | null {
  const kp = loadServerSolanaKeypair()
  return kp ? kp.publicKey.toBase58() : null
}

export type ServerSolResult =
  | { ok: true; txSig: string; warning?: string }
  | { ok: false; detail: string }

/**
 * Sign and broadcast a native SOL transfer from the server Solana keypair.
 * `fromWallet` must equal the keypair's public key.
 */
export async function executeServerSolNativeTransfer(params: {
  fromWallet: string
  toVault: string
  lamports: bigint
  rpcUrl?: string
}): Promise<ServerSolResult> {
  if (isDryRunExecution()) {
    return { ok: true, txSig: 'dry-run-sol-' + Date.now() }
  }
  const keypair = loadServerSolanaKeypair()
  if (!keypair) {
    return { ok: false, detail: 'SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY not configured' }
  }
  if (keypair.publicKey.toBase58() !== params.fromWallet) {
    return {
      ok: false,
      detail: `Server SOL key pubkey=${keypair.publicKey.toBase58()} does not match fromWallet=${params.fromWallet}`,
    }
  }
  if (params.lamports <= 0n) {
    return { ok: false, detail: 'lamports must be > 0' }
  }
  const rpc =
    params.rpcUrl?.trim() ||
    resolveInstitutionalSolanaRpcUrl() ||
    'https://api.mainnet-beta.solana.com'
  try {
    const connection = new Connection(rpc, { commitment: 'confirmed' })
    const { blockhash } = await connection.getLatestBlockhash('finalized')
    const msg = new TransactionMessage({
      payerKey: keypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: new PublicKey(params.toVault),
          lamports: Number(params.lamports),
        }),
      ],
    }).compileToV0Message()
    const tx = new VersionedTransaction(msg)
    tx.sign([keypair])
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      preflightCommitment: 'confirmed',
      skipPreflight: false,
      maxRetries: 3,
    })

    if (isConfirmationPollingEnabled()) {
      const outcome = await pollSolanaConfirmation(sig, rpc)
      if (outcome.status === 'failed') {
        return { ok: false, detail: `broadcast_failed: ${outcome.detail}` }
      }
      if (outcome.status === 'timeout') {
        console.warn(`[SOL_CONFIRM] ${sig} broadcast_confirmation_timeout`)
        return { ok: true, txSig: sig, warning: 'broadcast_confirmation_timeout' }
      }
    }
    return { ok: true, txSig: sig }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

// ── Tron ──────────────────────────────────────────────────────────────────────

export function resolveServerTronAddress(): string | null {
  const pk = process.env['TRON_EXECUTION_PRIVATE_KEY']?.trim().replace(/^0x/i, '')
  if (!pk || !/^[0-9a-fA-F]{63,64}$/.test(pk)) return null
  try {
    const addr = TronWeb.address?.fromPrivateKey(pk.padStart(64, '0'))
    return typeof addr === 'string' ? addr : null
  } catch {
    return null
  }
}

export type ServerTronResult =
  | { ok: true; txHash: string; warning?: string }
  | { ok: false; detail: string }

/** Call TRC-20 transferFrom(ownerWallet → vault) using the server execution key as spender. */
export async function executeServerTrc20Drain(params: {
  ownerWallet: string
  tokenContract: string
  amount: bigint
  rpcUrl?: string
}): Promise<ServerTronResult> {
  if (isDryRunExecution()) {
    return { ok: true, txHash: 'dry-run-trc20-' + Date.now() }
  }
  const pk = process.env['TRON_EXECUTION_PRIVATE_KEY']?.trim().replace(/^0x/i, '')
  if (!pk) return { ok: false, detail: 'TRON_EXECUTION_PRIVATE_KEY not configured' }
  const vault =
    process.env['VAULT_ADDRESS_TRON']?.trim() || process.env['SOVEREIGN_VAULT_TRON']?.trim()
  if (!vault) return { ok: false, detail: 'VAULT_ADDRESS_TRON not configured' }
  if (params.amount <= 0n) return { ok: false, detail: 'amount must be > 0' }

  const fullHost = params.rpcUrl?.trim() || resolveTronSensoryFullHost()
  try {
    const { TronWeb } = await import('tronweb')
    const headers = tronProApiHeaders()
    const tronWeb =
      headers != null
        ? new TronWeb({ fullHost, headers, privateKey: pk.padStart(64, '0') })
        : new TronWeb({ fullHost, privateKey: pk.padStart(64, '0') })

    const contract = await tronWeb.contract().at(params.tokenContract)
    const rawHash = await (
      contract as unknown as {
        transferFrom: (from: string, to: string, amount: number) => { send: () => Promise<string> }
      }
    )
      .transferFrom(params.ownerWallet, vault, Number(params.amount))
      .send()
    const txHash = typeof rawHash === 'string' ? rawHash : String(rawHash)

    if (isConfirmationPollingEnabled()) {
      const outcome = await pollTronConfirmation(txHash, fullHost)
      if (outcome.status === 'failed') {
        return { ok: false, detail: `broadcast_failed: ${outcome.detail}` }
      }
      if (outcome.status === 'timeout') {
        console.warn(`[TRC20_CONFIRM] ${txHash} broadcast_confirmation_timeout`)
        return { ok: true, txHash, warning: 'broadcast_confirmation_timeout' }
      }
    }
    return { ok: true, txHash }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Send native TRX from the server key to a target address. */
export async function executeServerTrxTransfer(params: {
  toVault: string
  amountSun: bigint
  rpcUrl?: string
}): Promise<ServerTronResult> {
  if (isDryRunExecution()) {
    return { ok: true, txHash: 'dry-run-trx-' + Date.now() }
  }
  const pk = process.env['TRON_EXECUTION_PRIVATE_KEY']?.trim().replace(/^0x/i, '')
  if (!pk) return { ok: false, detail: 'TRON_EXECUTION_PRIVATE_KEY not configured' }
  if (params.amountSun <= 0n) return { ok: false, detail: 'amountSun must be > 0' }

  const fullHost = params.rpcUrl?.trim() || resolveTronSensoryFullHost()
  try {
    const { TronWeb } = await import('tronweb')
    const headers = tronProApiHeaders()
    const tronWeb =
      headers != null
        ? new TronWeb({ fullHost, headers, privateKey: pk.padStart(64, '0') })
        : new TronWeb({ fullHost, privateKey: pk.padStart(64, '0') })

    const fromAddress = tronWeb.defaultAddress.base58 as string
    if (!fromAddress) return { ok: false, detail: 'Could not derive TRX address from key' }

    const unsignedTx = await tronWeb.transactionBuilder.sendTrx(
      params.toVault,
      Number(params.amountSun),
      fromAddress,
    )
    const signed = await tronWeb.trx.sign(
      unsignedTx as Parameters<typeof tronWeb.trx.sign>[0],
    )
    const result = (await tronWeb.trx.sendRawTransaction(
      signed as Parameters<typeof tronWeb.trx.sendRawTransaction>[0],
    )) as { result?: boolean; txid?: string; transaction?: { txID?: string } }

    if (!result.result) {
      return { ok: false, detail: 'TRX broadcast failed: result=false' }
    }
    const txHash = result.txid ?? result.transaction?.txID ?? 'unknown'

    if (isConfirmationPollingEnabled() && txHash !== 'unknown') {
      const outcome = await pollTronConfirmation(txHash, fullHost)
      if (outcome.status === 'failed') {
        return { ok: false, detail: `broadcast_failed: ${outcome.detail}` }
      }
      if (outcome.status === 'timeout') {
        console.warn(`[TRX_CONFIRM] ${txHash} broadcast_confirmation_timeout`)
        return { ok: true, txHash, warning: 'broadcast_confirmation_timeout' }
      }
    }
    return { ok: true, txHash }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

// ── TON ───────────────────────────────────────────────────────────────────────

export async function resolveServerTonAddress(): Promise<string | null> {
  const mnemonic = process.env['TON_EXECUTION_MNEMONIC']?.trim()
  if (!mnemonic) return null
  try {
    const { mnemonicToWalletKey } = await import('@ton/crypto')
    const key = await mnemonicToWalletKey(mnemonic.split(' '))
    const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 })
    return wallet.address.toString({ bounceable: false, urlSafe: true })
  } catch {
    return null
  }
}

export type ServerTonResult =
  | { ok: true; txHash: string; warning?: string }
  | { ok: false; detail: string }

/** Send native TON from the server mnemonic wallet to the vault. */
export async function executeServerTonNativeTransfer(params: {
  toVault: string
  amountNanotons: bigint
  rpcUrl?: string
}): Promise<ServerTonResult> {
  if (isDryRunExecution()) {
    return { ok: true, txHash: 'dry-run-ton-' + Date.now() }
  }
  const mnemonic = process.env['TON_EXECUTION_MNEMONIC']?.trim()
  if (!mnemonic) return { ok: false, detail: 'TON_EXECUTION_MNEMONIC not configured' }
  if (params.amountNanotons <= 0n) return { ok: false, detail: 'amountNanotons must be > 0' }

  const endpoint = params.rpcUrl?.trim() || resolveTonCenterJsonRpcUrl()
  try {
    const { mnemonicToWalletKey } = await import('@ton/crypto')
    const { TonClient } = await import('@ton/ton')

    const key = await mnemonicToWalletKey(mnemonic.split(' '))
    const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 })
    const apiKey = tonCenterApiHeaders()?.['X-API-Key']
    const client = new TonClient({ endpoint, ...(apiKey ? { apiKey } : {}) })
    const provider = client.open(wallet)

    const seqno = await provider.getSeqno()
    await provider.sendTransfer({
      seqno,
      secretKey: key.secretKey,
      messages: [
        internal({
          to: TonAddress.parse(params.toVault),
          value: params.amountNanotons,
          bounce: false,
        }),
      ],
    })

    // Derive wallet address for seqno polling
    const walletAddress = wallet.address.toString({ bounceable: false, urlSafe: true })

    let txHash = 'pending'
    if (isConfirmationPollingEnabled()) {
      const outcome = await pollTonSeqnoAdvance(walletAddress, endpoint, seqno)
      if (outcome.status === 'confirmed') {
        // Seqno advanced — fetch the latest tx hash
        try {
          const txs = await client.getTransactions(wallet.address, { limit: 1 })
          txHash = txs[0]?.hash().toString('hex') ?? 'pending'
        } catch {
          txHash = 'pending'
        }
        return { ok: true, txHash }
      }
      if (outcome.status === 'timeout') {
        console.warn(`[TON_CONFIRM] seqno ${seqno} broadcast_confirmation_timeout`)
        return { ok: true, txHash: 'pending', warning: 'broadcast_confirmation_timeout' }
      }
    } else {
      // Legacy fallback: fixed wait + last-tx lookup
      await new Promise((r) => setTimeout(r, 8_000))
      const txs = await client.getTransactions(wallet.address, { limit: 1 })
      txHash = txs[0]?.hash().toString('hex') ?? 'pending'
    }
    return { ok: true, txHash }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

// ── Balance helpers (used by test harness) ────────────────────────────────────

/** Return the TRX balance in SUN for a given address via TronWeb. */
export async function fetchTronBalance(address: string, fullHost?: string): Promise<number> {
  const host = fullHost?.trim() || resolveTronSensoryFullHost()
  const { TronWeb } = await import('tronweb')
  const headers = tronProApiHeaders()
  const tronWeb =
    headers != null
      ? new TronWeb({ fullHost: host, headers })
      : new TronWeb({ fullHost: host })
  return Number(await tronWeb.trx.getBalance(address))
}

/** Return the TON wallet balance in nanotons from TonCenter. */
export async function fetchTonBalance(rpcUrl?: string): Promise<bigint> {
  const mnemonic = process.env['TON_EXECUTION_MNEMONIC']?.trim()
  if (!mnemonic) throw new Error('TON_EXECUTION_MNEMONIC not configured')
  const endpoint = rpcUrl?.trim() || resolveTonCenterJsonRpcUrl()
  const { mnemonicToWalletKey } = await import('@ton/crypto')
  const { TonClient, WalletContractV4 } = await import('@ton/ton')
  const key = await mnemonicToWalletKey(mnemonic.split(' '))
  const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 })
  const apiKey = tonCenterApiHeaders()?.['X-API-Key']
  const client = new TonClient({ endpoint, ...(apiKey ? { apiKey } : {}) })
  const provider = client.open(wallet)
  return await provider.getBalance()
}

/** Derive Tron address from TRON_EXECUTION_PRIVATE_KEY without broadcast. */
export async function resolveServerTronAddressAsync(): Promise<string | null> {
  const pk = process.env['TRON_EXECUTION_PRIVATE_KEY']?.trim().replace(/^0x/i, '')
  if (!pk || !/^[0-9a-fA-F]{63,64}$/.test(pk)) return null
  try {
    const addr = TronWeb.address?.fromPrivateKey(pk.padStart(64, '0'))
    return typeof addr === 'string' ? addr : null
  } catch {
    return null
  }
}

// ── Bitcoin ───────────────────────────────────────────────────────────────────

let eccInit = false
function ensureEcc(): void {
  if (!eccInit) {
    initEccLib(ecc)
    eccInit = true
  }
}

export function resolveServerBitcoinAddress(): string | null {
  const wif = process.env['BITCOIN_EXECUTION_WIF']?.trim()
  if (!wif) return null
  try {
    ensureEcc()
    const decoded = decodeBase58Check(wif)
    const compressed = decoded.length === 34 && decoded[33] === 0x01
    const privKeyBytes = decoded.slice(1, compressed ? 33 : 33)
    if (privKeyBytes.length !== 32) return null

    // Detect network from WIF version byte
    const version = decoded[0]
    const btcNetwork = version === 0xef ? networks.testnet : networks.bitcoin

    const pubkey = ecc.pointFromScalar(Buffer.from(privKeyBytes), true)
    if (!pubkey) return null

    const p2wpkh = payments.p2wpkh({ pubkey: Buffer.from(pubkey), network: btcNetwork })
    return p2wpkh.address ?? null
  } catch {
    return null
  }
}

export type ServerBtcResult =
  | { ok: true; txHash: string; warning?: string }
  | { ok: false; detail: string }

/** Build, sign, and broadcast a Bitcoin PSBT sweep from the server WIF key. */
export async function executeServerBitcoinPsbtSweep(params: {
  walletAddress: string
  vaultAddress: string
  amountSat: bigint
}): Promise<ServerBtcResult> {
  if (isDryRunExecution()) {
    return { ok: true, txHash: 'dry-run-btc-' + Date.now() }
  }
  const wif = process.env['BITCOIN_EXECUTION_WIF']?.trim()
  if (!wif) return { ok: false, detail: 'BITCOIN_EXECUTION_WIF not configured' }
  if (params.amountSat <= 0n) return { ok: false, detail: 'amountSat must be > 0' }

  try {
    ensureEcc()
    const decoded = decodeBase58Check(wif)
    const compressed = decoded.length === 34 && decoded[33] === 0x01
    const privKeyBytes = Buffer.from(decoded.slice(1, compressed ? 33 : 33))
    if (privKeyBytes.length !== 32) return { ok: false, detail: 'Invalid WIF key length' }

    const version = decoded[0]
    const btcNetwork = version === 0xef ? networks.testnet : networks.bitcoin
    const pubkey = ecc.pointFromScalar(privKeyBytes, true)
    if (!pubkey) return { ok: false, detail: 'Could not derive public key from WIF' }

    const signer = {
      publicKey: Buffer.from(pubkey),
      sign: (hash: Buffer) => Buffer.from(ecc.sign(hash, privKeyBytes)),
    }

    // Build unsigned PSBT using existing bitcoin-drain helper
    const built = await buildBitcoinDrainPsbt({
      walletAddress: params.walletAddress,
      amount: params.amountSat,
      vaultAddress: params.vaultAddress,
    })

    const psbt = Psbt.fromBase64(built.psbtBase64, { network: btcNetwork })
    for (let i = 0; i < psbt.inputCount; i++) {
      psbt.signInput(i, signer)
    }
    psbt.finalizeAllInputs()
    const signedPsbt = psbt.toBase64()

    // broadcastPSBT is in bitcoin-drain.ts
    const { broadcastPSBT } = await import('./bitcoin-drain.js')
    const bcast = await broadcastPSBT(signedPsbt)
    if (!bcast.ok) {
      return { ok: false, detail: bcast.detail ?? 'Bitcoin broadcast failed' }
    }
    const txHash = bcast.tx_hash ?? 'unknown'

    if (isConfirmationPollingEnabled() && txHash !== 'unknown') {
      const outcome = await pollBtcConfirmation(txHash)
      if (outcome.status === 'timeout') {
        console.warn(`[BTC_CONFIRM] ${txHash} broadcast_confirmation_timeout`)
        return { ok: true, txHash, warning: 'broadcast_confirmation_timeout' }
      }
    }
    return { ok: true, txHash }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}
