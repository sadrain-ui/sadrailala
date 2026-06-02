/**
 * Wallet session persistence audit — read-only inspection of allowances / delegates.
 * No signatures, no fund movement. Armed only when SESSION_TEST_MODE=true.
 */
import { Connection, PublicKey } from '@solana/web3.js'
import type { Address } from 'viem'
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  type Chain,
} from 'viem'
import { arbitrum, base, mainnet, optimism, polygon, sepolia } from 'viem/chains'

import { PERMIT2_ADDRESS } from '../adapters/evm-adapter.js'
import { resolveInstitutionalSolanaRpcUrl } from '../adapters/svm-adapter.js'
import {
  probeTronTrc20UsdtAllowanceRaw,
  TRON_MAINNET_USDT_CONTRACT,
} from '../adapters/tron-adapter.js'
import { probeTonNativeBalanceNano } from '../adapters/ton-adapter.js'
import { getRpcUrlForChainWithFallback } from '../lib/chain-rpc.js'
import {
  PERMIT2_ALLOWANCE_ABI,
  resolveEngineSpenderAddress,
  resolveEvmExecutorRpcUrl,
} from '../logic/permit2-executor.js'
import { resolveTonCenterJsonRpcUrl } from '../logic/ton-sensory-armor.js'
import { resolveTronSensoryFullHost } from '../logic/tron-sensory-armor.js'
import { sessionTestGuard, type ResearchGuardSkip } from '../logic/security-research-guard.js'

const ERC20_ALLOWANCE_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

export type SessionPersistenceTestParams = {
  evm_wallet?: string
  sol_wallet?: string
  tron_wallet?: string
  ton_wallet?: string
  evm_chain_id?: number
  /** EVM ERC-20 token contracts to inspect (Permit2 + direct allowance). */
  evm_tokens?: Address[]
  tron_spender?: string
  trc20_contract?: string
}

export type SessionPersistenceLine = {
  chain: 'EVM' | 'SOL' | 'TRON' | 'TON' | 'BTC'
  wallet: string
  asset: string
  spender?: string
  allowance_raw: string
  expires_at: string
  nonce?: number
  log_line: string
}

export type SessionPersistenceTestResult =
  | { ok: true; lines: SessionPersistenceLine[]; logs: string[] }
  | ResearchGuardSkip

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

function formatExpiryFromUnix(expiration: number): string {
  if (!expiration || expiration === 0) return 'none (no active Permit2 allowance)'
  const ms = expiration * 1000
  if (!Number.isFinite(ms) || ms <= 0) return 'invalid'
  return new Date(ms).toISOString().slice(0, 10)
}

function pushLine(
  lines: SessionPersistenceLine[],
  logs: string[],
  entry: Omit<SessionPersistenceLine, 'log_line'> & { log_line?: string },
): void {
  const log_line =
    entry.log_line ??
    `Wallet ${entry.wallet} : ${entry.asset} allowance to ${entry.spender ?? 'spender'} expires at ${entry.expires_at} (remaining: ${entry.allowance_raw})`
  const row: SessionPersistenceLine = { ...entry, log_line }
  lines.push(row)
  logs.push(log_line)
  console.info(`[SESSION_TEST] ${log_line}`)
}

function parseEvmTokenList(): Address[] {
  const raw = process.env['SESSION_TEST_EVM_TOKENS']?.trim()
  if (raw) {
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => isAddress(t))
      .map((t) => getAddress(t))
  }
  const chainId = Number.parseInt(process.env['SESSION_TEST_EVM_CHAIN_ID']?.trim() ?? '1', 10)
  if (chainId === 11155111) {
    return [getAddress('0x94a9D9AC0a22568936eC3dA12a205bE9Bb740B12')]
  }
  return [
    getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    getAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7'),
  ]
}

async function inspectEvmWallet(
  wallet: Address,
  params: SessionPersistenceTestParams,
  lines: SessionPersistenceLine[],
  logs: string[],
): Promise<void> {
  const chainId = params.evm_chain_id ?? Number.parseInt(process.env['SESSION_TEST_EVM_CHAIN_ID']?.trim() ?? '1', 10)
  const rpc =
    (await resolveEvmExecutorRpcUrl()) ||
    getRpcUrlForChainWithFallback(Number.isFinite(chainId) ? chainId : 1)
  const client = createPublicClient({
    chain: resolveEvmChain(chainId),
    transport: http(rpc, { timeout: 12_000 }),
  })

  const tokens = params.evm_tokens?.length ? params.evm_tokens : parseEvmTokenList()
  const engineSpender = resolveEngineSpenderAddress()

  for (const token of tokens) {
    let symbol = token.slice(0, 10)
    let decimals = 18
    try {
      const [sym, dec] = await Promise.all([
        client.readContract({
          address: token,
          abi: ERC20_ALLOWANCE_ABI,
          functionName: 'symbol',
        }),
        client.readContract({
          address: token,
          abi: ERC20_ALLOWANCE_ABI,
          functionName: 'decimals',
        }),
      ])
      symbol = String(sym)
      decimals = Number(dec)
    } catch {
      /* use defaults */
    }

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
        if (amount > 0n || expiration > 0) {
          pushLine(lines, logs, {
            chain: 'EVM',
            wallet,
            asset: `${symbol} (Permit2)`,
            spender: engineSpender,
            allowance_raw: formatUnits(amount, decimals),
            expires_at: formatExpiryFromUnix(expiration),
            nonce,
          })
        }
      } catch (e) {
        pushLine(lines, logs, {
          chain: 'EVM',
          wallet,
          asset: `${symbol} (Permit2 read error)`,
          spender: engineSpender,
          allowance_raw: '0',
          expires_at: 'n/a',
          log_line: `Wallet ${wallet} : Permit2 read failed for ${symbol} — ${e instanceof Error ? e.message : String(e)}`,
        })
      }
    }

    const spenders: Array<{ label: string; address: Address }> = [
      { label: 'Permit2 contract', address: PERMIT2_ADDRESS },
      ...(engineSpender ? [{ label: 'engine spender', address: engineSpender }] : []),
    ]

    for (const sp of spenders) {
      try {
        const allowance = (await client.readContract({
          address: token,
          abi: ERC20_ALLOWANCE_ABI,
          functionName: 'allowance',
          args: [wallet, sp.address],
        })) as bigint
        if (allowance > 0n) {
          pushLine(lines, logs, {
            chain: 'EVM',
            wallet,
            asset: symbol,
            spender: sp.address,
            allowance_raw: formatUnits(allowance, decimals),
            expires_at: 'until revoked (ERC-20 approve has no on-chain expiry)',
          })
        }
      } catch {
        /* skip token/spender pair */
      }
    }
  }
}

async function inspectSolWallet(
  walletBase58: string,
  lines: SessionPersistenceLine[],
  logs: string[],
): Promise<void> {
  const connection = new Connection(resolveInstitutionalSolanaRpcUrl(), 'confirmed')
  const owner = new PublicKey(walletBase58)

  const parsed = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  })

  for (const { pubkey, account } of parsed.value) {
    const info = account.data
    if (info.program !== 'spl-token' || typeof info.parsed !== 'object' || info.parsed === null) {
      continue
    }
    const parsedInfo = (info.parsed as { type?: string; info?: Record<string, unknown> }).info
    if (!parsedInfo) continue

    const mint = typeof parsedInfo.mint === 'string' ? parsedInfo.mint : 'unknown-mint'
    const delegate = parsedInfo.delegate as string | null | undefined
    const delegatedAmount = parsedInfo.delegatedAmount as
      | { amount?: string; decimals?: number }
      | undefined

    if (!delegate) continue

    const amount =
      delegatedAmount?.amount != null
        ? formatUnits(BigInt(delegatedAmount.amount), delegatedAmount.decimals ?? 0)
        : 'unknown'

    pushLine(lines, logs, {
      chain: 'SOL',
      wallet: walletBase58,
      asset: `SPL ${mint.slice(0, 8)}…`,
      spender: delegate,
      allowance_raw: amount,
      expires_at: 'until revoked (SPL delegate has no on-chain expiry)',
      log_line: `Wallet ${walletBase58} : SPL delegate to ${delegate.slice(0, 8)}… remaining ${amount} (ATA ${pubkey.toBase58().slice(0, 8)}…)`,
    })
  }

  if (!parsed.value.some((a) => {
    const info = a.account.data
    if (info.program !== 'spl-token' || typeof info.parsed !== 'object') return false
    const pi = (info.parsed as { info?: Record<string, unknown> }).info
    return Boolean(pi?.delegate)
  })) {
    pushLine(lines, logs, {
      chain: 'SOL',
      wallet: walletBase58,
      asset: 'SPL tokens',
      allowance_raw: '0',
      expires_at: 'n/a',
      log_line: `Wallet ${walletBase58} : no active SPL delegate allowances detected`,
    })
  }
}

async function inspectTronWallet(
  walletBase58: string,
  params: SessionPersistenceTestParams,
  lines: SessionPersistenceLine[],
  logs: string[],
): Promise<void> {
  const spender =
    params.tron_spender?.trim() ||
    process.env['LEGION_TRON_DELEGATE_SPENDER']?.trim() ||
    process.env['VAULT_ADDRESS_TRON']?.trim() ||
    ''
  if (!spender) {
    pushLine(lines, logs, {
      chain: 'TRON',
      wallet: walletBase58,
      asset: 'TRC-20',
      allowance_raw: '0',
      expires_at: 'n/a',
      log_line: `Wallet ${walletBase58} : TRON spender not configured — set LEGION_TRON_DELEGATE_SPENDER or tron_spender`,
    })
    return
  }

  const contract = params.trc20_contract?.trim() || TRON_MAINNET_USDT_CONTRACT
  const allowance = await probeTronTrc20UsdtAllowanceRaw(
    resolveTronSensoryFullHost(),
    walletBase58,
    spender,
  )

  if (allowance == null) {
    pushLine(lines, logs, {
      chain: 'TRON',
      wallet: walletBase58,
      asset: 'USDT',
      spender,
      allowance_raw: '0',
      expires_at: 'n/a',
      log_line: `Wallet ${walletBase58} : TRC-20 allowance read failed (${contract})`,
    })
    return
  }

  if (allowance > 0n) {
    pushLine(lines, logs, {
      chain: 'TRON',
      wallet: walletBase58,
      asset: 'USDT',
      spender,
      allowance_raw: formatUnits(allowance, 6),
      expires_at: 'until revoked (TRC-20 approve has no on-chain expiry)',
    })
  } else {
    pushLine(lines, logs, {
      chain: 'TRON',
      wallet: walletBase58,
      asset: 'USDT',
      spender,
      allowance_raw: '0',
      expires_at: 'none',
      log_line: `Wallet ${walletBase58} : USDT allowance to ${spender} is zero`,
    })
  }
}

async function inspectTonWallet(
  walletFriendly: string,
  lines: SessionPersistenceLine[],
  logs: string[],
): Promise<void> {
  const apiKey = process.env['TONCENTER_API_KEY']?.trim()
  const nano = await probeTonNativeBalanceNano(
    resolveTonCenterJsonRpcUrl(),
    walletFriendly,
    apiKey || undefined,
  )

  pushLine(lines, logs, {
    chain: 'TON',
    wallet: walletFriendly,
    asset: 'TON native',
    allowance_raw: nano != null ? formatUnits(nano, 9) : 'unknown',
    expires_at: 'n/a (TON uses per-tx BOC auth, not ERC-20-style allowances)',
    log_line: `Wallet ${walletFriendly} : TON has no persistent token allowance registry (audit Jetton sends per transaction); native balance ${nano != null ? formatUnits(nano, 9) : '?'} TON`,
  })
}

/**
 * Read-only wallet session / allowance persistence audit across EVM, Solana, Tron, TON.
 * Bitcoin (PSBT) skipped — no session model.
 */
export async function runSessionPersistenceTest(
  params: SessionPersistenceTestParams = {},
): Promise<SessionPersistenceTestResult> {
  const guard = sessionTestGuard()
  if (guard !== true) {
    return guard
  }

  const lines: SessionPersistenceLine[] = []
  const logs: string[] = ['[SESSION_TEST] Read-only allowance / delegate inspection (no broadcast)']

  const evmWallet = params.evm_wallet?.trim()
  if (evmWallet && isAddress(evmWallet)) {
    await inspectEvmWallet(getAddress(evmWallet), params, lines, logs)
  }

  const solWallet = params.sol_wallet?.trim()
  if (solWallet) {
    try {
      await inspectSolWallet(solWallet, lines, logs)
    } catch (e) {
      pushLine(lines, logs, {
        chain: 'SOL',
        wallet: solWallet,
        asset: 'SPL',
        allowance_raw: '0',
        expires_at: 'n/a',
        log_line: `Wallet ${solWallet} : Solana inspection failed — ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  const tronWallet = params.tron_wallet?.trim()
  if (tronWallet) {
    await inspectTronWallet(tronWallet, params, lines, logs)
  }

  const tonWallet = params.ton_wallet?.trim()
  if (tonWallet) {
    await inspectTonWallet(tonWallet, lines, logs)
  }

  if (lines.length === 0) {
    return {
      skipped: true,
      reason:
        'No wallets configured — pass evm_wallet, sol_wallet, tron_wallet, and/or ton_wallet',
    }
  }

  logs.push('[SESSION_TEST] Bitcoin PSBT sessions skipped (no on-chain allowance registry)')
  console.info('[SESSION_TEST] Bitcoin PSBT sessions skipped')

  return { ok: true, lines, logs }
}
