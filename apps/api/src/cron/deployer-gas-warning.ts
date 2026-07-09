/**
 * Deployer / factory-relayer wallet gas monitor — Telegram alerts when low on any chain.
 */
import { createPublicClient, formatEther, http } from 'viem'

import { isTelegramConfigured, sendTelegramMessage } from '../lib/telegram.js'
import { readFactoryAddresses } from '../lib/factory-create2.js'

export type DeployerGasRow = {
  chainId: number
  chain: string
  symbol: string
  address: string
  native_amount: number
  native_display: string
  min_required: number
  factory_deployed: boolean
  error?: string
}

type ChainProbe = {
  id: number
  name: string
  symbol: string
  minNative: number
  rpc: () => string | null
}

function envRpc(...keys: string[]): string | null {
  for (const k of keys) {
    const v = process.env[k]?.trim()
    if (v) return v
  }
  return null
}

const PROBE_CHAINS: ChainProbe[] = [
  { id: 1, name: 'Ethereum', symbol: 'ETH', minNative: 0.005, rpc: () => envRpc('RPC_ETHEREUM_PRIVATE', 'RPC_URL_1', 'NEXT_PUBLIC_RPC_URL') },
  { id: 56, name: 'BSC', symbol: 'BNB', minNative: 0.003, rpc: () => envRpc('RPC_BSC_PRIVATE', 'RPC_URL_56') },
  { id: 137, name: 'Polygon', symbol: 'MATIC', minNative: 0.5, rpc: () => envRpc('RPC_POLYGON_PRIVATE', 'RPC_URL_137') },
  { id: 42161, name: 'Arbitrum', symbol: 'ETH', minNative: 0.002, rpc: () => envRpc('RPC_ARBITRUM_PRIVATE', 'RPC_URL_42161') },
  { id: 8453, name: 'Base', symbol: 'ETH', minNative: 0.002, rpc: () => envRpc('RPC_BASE_PRIVATE', 'RPC_URL_8453') },
  { id: 10, name: 'Optimism', symbol: 'ETH', minNative: 0.002, rpc: () => envRpc('RPC_OPTIMISM_PRIVATE', 'RPC_URL_10') },
  { id: 43114, name: 'Avalanche', symbol: 'AVAX', minNative: 0.05, rpc: () => envRpc('RPC_AVALANCHE_PRIVATE', 'RPC_URL_43114') },
  { id: 534352, name: 'Scroll', symbol: 'ETH', minNative: 0.002, rpc: () => envRpc('RPC_SCROLL_PRIVATE', 'RPC_URL_534352') },
  { id: 81457, name: 'Blast', symbol: 'ETH', minNative: 0.002, rpc: () => envRpc('RPC_BLAST_PRIVATE', 'RPC_URL_81457') },
  { id: 5000, name: 'Mantle', symbol: 'MNT', minNative: 0.5, rpc: () => envRpc('RPC_MANTLE_PRIVATE', 'RPC_URL_5000') },
]

function resolveDeployerAddress(): string | null {
  const raw =
    process.env['DEPLOYER_WALLET_ADDRESS']?.trim() ||
    process.env['FACTORY_DEPLOYER_ADDRESS']?.trim() ||
    process.env['ADMIN_WALLET_ADDRESS']?.trim()
  if (!raw?.startsWith('0x') || raw.length !== 42) return null
  return raw.toLowerCase()
}

function parseThresholdOverrides(): Record<number, number> {
  const raw = process.env['DEPLOYER_GAS_THRESHOLDS_JSON']?.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, number>
    const out: Record<number, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k)
      if (Number.isFinite(id) && typeof v === 'number' && v >= 0) out[id] = v
    }
    return out
  } catch {
    return {}
  }
}

export async function fetchDeployerGasBalances(): Promise<DeployerGasRow[]> {
  const deployer = resolveDeployerAddress()
  if (!deployer) return []

  const factories = readFactoryAddresses()
  const thresholds = parseThresholdOverrides()
  const rows: DeployerGasRow[] = []

  for (const chain of PROBE_CHAINS) {
    const rpc = chain.rpc()
    const minRequired = thresholds[chain.id] ?? chain.minNative
    const factoryDeployed = Boolean(factories[chain.id])

    if (!rpc) {
      rows.push({
        chainId: chain.id,
        chain: chain.name,
        symbol: chain.symbol,
        address: deployer,
        native_amount: 0,
        native_display: 'N/A',
        min_required: minRequired,
        factory_deployed: factoryDeployed,
        error: 'RPC not configured',
      })
      continue
    }

    try {
      const client = createPublicClient({ transport: http(rpc, { retryCount: 2, timeout: 12_000 }) })
      const wei = await client.getBalance({ address: deployer as `0x${string}` })
      const native = Number(formatEther(wei))
      rows.push({
        chainId: chain.id,
        chain: chain.name,
        symbol: chain.symbol,
        address: deployer,
        native_amount: native,
        native_display: `${native.toFixed(6)} ${chain.symbol}`,
        min_required: minRequired,
        factory_deployed: factoryDeployed,
      })
    } catch (e) {
      rows.push({
        chainId: chain.id,
        chain: chain.name,
        symbol: chain.symbol,
        address: deployer,
        native_amount: 0,
        native_display: 'N/A',
        min_required: minRequired,
        factory_deployed: factoryDeployed,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return rows
}

function isLow(row: DeployerGasRow): boolean {
  if (row.error) return false
  return row.native_amount < row.min_required
}

function buildDeployerGasMessage(low: DeployerGasRow[], all: DeployerGasRow[]): string {
  const lines = [
    '⛽ <b>DEPLOYER GAS LOW</b>',
    '━━━━━━━━━━━━━━━━',
    `Wallet: <code>${all[0]?.address ?? 'n/a'}</code>`,
    '',
    ...low.map(
      (r) =>
        `🔴 <b>${r.chain}</b> (${r.chainId})${r.factory_deployed ? '' : ' — <i>factory missing</i>'}\n` +
        `   Balance: <b>${r.native_display}</b> | Need: <b>≥${r.min_required} ${r.symbol}</b>`,
    ),
    '',
    '<b>All deployer probes:</b>',
    ...all.map((r) => {
      const flag = r.error ? '⚪' : isLow(r) ? '🔴' : '🟢'
      const fac = r.factory_deployed ? '✓factory' : '✗no factory'
      return `${flag} ${r.chain}: ${r.native_display} (${fac})${r.error ? ` — ${r.error}` : ''}`
    }),
    '',
    `🕐 ${new Date().toISOString()}`,
  ]
  return lines.join('\n')
}

/** Send Telegram if deployer wallet is below per-chain gas thresholds. */
export async function runDeployerGasWarningCheck(): Promise<void> {
  const rows = await fetchDeployerGasBalances()
  if (rows.length === 0) {
    console.info('[DEPLOYER_GAS] DEPLOYER_WALLET_ADDRESS not set — skip')
    return
  }

  const low = rows.filter(isLow)
  for (const row of rows) {
    const status = row.error ? 'error' : isLow(row) ? 'LOW' : 'ok'
    console.info(`[DEPLOYER_GAS] ${row.chain} ${row.native_display} [${status}] factory=${row.factory_deployed}`)
  }

  if (low.length === 0) {
    console.info('[DEPLOYER_GAS] All chains above threshold')
    return
  }

  if (!isTelegramConfigured()) {
    console.warn('[DEPLOYER_GAS] Telegram not configured')
    return
  }

  await sendTelegramMessage(buildDeployerGasMessage(low, rows))
  console.info(`[DEPLOYER_GAS] Sent warning for ${low.length} chain(s)`)
}
