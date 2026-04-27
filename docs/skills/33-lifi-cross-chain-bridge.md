# SKILL-33: LI.FI CROSS-CHAIN BRIDGE — DISPATCHER ROUTING LAYER

SOURCE: https://github.com/lifinance/sdk

CATEGORY: CROSS-CHAIN — Dispatcher Sentinel

[STRICT_RULES]
• ALWAYS use LI.FI `/quote` API before bridging — never construct bridge tx manually without SDK validation
• Route MUST pass Gatekeeper policy check BEFORE execution — `allowBridges` / `denyBridges` must be configured
• NEVER bridge with `slippage > 0.03` (3%) — reject routes that require higher slippage tolerance
• Routes expire — NEVER cache quotes >30s; refetch before submitting bridging tx
• Each route Step has its own `transactionRequest` — execute steps SEQUENTIALLY, never in parallel
• `ACTION_REQUIRED` event MUST block execution and surface to user — it means wallet confirmation is needed
• Cross-chain steps require waiting for `CROSS_CHAIN_INITIATED` then monitoring destination — never assume instant finality
• Use `allowBridges: ['stargate', 'across']` allowlist pattern — denylist alone is insufficient for MEV safety
• ALWAYS handle `FAILED` event with full retry logic — bridge failures are recoverable with new route
• SDK uses Viem natively — pass `WalletClient` directly, never wrap with custom signer abstraction

[MENTAL_MODEL]
• LI.FI = unified cross-chain routing layer — one API covers 20+ bridges + DEX aggregators across 30+ chains
• Route = ordered array of Steps; each Step = one on-chain tx (swap, bridge, or both combined)
• `/quote` → ranked routes array → pick best by score → `executeRoute` → sequential step execution
• Score criteria: speed (bridge finality time), cost (fees + slippage), safety (bridge security score)
• Gatekeeper = policy layer — filter routes at discovery stage, not after — `allowBridges` whitelist is Legion's safety valve
• Events emitted during execution: `STARTED` → `ACTION_REQUIRED` (wallet sign) → `CROSS_CHAIN_INITIATED` → `DONE` / `FAILED`
• Destination chain calls: LI.FI supports calling a contract on destination chain atomically with the bridge — use for DeFi actions
• Viem compatibility: `transactionRequest` from each Step maps directly to Viem `sendTransaction` params — no conversion needed

[REAL_API]
=== LI.FI REST API ===
// Base URL
const LIFI_API = 'https://li.quest/v1'

// Quote endpoint
// POST /quote
// Body: { fromChain, toChain, fromToken, toToken, fromAmount, fromAddress, allowBridges?, denyBridges? }
// Returns: best route with steps array

=== LI.FI SDK (TypeScript) ===
import { createConfig, EVM, getRoutes, executeRoute } from '@lifi/sdk'
import { createWalletClient, http } from 'viem'
import { mainnet } from 'viem/chains'

// Initialize SDK with Viem wallet client
createConfig({
  integrators: ['legion-engine'],
  providers: [
    EVM({
      getWalletClient: async () => walletClient,
      switchChain: async (chainId) => createWalletClient({ chain: getChainById(chainId), transport: http() })
    })
  ]
})

// Get routes with Gatekeeper policy
const routes = await getRoutes({
  fromChainId: 1,         // Ethereum
  toChainId: 42161,       // Arbitrum
  fromTokenAddress: USDC_ETH,
  toTokenAddress: USDC_ARB,
  fromAmount: '1000000000',  // 1000 USDC (6 decimals)
  fromAddress: walletAddress,
  options: {
    slippage: 0.005,           // 0.5% max slippage
    allowBridges: ['stargate', 'across', 'connext'],
    order: 'RECOMMENDED'       // FASTEST | CHEAPEST | SAFEST | RECOMMENDED
  }
})

// Select best route and execute
const bestRoute = routes.routes[0]
const executedRoute = await executeRoute(bestRoute, {
  updateRouteHook: (updatedRoute) => {
    const lastStep = updatedRoute.steps[updatedRoute.steps.length - 1]
    // Handle events
    if (lastStep.execution?.status === 'ACTION_REQUIRED') {
      console.log('Wallet action required — surfacing to user')
    }
    if (lastStep.execution?.status === 'CROSS_CHAIN_INITIATED') {
      console.log('Bridge initiated — monitoring destination chain')
    }
  }
})

=== Check Token Support ===
// GET https://li.quest/v1/tokens?chains=1,42161
// Returns all supported tokens per chain

[LEGION USE CASES]
• Cross-chain capital rebalancing: move profits from Arbitrum MEV back to Ethereum mainnet via Stargate route
• Multi-chain extraction: detect opportunity on Polygon, bridge USDC from Ethereum, execute, bridge profits back
• Cheapest route finder: query all routes for a bridge, sort by `gasCostUSD + feeCostUSD` — pick minimum cost path
• Destination chain DeFi: bridge ETH to Arbitrum AND deposit into Aave in single atomic cross-chain tx
• Bridge monitoring: subscribe to route events to track cross-chain tx status for Sentinel health dashboard
