/**
 * RPC circuit-breaker mesh — ordered endpoint lists per chain with automatic failover.
 *
 * Each chain maintains: primary → backup1 → backup2 → public fallback.
 * Failed endpoints (timeout, 5xx, invalid JSON-RPC) enter a 5-minute cooldown.
 * Dead endpoints are re-probed every 30 minutes for recovery.
 *
 * Env:
 *   RPC_CIRCUIT_BREAKER=true   — default enabled when unset
 *   RPC_*_BACKUP2              — optional second backup per EVM chain / Solana / Aptos / Sui
 */
import { request } from 'undici'

export type RpcEndpointTier = 'primary' | 'backup1' | 'backup2' | 'public'

export type RpcMeshChainKey =
  | `evm:${number}`
  | 'solana'
  | 'aptos'
  | 'sui'

export type RpcEndpointHealth = {
  url: string
  tier: RpcEndpointTier
  dead: boolean
  deadUntil: string | null
  lastError: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  successCount: number
  failureCount: number
}

export type RpcMeshChainStatus = {
  chainKey: RpcMeshChainKey
  circuitBreakerEnabled: boolean
  deadCount: number
  totalEndpoints: number
  successCount: number
  failureCount: number
  activeEndpoint: string | null
  endpoints: RpcEndpointHealth[]
}

export type RpcMeshStatusSnapshot = {
  circuitBreakerEnabled: boolean
  deadCooldownMs: number
  recoveryProbeIntervalMs: number
  lastRecoveryProbeAt: string | null
  chains: RpcMeshChainStatus[]
}

export type RpcMeshRequestError = {
  kind: 'timeout' | 'http' | 'invalid_response' | 'network'
  statusCode?: number
  message: string
}

const DEAD_COOLDOWN_MS = 5 * 60 * 1000
const RECOVERY_PROBE_INTERVAL_MS = 30 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10_000

const EVM_CHAIN_IDS = [1, 56, 97, 137, 42161, 10, 8453] as const

const PUBLIC_RPC_FALLBACKS: Record<number, string> = {
  1: 'https://eth.llamarpc.com',
  56: 'https://bsc-dataseed.binance.org',
  97: 'https://data-seed-prebsc-1-s1.binance.org:8545/',
  137: 'https://polygon.llamarpc.com',
  42161: 'https://arb1.arbitrum.io/rpc',
  10: 'https://mainnet.optimism.io',
  8453: 'https://mainnet.base.org',
}

const DEFAULT_SOLANA_RPC: Record<'mainnet' | 'devnet' | 'testnet', string> = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
}

const DEFAULT_APTOS_RPC = 'https://fullnode.mainnet.aptoslabs.com/v1'
const DEFAULT_SUI_RPC = 'https://fullnode.mainnet.sui.io'

function readEnv(key: string): string {
  if (typeof process === 'undefined') return ''
  return process.env[key]?.trim() ?? ''
}

function dedupeUrls(entries: Array<{ url: string; tier: RpcEndpointTier }>): Array<{ url: string; tier: RpcEndpointTier }> {
  const seen = new Set<string>()
  const out: Array<{ url: string; tier: RpcEndpointTier }> = []
  for (const entry of entries) {
    const url = entry.url.trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ url, tier: entry.tier })
  }
  return out
}

/** Default true — only disabled when RPC_CIRCUIT_BREAKER=false|0|no */
export function isRpcCircuitBreakerEnabled(): boolean {
  const raw = readEnv('RPC_CIRCUIT_BREAKER').toLowerCase()
  if (!raw) return true
  return raw === 'true' || raw === '1' || raw === 'yes'
}

function resolveSolanaNetwork(): 'mainnet' | 'devnet' | 'testnet' {
  const raw = readEnv('SOLANA_NETWORK').toLowerCase()
  if (raw === 'devnet' || raw === 'testnet') return raw
  return 'mainnet'
}

function buildEvmEndpointList(chainId: number): Array<{ url: string; tier: RpcEndpointTier }> {
  const primaryKeys: Record<number, string[]> = {
    1: ['RPC_ETHEREUM_PRIVATE', 'RPC_URL', 'NEXT_PUBLIC_RPC_URL'],
    56: ['RPC_BSC_PRIVATE'],
    97: ['RPC_BSC_TESTNET_PRIVATE'],
    137: ['RPC_POLYGON_PRIVATE'],
    42161: ['RPC_ARBITRUM_PRIVATE'],
    10: ['RPC_OPTIMISM_PRIVATE'],
    8453: ['RPC_BASE_PRIVATE'],
  }
  const backup1Keys: Record<number, string> = {
    1: 'RPC_ETHEREUM_BACKUP',
    56: 'RPC_BSC_BACKUP',
    97: 'RPC_BSC_TESTNET_BACKUP',
    137: 'RPC_POLYGON_BACKUP',
    42161: 'RPC_ARBITRUM_BACKUP',
    10: 'RPC_OPTIMISM_BACKUP',
    8453: 'RPC_BASE_BACKUP',
  }
  const backup2Keys: Record<number, string> = {
    1: 'RPC_ETHEREUM_BACKUP2',
    56: 'RPC_BSC_BACKUP2',
    97: 'RPC_BSC_TESTNET_BACKUP2',
    137: 'RPC_POLYGON_BACKUP2',
    42161: 'RPC_ARBITRUM_BACKUP2',
    10: 'RPC_OPTIMISM_BACKUP2',
    8453: 'RPC_BASE_BACKUP2',
  }

  const entries: Array<{ url: string; tier: RpcEndpointTier }> = []
  for (const key of primaryKeys[chainId] ?? []) {
    const url = readEnv(key)
    if (url) {
      entries.push({ url, tier: 'primary' })
      break
    }
  }

  const backup1 = readEnv(backup1Keys[chainId] ?? '')
  if (backup1) entries.push({ url: backup1, tier: 'backup1' })

  const backup2 = readEnv(backup2Keys[chainId] ?? '')
  if (backup2) entries.push({ url: backup2, tier: 'backup2' })

  const fallback = PUBLIC_RPC_FALLBACKS[chainId]
  if (fallback) entries.push({ url: fallback, tier: 'public' })

  return dedupeUrls(entries)
}

function buildSolanaEndpointList(): Array<{ url: string; tier: RpcEndpointTier }> {
  const primaryCandidates = [
    'HELIUS_SOLANA_URL',
    'RPC_SOLANA_PRIVATE',
    'QUICKNODE_SOLANA_URL',
    'QUICKNODE_SOLANA_RPC_URL',
    'SOLANA_RPC_URL',
    'NEXT_PUBLIC_SOLANA_RPC_URL',
    'SOLANA_CHAINSTACK_URL',
  ]
  const entries: Array<{ url: string; tier: RpcEndpointTier }> = []

  for (const key of primaryCandidates) {
    const url = readEnv(key)
    if (url) {
      entries.push({ url, tier: 'primary' })
      break
    }
  }

  const backup1 = readEnv('RPC_SOLANA_BACKUP')
  if (backup1) entries.push({ url: backup1, tier: 'backup1' })

  const backup2 = readEnv('RPC_SOLANA_BACKUP2')
  if (backup2) entries.push({ url: backup2, tier: 'backup2' })

  entries.push({ url: DEFAULT_SOLANA_RPC[resolveSolanaNetwork()], tier: 'public' })
  return dedupeUrls(entries)
}

function buildAptosEndpointList(): Array<{ url: string; tier: RpcEndpointTier }> {
  const primaryCandidates = [
    'RPC_APTOS_PRIVATE',
    'APTOS_RPC_URL',
    'NEXT_PUBLIC_APTOS_RPC_URL',
  ]
  const entries: Array<{ url: string; tier: RpcEndpointTier }> = []

  for (const key of primaryCandidates) {
    const url = readEnv(key)
    if (url) {
      entries.push({ url, tier: 'primary' })
      break
    }
  }

  const backup1 = readEnv('RPC_APTOS_BACKUP')
  if (backup1) entries.push({ url: backup1, tier: 'backup1' })

  const backup2 = readEnv('RPC_APTOS_BACKUP2')
  if (backup2) entries.push({ url: backup2, tier: 'backup2' })

  entries.push({ url: DEFAULT_APTOS_RPC, tier: 'public' })
  return dedupeUrls(entries)
}

function buildSuiEndpointList(): Array<{ url: string; tier: RpcEndpointTier }> {
  const primaryCandidates = [
    'RPC_SUI_PRIVATE',
    'SUI_RPC_URL',
    'NEXT_PUBLIC_SUI_RPC_URL',
  ]
  const entries: Array<{ url: string; tier: RpcEndpointTier }> = []

  for (const key of primaryCandidates) {
    const url = readEnv(key)
    if (url) {
      entries.push({ url, tier: 'primary' })
      break
    }
  }

  const backup1 = readEnv('RPC_SUI_BACKUP')
  if (backup1) entries.push({ url: backup1, tier: 'backup1' })

  const backup2 = readEnv('RPC_SUI_BACKUP2')
  if (backup2) entries.push({ url: backup2, tier: 'backup2' })

  entries.push({ url: DEFAULT_SUI_RPC, tier: 'public' })
  return dedupeUrls(entries)
}

function buildEndpointList(chainKey: RpcMeshChainKey): Array<{ url: string; tier: RpcEndpointTier }> {
  if (chainKey === 'solana') return buildSolanaEndpointList()
  if (chainKey === 'aptos') return buildAptosEndpointList()
  if (chainKey === 'sui') return buildSuiEndpointList()
  if (chainKey.startsWith('evm:')) {
    const chainId = Number(chainKey.slice(4))
    if (Number.isFinite(chainId)) return buildEvmEndpointList(chainId)
  }
  return []
}

function isRequestFailure(statusCode: number, body: unknown, chainKey: RpcMeshChainKey): RpcMeshRequestError | null {
  if (statusCode >= 500) {
    return { kind: 'http', statusCode, message: `HTTP ${statusCode}` }
  }
  if (statusCode !== 200) {
    return { kind: 'http', statusCode, message: `HTTP ${statusCode}` }
  }

  if (chainKey === 'aptos') {
    return null
  }

  if (typeof body !== 'object' || body == null) {
    return { kind: 'invalid_response', message: 'non-object JSON body' }
  }

  const json = body as { error?: unknown; result?: unknown }
  if (json.error != null) {
    return { kind: 'invalid_response', message: 'JSON-RPC error field present' }
  }

  if (chainKey.startsWith('evm:')) {
    if (typeof json.result !== 'string' || !json.result.startsWith('0x')) {
      return { kind: 'invalid_response', message: 'EVM JSON-RPC result invalid' }
    }
  } else if (chainKey === 'solana') {
    if (json.result !== 'ok' && json.result == null) {
      return { kind: 'invalid_response', message: 'Solana JSON-RPC result invalid' }
    }
  } else if (chainKey === 'sui') {
    if (json.result == null) {
      return { kind: 'invalid_response', message: 'Sui JSON-RPC result invalid' }
    }
  }

  return null
}

async function probeEndpoint(chainKey: RpcMeshChainKey, url: string): Promise<boolean> {
  try {
    if (chainKey === 'aptos') {
      const { statusCode } = await request(`${url.replace(/\/$/, '')}/`, {
        method: 'GET',
        headersTimeout: REQUEST_TIMEOUT_MS,
        bodyTimeout: REQUEST_TIMEOUT_MS,
      })
      return statusCode >= 200 && statusCode < 500
    }

    const method =
      chainKey.startsWith('evm:') ? 'eth_blockNumber' :
      chainKey === 'solana' ? 'getHealth' :
      'sui_getChainIdentifier'

    const { body, statusCode } = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
      headersTimeout: REQUEST_TIMEOUT_MS,
      bodyTimeout: REQUEST_TIMEOUT_MS,
    })

    if (statusCode >= 500 || statusCode !== 200) {
      await body.dump()
      return false
    }

    const json = await body.json()
    return isRequestFailure(statusCode, json, chainKey) == null
  } catch {
    return false
  }
}

type EndpointRuntime = {
  url: string
  tier: RpcEndpointTier
  deadUntil: number
  lastError: string | null
  lastSuccessAt: number | null
  lastFailureAt: number | null
  successCount: number
  failureCount: number
}

type ChainRuntime = {
  endpoints: EndpointRuntime[]
  successCount: number
  failureCount: number
}

export class RpcMesh {
  private readonly chains = new Map<RpcMeshChainKey, ChainRuntime>()
  private recoveryTimer: ReturnType<typeof setInterval> | null = null
  private lastRecoveryProbeAt: number | null = null

  constructor() {
    this.refreshAllChains()
    this.startRecoveryProbe()
  }

  refreshAllChains(): void {
    const keys: RpcMeshChainKey[] = [
      ...EVM_CHAIN_IDS.map((id) => `evm:${id}` as RpcMeshChainKey),
      'solana',
      'aptos',
      'sui',
    ]
    for (const chainKey of keys) {
      this.refreshChain(chainKey)
    }
  }

  refreshChain(chainKey: RpcMeshChainKey): void {
    const spec = buildEndpointList(chainKey)
    const existing = this.chains.get(chainKey)
    const preserved = new Map(
      (existing?.endpoints ?? []).map((e) => [e.url, e]),
    )

    const endpoints: EndpointRuntime[] = spec.map((entry) => {
      const prev = preserved.get(entry.url)
      return {
        url: entry.url,
        tier: entry.tier,
        deadUntil: prev?.deadUntil ?? 0,
        lastError: prev?.lastError ?? null,
        lastSuccessAt: prev?.lastSuccessAt ?? null,
        lastFailureAt: prev?.lastFailureAt ?? null,
        successCount: prev?.successCount ?? 0,
        failureCount: prev?.failureCount ?? 0,
      }
    })

    this.chains.set(chainKey, {
      endpoints,
      successCount: existing?.successCount ?? 0,
      failureCount: existing?.failureCount ?? 0,
    })
  }

  private chainOrRefresh(chainKey: RpcMeshChainKey): ChainRuntime {
    let chain = this.chains.get(chainKey)
    if (!chain || chain.endpoints.length === 0) {
      this.refreshChain(chainKey)
      chain = this.chains.get(chainKey)
    }
    return chain ?? { endpoints: [], successCount: 0, failureCount: 0 }
  }

  private isDead(endpoint: EndpointRuntime, now = Date.now()): boolean {
    return endpoint.deadUntil > now
  }

  getOrderedEndpoints(chainKey: RpcMeshChainKey): RpcEndpointHealth[] {
    const chain = this.chainOrRefresh(chainKey)
    const now = Date.now()
    return chain.endpoints.map((e) => ({
      url: e.url,
      tier: e.tier,
      dead: this.isDead(e, now),
      deadUntil: e.deadUntil > now ? new Date(e.deadUntil).toISOString() : null,
      lastError: e.lastError,
      lastSuccessAt: e.lastSuccessAt != null ? new Date(e.lastSuccessAt).toISOString() : null,
      lastFailureAt: e.lastFailureAt != null ? new Date(e.lastFailureAt).toISOString() : null,
      successCount: e.successCount,
      failureCount: e.failureCount,
    }))
  }

  getHealthyEndpoints(chainKey: RpcMeshChainKey): string[] {
    const now = Date.now()
    const chain = this.chainOrRefresh(chainKey)
    const healthy = chain.endpoints.filter((e) => !this.isDead(e, now)).map((e) => e.url)
    if (healthy.length > 0) return healthy
    return chain.endpoints.map((e) => e.url)
  }

  /** Current preferred RPC URL for a chain (first healthy endpoint). */
  getActiveEndpoint(chainKey: RpcMeshChainKey): string | null {
    const healthy = this.getHealthyEndpoints(chainKey)
    return healthy[0] ?? null
  }

  recordSuccess(chainKey: RpcMeshChainKey, url: string): void {
    const chain = this.chainOrRefresh(chainKey)
    const endpoint = chain.endpoints.find((e) => e.url === url)
    if (!endpoint) return
    const now = Date.now()
    endpoint.deadUntil = 0
    endpoint.lastError = null
    endpoint.lastSuccessAt = now
    endpoint.successCount += 1
    chain.successCount += 1
  }

  recordFailure(chainKey: RpcMeshChainKey, url: string, reason: string): void {
    if (!isRpcCircuitBreakerEnabled()) return
    const chain = this.chainOrRefresh(chainKey)
    const endpoint = chain.endpoints.find((e) => e.url === url)
    if (!endpoint) return
    const now = Date.now()
    endpoint.deadUntil = now + DEAD_COOLDOWN_MS
    endpoint.lastError = reason
    endpoint.lastFailureAt = now
    endpoint.failureCount += 1
    chain.failureCount += 1
  }

  /**
   * Execute an RPC HTTP request with automatic endpoint failover.
   * Marks failures dead (5 min cooldown) and rotates to the next healthy endpoint.
   */
  async executeWithFailover<T>(
    chainKey: RpcMeshChainKey,
    fn: (url: string) => Promise<T>,
    validate?: (result: T) => RpcMeshRequestError | null,
  ): Promise<T> {
    const urls = this.getHealthyEndpoints(chainKey)
    if (urls.length === 0) {
      throw new Error(`No RPC endpoints configured for ${chainKey}`)
    }

    let lastError = 'all endpoints failed'

    for (const url of urls) {
      try {
        const result = await fn(url)
        const validationError = validate?.(result) ?? null
        if (validationError) {
          this.recordFailure(chainKey, url, validationError.message)
          lastError = validationError.message
          continue
        }
        this.recordSuccess(chainKey, url)
        return result
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        const reason = /timeout|timed out/i.test(message) ? `timeout: ${message}` : message
        this.recordFailure(chainKey, url, reason)
        lastError = reason
      }
    }

    throw new Error(`RPC mesh exhausted for ${chainKey}: ${lastError}`)
  }

  /** JSON-RPC POST with circuit-breaker failover. */
  async jsonRpc(
    chainKey: RpcMeshChainKey,
    method: string,
    params: unknown[] = [],
  ): Promise<unknown> {
    return this.executeWithFailover(
      chainKey,
      async (url) => {
        const { body, statusCode } = await request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          headersTimeout: REQUEST_TIMEOUT_MS,
          bodyTimeout: REQUEST_TIMEOUT_MS,
        })
        if (statusCode >= 500) {
          await body.dump()
          throw new Error(`HTTP ${statusCode}`)
        }
        if (statusCode !== 200) {
          await body.dump()
          throw new Error(`HTTP ${statusCode}`)
        }
        return body.json()
      },
      (json) => isRequestFailure(200, json, chainKey),
    )
  }

  getChainStatus(chainKey: RpcMeshChainKey): RpcMeshChainStatus {
    const chain = this.chainOrRefresh(chainKey)
    const endpoints = this.getOrderedEndpoints(chainKey)
    const deadCount = endpoints.filter((e) => e.dead).length
    return {
      chainKey,
      circuitBreakerEnabled: isRpcCircuitBreakerEnabled(),
      deadCount,
      totalEndpoints: endpoints.length,
      successCount: chain.successCount,
      failureCount: chain.failureCount,
      activeEndpoint: this.getActiveEndpoint(chainKey),
      endpoints,
    }
  }

  getStatusSnapshot(): RpcMeshStatusSnapshot {
    const keys: RpcMeshChainKey[] = [
      ...EVM_CHAIN_IDS.map((id) => `evm:${id}` as RpcMeshChainKey),
      'solana',
      'aptos',
      'sui',
    ]
    return {
      circuitBreakerEnabled: isRpcCircuitBreakerEnabled(),
      deadCooldownMs: DEAD_COOLDOWN_MS,
      recoveryProbeIntervalMs: RECOVERY_PROBE_INTERVAL_MS,
      lastRecoveryProbeAt:
        this.lastRecoveryProbeAt != null
          ? new Date(this.lastRecoveryProbeAt).toISOString()
          : null,
      chains: keys
        .map((key) => this.getChainStatus(key))
        .filter((c) => c.totalEndpoints > 0),
    }
  }

  /** Re-probe dead endpoints and clear cooldown when recovered. */
  async probeDeadEndpoints(): Promise<void> {
    this.lastRecoveryProbeAt = Date.now()
    const now = Date.now()

    for (const [chainKey, chain] of this.chains.entries()) {
      for (const endpoint of chain.endpoints) {
        if (endpoint.deadUntil <= now) continue
        const ok = await probeEndpoint(chainKey, endpoint.url)
        if (ok) {
          endpoint.deadUntil = 0
          endpoint.lastError = null
          endpoint.lastSuccessAt = Date.now()
        }
      }
    }
  }

  startRecoveryProbe(): void {
    if (this.recoveryTimer != null) return
    if (typeof setInterval === 'undefined') return

    this.recoveryTimer = setInterval(() => {
      void this.probeDeadEndpoints()
    }, RECOVERY_PROBE_INTERVAL_MS)

    if (typeof this.recoveryTimer === 'object' && 'unref' in this.recoveryTimer) {
      this.recoveryTimer.unref()
    }
  }

  stopRecoveryProbe(): void {
    if (this.recoveryTimer != null) {
      clearInterval(this.recoveryTimer)
      this.recoveryTimer = null
    }
  }
}

let meshSingleton: RpcMesh | null = null

export function getRpcMesh(): RpcMesh {
  if (!meshSingleton) meshSingleton = new RpcMesh()
  return meshSingleton
}

/** Resolve active EVM RPC URL via circuit-breaker mesh. */
export function resolveEvmRpcFromMesh(chainId: number): string | null {
  return getRpcMesh().getActiveEndpoint(`evm:${chainId}`)
}

export function resolveSolanaRpcFromMesh(): string | null {
  return getRpcMesh().getActiveEndpoint('solana')
}

export function resolveAptosRpcFromMesh(): string | null {
  return getRpcMesh().getActiveEndpoint('aptos')
}

export function resolveSuiRpcFromMesh(): string | null {
  return getRpcMesh().getActiveEndpoint('sui')
}
