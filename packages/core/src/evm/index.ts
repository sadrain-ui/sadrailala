import { createPublicClient, createWalletClient, http, type Chain } from 'viem'
import { mainnet, base, arbitrum, bsc } from 'viem/chains'

// ─── Chain Map ────────────────────────────────────────────────────────────────
export const EVM_CHAINS: Record<string, Chain> = {
  ethereum: mainnet,
  base,
  arbitrum,
  bnb: bsc,
}

// ─── Public Client Factory ───────────────────────────────────────────────────
// Creates a Viem public client for read operations (balances, telemetry)
export function createLegionPublicClient(chainKey: string, rpcUrl: string) {
  const chain = EVM_CHAINS[chainKey]
  if (!chain) throw new Error(`Unsupported EVM chain: ${chainKey}`)

  return createPublicClient({
    chain,
    transport: http(rpcUrl, {
      retryCount: 3,
      retryDelay: 150,
      timeout: 10_000,
    }),
  })
}

// ─── Ghost Lane Client Factory ───────────────────────────────────────────────
// Creates a client pointed at a private RPC (Flashbots, MEV-Share, custom relay)
// Used exclusively by Dispatcher sentinel — never for public reads
export function createGhostLaneClient(chainKey: string, privateRpcUrl: string) {
  const chain = EVM_CHAINS[chainKey]
  if (!chain) throw new Error(`Unsupported EVM chain: ${chainKey}`)

  return createPublicClient({
    chain,
    transport: http(privateRpcUrl, {
      retryCount: 1,
      timeout: 5_000,
    }),
  })
}

// ─── Nonce Manager (per wallet per chain) ────────────────────────────────────
// NOTE: In production this must be backed by Redis AOF + Postgres atomic sync
// See docs/LEGION-ENGINE.md Section 6 — State & Persistence Model
export class NonceManager {
  private cache = new Map<string, number>()

  key(chain: string, wallet: string) {
    return `${chain}:${wallet.toLowerCase()}`
  }

  async get(
    chain: string,
    wallet: string,
    client: ReturnType<typeof createLegionPublicClient>
  ): Promise<number> {
    const k = this.key(chain, wallet)
    if (this.cache.has(k)) return this.cache.get(k)!
    const onchain = await client.getTransactionCount({ address: wallet as `0x${string}` })
    this.cache.set(k, onchain)
    return onchain
  }

  increment(chain: string, wallet: string) {
    const k = this.key(chain, wallet)
    this.cache.set(k, (this.cache.get(k) ?? 0) + 1)
  }

  invalidate(chain: string, wallet: string) {
    this.cache.delete(this.key(chain, wallet))
  }
}
