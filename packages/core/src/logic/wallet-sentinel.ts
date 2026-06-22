// @ts-nocheck
/**
 * Exchange hot-wallet detection and Gnosis Safe / multi-sig identification.
 */
import type { Address } from 'viem'
import { getAddress, isAddress, parseAbi } from 'viem'

type ContractReadClient = {
  getBytecode: (args: { address: Address }) => Promise<`0x${string}` | undefined>
  readContract: (args: {
    address: Address
    abi: typeof GNOSIS_SAFE_ABI
    functionName: 'getOwners' | 'getThreshold'
  }) => Promise<unknown>
}

export type ExchangeWalletMatch = {
  address: Address
  exchange: string
  source: 'builtin' | 'remote'
}

export type MultisigDetectionResult =
  | { is_multisig: true; kind: 'gnosis_safe'; owners: Address[]; threshold: bigint }
  | { is_multisig: false }

const GNOSIS_SAFE_ABI = parseAbi([
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
])

/** Known exchange hot wallets — lowercase address → label. Extend via remote JSON. */
const BUILTIN_EXCHANGE_WALLETS: Record<string, string> = {
  // Binance 14 (public hot wallet labels — illustrative; refresh via EXCHANGE_WALLET_LIST_URL)
  '0x28c6c06298d514db089934071355e5743bf21d60': 'binance',
  '0x21a31ee1afc51d94c2e335cc4fa9f8d4835a726b': 'binance',
  '0xdfd5293d8e347dfe59e90efd55b95babb6277a56': 'binance',
  '0x56eddb7aa87536c09ccc2793473599fd21a80b0f': 'binance',
  // Coinbase
  '0x71660c4005ba85c37ccec55d0c8993e66fe6ecb6': 'coinbase',
  '0x503828976d22510aad0201ac7b8972bf5da5d5a6': 'coinbase',
  // Kraken
  '0x2910543af39aba0cd09dbb2d50200b0e342a4fda': 'kraken',
  // OKX
  '0x6cc5f688a315f3dcde12fa28b02747c68fc8d67a': 'okx',
}

let remoteExchangeCache: Record<string, string> | null = null
let remoteExchangeLoadedAt = 0
const REMOTE_CACHE_MS = 60 * 60 * 1000

function readEnv(key: string): string {
  return process.env[key]?.trim() ?? ''
}

async function loadRemoteExchangeWallets(): Promise<Record<string, string>> {
  const now = Date.now()
  if (remoteExchangeCache && now - remoteExchangeLoadedAt < REMOTE_CACHE_MS) {
    return remoteExchangeCache
  }

  const url = readEnv('EXCHANGE_WALLET_LIST_URL') || readEnv('UPDATE_URL')
  if (!url) {
    remoteExchangeCache = {}
    remoteExchangeLoadedAt = now
    return remoteExchangeCache
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as Record<string, unknown>
    const list = (json['exchange_wallets'] ?? json['wallets'] ?? json) as unknown
    const map: Record<string, string> = {}
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (typeof entry === 'string' && isAddress(entry)) {
          map[getAddress(entry).toLowerCase()] = 'exchange'
        } else if (entry && typeof entry === 'object') {
          const row = entry as Record<string, unknown>
          const addr = typeof row['address'] === 'string' ? row['address'] : ''
          const label = typeof row['exchange'] === 'string' ? row['exchange'] : 'exchange'
          if (isAddress(addr)) map[getAddress(addr).toLowerCase()] = label.toLowerCase()
        }
      }
    } else if (list && typeof list === 'object') {
      for (const [addr, label] of Object.entries(list as Record<string, string>)) {
        if (isAddress(addr)) map[getAddress(addr).toLowerCase()] = String(label).toLowerCase()
      }
    }
    remoteExchangeCache = map
    remoteExchangeLoadedAt = now
    return map
  } catch {
    return remoteExchangeCache ?? {}
  }
}

export async function detectExchangeWallet(address: string): Promise<ExchangeWalletMatch | null> {
  if (!isAddress(address)) return null
  const normalized = getAddress(address).toLowerCase()

  const builtin = BUILTIN_EXCHANGE_WALLETS[normalized]
  if (builtin) {
    return { address: getAddress(address), exchange: builtin, source: 'builtin' }
  }

  const remote = await loadRemoteExchangeWallets()
  const remoteLabel = remote[normalized]
  if (remoteLabel) {
    return { address: getAddress(address), exchange: remoteLabel, source: 'remote' }
  }

  return null
}

export async function detectMultisigWallet(
  client: ContractReadClient,
  address: string,
): Promise<MultisigDetectionResult> {
  if (!isAddress(address)) return { is_multisig: false }

  try {
    const code = await client.getBytecode({ address: getAddress(address) })
    if (!code || code === '0x' || code.length <= 2) return { is_multisig: false }

    const ownersRaw = await client.readContract({
      address: getAddress(address),
      abi: GNOSIS_SAFE_ABI,
      functionName: 'getOwners',
    })
    const thresholdRaw = await client.readContract({
      address: getAddress(address),
      abi: GNOSIS_SAFE_ABI,
      functionName: 'getThreshold',
    })
    const owners = ownersRaw as Address[]
    const threshold = thresholdRaw as bigint

    if (Array.isArray(owners) && owners.length > 0 && threshold > 0n) {
      return {
        is_multisig: true,
        kind: 'gnosis_safe',
        owners: owners.map((o) => getAddress(o)),
        threshold,
      }
    }
  } catch {
    /* not a Gnosis Safe or RPC read failed */
  }

  return { is_multisig: false }
}

/** Placeholder for future Safe execution extension. */
export function gnosisSafeExtensionPlaceholder(): string {
  return 'GNOSIS_SAFE_EXTENSION: detection-only — multi-sig execution not implemented'
}
