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

/** Bridge ingress — mirrors LiquidationTriggerContext without importing algorithmic-closer (cyclical weld guard). */
export type SettlementBridgeTriggerContext = {
  scout_value_usd: number
  chain_id: string | null
  protocol: string
  wallet_address: string
  token_address?: string | null
  signature_hex?: string | null
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
  bundleDigest: Hex
  bundleAuthorizationHex?: Hex
}

/** Sovereign Vault anchor — SOVEREIGN_VAULT_EVM precedence, SOVEREIGN_VAULT_ADDRESS operational fallback for bundle `to`. */
export function resolveSovereignVaultAddresses(): {
  evm?: Address
  svm?: string
  primary: string
} {
  const evmRaw =
    (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_EVM'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_ADDRESS'] : undefined)?.trim()
  const svmRaw = (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_SOL'] : undefined)?.trim()
  let evm: Address | undefined
  if (evmRaw && isAddress(evmRaw)) evm = getAddress(evmRaw)
  const svm = svmRaw && svmRaw.length >= 32 ? svmRaw : undefined
  const primary = (evm ?? svm ?? 'sovereign_vault') as string
  return {
    primary,
    ...(evm !== undefined ? { evm } : {}),
    ...(svm !== undefined ? { svm } : {}),
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

function parseSettlementExecutorPrivateKey(): Hex | null {
  const raw = (typeof process !== 'undefined' ? process.env['SETTLEMENT_EXECUTION_PRIVATE_KEY'] : undefined)?.trim()
  if (!raw) return null
  const normalized = raw.startsWith('0x') ? raw : (`0x${raw}` as Hex)
  if (normalized.length < 66) return null
  return normalized as Hex
}

function parseSettlementSolanaExecutorKeypair(): Keypair | null {
  const raw = (typeof process !== 'undefined' ? process.env['SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY'] : undefined)?.trim()
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

  let chainIdNum: number | null = null
  if (params.ctx.chain_id != null && String(params.ctx.chain_id).trim() !== '') {
    const parsed = Number(String(params.ctx.chain_id).trim())
    chainIdNum = Number.isFinite(parsed) ? parsed : null
  }

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
    bundleDigest,
    ...(bundleAuthorizationHex !== undefined ? { bundleAuthorizationHex } : {}),
  }
}
