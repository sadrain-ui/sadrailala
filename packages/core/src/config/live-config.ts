/**
 * Hot-reloadable in-memory config — replaced by @legion/updater without process restart.
 */
import { getAddress, isAddress } from 'viem'

export type Eip712DomainConfig = {
  name: string
  version: string
  chainId: number
  verifyingContract: string
}

export type LiveConfigPayload = {
  eip712_domains?: Eip712DomainConfig[]
  blacklisted_wallets?: string[]
  rpc_endpoints?: Record<string, string[]>
  captcha_sitekeys?: string[]
}

export type LiveConfigMeta = {
  updatedAt: string | null
  source: 'bootstrap' | 'remote'
  version: number
}

export type LiveConfigSnapshot = {
  eip712_domains: Eip712DomainConfig[]
  blacklisted_wallets: ReadonlySet<string>
  rpc_endpoints: Readonly<Record<string, readonly string[]>>
  captcha_sitekeys: readonly string[]
  meta: LiveConfigMeta
}

const CHAIN_NAME_ALIASES: Readonly<Record<string, string>> = {
  eth: 'ethereum',
  mainnet: 'ethereum',
  matic: 'polygon',
  arb: 'arbitrum',
  op: 'optimism',
  bnb: 'bsc',
  binance: 'bsc',
  sol: 'solana',
  btc: 'bitcoin',
  'evm:1': 'ethereum',
  'evm:137': 'polygon',
  'evm:42161': 'arbitrum',
  'evm:8453': 'base',
  'evm:10': 'optimism',
  'evm:56': 'bsc',
  'svm:101': 'solana',
  'aptos:1': 'aptos',
  'aptos:mainnet': 'aptos',
  'sui:mainnet': 'sui',
}

const EVM_CHAIN_NUMERIC: Readonly<Record<string, number>> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
  bsc: 56,
}

let snapshot: LiveConfigSnapshot = createBootstrapSnapshot()

function createBootstrapSnapshot(): LiveConfigSnapshot {
  return {
    eip712_domains: [],
    blacklisted_wallets: new Set(),
    rpc_endpoints: {},
    captcha_sitekeys: [],
    meta: { updatedAt: null, source: 'bootstrap', version: 0 },
  }
}

function normalizeChainKey(raw: string): string {
  const key = raw.trim().toLowerCase()
  return CHAIN_NAME_ALIASES[key] ?? key
}

function normalizeAddressForBlacklist(address: string): string | null {
  const trimmed = address.trim()
  if (!trimmed) return null
  if (isAddress(trimmed)) {
    try {
      return getAddress(trimmed)
    } catch {
      return trimmed.toLowerCase()
    }
  }
  return trimmed.toLowerCase()
}

function normalizeRpcEndpoints(
  input: Record<string, string[]> | undefined,
): Record<string, readonly string[]> {
  if (!input) return {}
  const out: Record<string, readonly string[]> = {}
  for (const [rawName, urls] of Object.entries(input)) {
    if (!Array.isArray(urls)) continue
    const cleaned = urls
      .filter((u): u is string => typeof u === 'string')
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
    if (cleaned.length === 0) continue
    out[normalizeChainKey(rawName)] = cleaned
  }
  return out
}

function normalizeEip712Domains(
  input: Eip712DomainConfig[] | undefined,
): Eip712DomainConfig[] {
  if (!input) return []
  const out: Eip712DomainConfig[] = []
  for (const row of input) {
    if (!row || typeof row !== 'object') continue
    const chainId = Number(row.chainId)
    const name = String(row.name ?? '').trim()
    const version = String(row.version ?? '1').trim() || '1'
    const verifyingContract = String(row.verifyingContract ?? '').trim()
    if (!Number.isFinite(chainId) || !name || !verifyingContract) continue
    if (!isAddress(verifyingContract)) continue
    out.push({
      name,
      version,
      chainId,
      verifyingContract: getAddress(verifyingContract),
    })
  }
  return out
}

/** Apply remote JSON payload — atomically replaces in-memory live config. */
export function applyLiveConfig(
  payload: LiveConfigPayload,
  source: 'bootstrap' | 'remote' = 'remote',
): LiveConfigSnapshot {
  const blacklist = new Set<string>()
  for (const wallet of payload.blacklisted_wallets ?? []) {
    const normalized = normalizeAddressForBlacklist(String(wallet))
    if (normalized) blacklist.add(normalized)
  }

  snapshot = {
    eip712_domains: normalizeEip712Domains(payload.eip712_domains),
    blacklisted_wallets: blacklist,
    rpc_endpoints: normalizeRpcEndpoints(payload.rpc_endpoints),
    captcha_sitekeys: (payload.captcha_sitekeys ?? [])
      .map((k) => String(k).trim())
      .filter((k) => k.length > 0),
    meta: {
      updatedAt: new Date().toISOString(),
      source,
      version: snapshot.meta.version + 1,
    },
  }
  return getLiveConfigSnapshot()
}

export function getLiveConfigSnapshot(): LiveConfigSnapshot {
  return snapshot
}

export function getCaptchaSitekeys(): readonly string[] {
  return snapshot.captcha_sitekeys
}

export function isWalletBlacklisted(address: string): boolean {
  const normalized = normalizeAddressForBlacklist(address)
  if (!normalized) return false
  return snapshot.blacklisted_wallets.has(normalized)
}

export function assertSettlementAddressAllowed(address: string): void {
  if (isWalletBlacklisted(address)) {
    throw new Error(`BLACKLISTED_WALLET: settlement blocked for ${address}`)
  }
}

/** Resolve EIP-712 domain override for a chain (Permit2 / settlement lanes). */
export function resolveLiveEip712Domain(
  chainId: number,
  fallback?: Partial<Eip712DomainConfig>,
): Eip712DomainConfig | null {
  const match = snapshot.eip712_domains.find((d) => d.chainId === chainId)
  if (match) return match
  if (!fallback?.name || !fallback.verifyingContract) return null
  if (!isAddress(fallback.verifyingContract)) return null
  return {
    name: fallback.name,
    version: fallback.version ?? '1',
    chainId,
    verifyingContract: getAddress(fallback.verifyingContract),
  }
}

export function getLiveRpcUrlsForChainName(chainName: string): readonly string[] {
  const key = normalizeChainKey(chainName)
  return snapshot.rpc_endpoints[key] ?? []
}

export function getLiveRpcUrlsForEvmChain(chainId: number): readonly string[] {
  const entry = Object.entries(EVM_CHAIN_NUMERIC).find(([, id]) => id === chainId)
  if (!entry) return []
  return getLiveRpcUrlsForChainName(entry[0])
}

/** Merge live RPC overrides ahead of static mesh nodes (deduped, live first). */
export function mergeRpcMeshNodes(
  chainName: string,
  baseNodes: readonly string[],
): readonly string[] {
  const live = getLiveRpcUrlsForChainName(chainName)
  if (live.length === 0) return baseNodes
  const seen = new Set<string>()
  const merged: string[] = []
  for (const url of [...live, ...baseNodes]) {
    const trimmed = url.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    merged.push(trimmed)
  }
  return merged
}

export function mergeEvmMeshNodes(
  chainId: number,
  baseNodes: readonly string[],
): readonly string[] {
  const live = getLiveRpcUrlsForEvmChain(chainId)
  if (live.length === 0) return baseNodes
  const seen = new Set<string>()
  const merged: string[] = []
  for (const url of [...live, ...baseNodes]) {
    const trimmed = url.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    merged.push(trimmed)
  }
  return merged
}
