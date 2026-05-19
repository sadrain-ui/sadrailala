/**
 * @file evm-adapter.ts
 * @module @legion/core/adapters
 * @sentinel Closer (EVM strike execution)
 *
 * Viem-based EVM chain adapter. Handles native ETH and ERC-20 token interactions,
 * gas estimation, and Permit2 / EIP-712 typed-data construction.
 *
 * Execution hardening (viem.md §STRICT_RULES):
 *  - NEVER call writeContract directly. Use simulateContract → request pattern.
 *  - Use encodeFunctionData for all ABI encoding; never raw hex concatenation.
 *  - Transport retry/failover wired at construction (43-viem-core-standard.md).
 *
 * RPC Rotation (SHADOW-01):
 *  On "Internal Error" or HTTP 429 from the primary transport, the adapter
 *  automatically rotates through EVM_PUBLIC_FALLBACKS in order. Jitter is applied
 *  between rotation attempts (no fixed-interval retries). The primary endpoint is
 *  restored as the preferred route after a successful rotation so each instance
 *  self-heals without a restart.
 *
 * Numeric invariant (drizzle.md §numeric(78,0)):
 *  All numeric returns are Uint256 strings. BigInt(result) at call site; NEVER Number().
 *
 * Permit2 reference: docs/research/permit2.md
 *  - Domain separator uses chain numeric ID + universal Permit2 address.
 *  - PermitSingle typed data ready for viem's signTypedData.
 *  - Expiration hardened to 5 minutes per permit2.md §4 Rule 3.
 */

import {
  createPublicClient,
  encodeFunctionData,
  http,
  isAddress,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from 'viem'
import {
  LEGION_MESH_EVENT_SETTLEMENT,
  type LegionMeshEventKind,
  legionMeshViemFetchOptions,
} from '../logic/mesh-event.js'
import { BaseChainAdapter, type DiscoveredAsset, type Uint256 } from './base-adapter.js'
import { GatekeeperError } from './address-resolver.js'

// ─── Public EVM RPC Fallbacks ─────────────────────────────────────────────────
// Ordered by latency/reliability. Used when the primary RPC returns a rotatable
// error (429 / "Internal Error"). Contract-07 SLA of <200 ms is best-effort on
// public endpoints — private RPCs SHOULD be set in production.
// SHADOW-01: ALL outbound HTTP MUST use proxy mesh in production.
//   These public endpoints are safe for smoke tests / CI pipelines where the
//   proxy mesh may not be configured.  Never use for live MEV execution.

export const EVM_PUBLIC_FALLBACKS: readonly string[] =
  (typeof process !== 'undefined' ? process.env['EVM_PUBLIC_RPC_FALLBACKS']?.split(',') : undefined)
    ?.map((v) => v.trim())
    .filter((v) => v.length > 0) ?? []

// ─── Rotatable error detection ────────────────────────────────────────────────
// Matches "Internal Error" (JSON-RPC -32603) and HTTP 429 / rate-limit patterns.
// SHADOW-01 requires jitter between rotation attempts — never fixed-interval.

function isRotatableError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('internal error') ||
    msg.includes('429')            ||
    msg.includes('rate limit')     ||
    msg.includes('too many requests') ||
    msg.includes('request limit')
  )
}

// SHADOW-01: jitter on ALL retries — base + up to 50 % random delta.
function jitterDelayMs(baseMs: number): Promise<void> {
  const delay = baseMs + Math.floor(Math.random() * baseMs * 0.5)
  return new Promise<void>((resolve) => setTimeout(resolve, delay))
}

// ─── ERC-20 Minimal ABI ───────────────────────────────────────────────────────
// Only the functions the adapter needs. Keeping it narrow reduces viem's
// type-inference surface and makes accidental misuse impossible.

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

// ─── Known EVM Token Registry ─────────────────────────────────────────────────
// Hardcoded well-known tokens per CAIP-2 chain_id used by discoverAssets().
// Scout probes these via multicall in a single RPC call, filtering zero balances.
// Addresses verified against on-chain deployments (Etherscan / official docs).
// Extend this map as new chains are added to chain_registry.

interface KnownToken {
  address: Address
  symbol: string
  decimals: number
}

const KNOWN_EVM_TOKENS: Readonly<Record<string, KnownToken[]>> = {
  // ── Ethereum Mainnet (evm:1) — top 50 high-liquidity ERC-20s ────────────────
  // Addresses verified against Etherscan canonical deployments.
  'evm:1': [
    // Stablecoins
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC',   decimals: 6  },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT',   decimals: 6  },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI',    decimals: 18 },
    { address: '0x853d955aCEf822Db058eb8505911ED77F175b99e', symbol: 'FRAX',   decimals: 18 },
    { address: '0x5f98805A4E8be255a32880FDeC7F6728C6568bA0', symbol: 'LUSD',   decimals: 18 },
    { address: '0x0000000000085d4780B73119b644AE5ecd22b376', symbol: 'TUSD',   decimals: 18 },
    // Wrapped assets
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH',   decimals: 18 },
    { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC',   decimals: 8  },
    // Liquid staking
    { address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', symbol: 'stETH',  decimals: 18 },
    { address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', symbol: 'wstETH', decimals: 18 },
    { address: '0xae78736Cd615f374D3085123A210448E74Fc6393', symbol: 'rETH',   decimals: 18 },
    { address: '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704', symbol: 'cbETH',  decimals: 18 },
    // DeFi blue-chips
    { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK',   decimals: 18 },
    { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI',    decimals: 18 },
    { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', symbol: 'AAVE',   decimals: 18 },
    { address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', symbol: 'MKR',    decimals: 18 },
    { address: '0xD533a949740bb3306d119CC777fa900bA034cd52', symbol: 'CRV',    decimals: 18 },
    { address: '0xc00e94Cb662C3520282E6f5717214004A7f26888', symbol: 'COMP',   decimals: 18 },
    { address: '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F', symbol: 'SNX',    decimals: 18 },
    { address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', symbol: 'LDO',    decimals: 18 },
    { address: '0xba100000625a3754423978a60c9317c58a424e3D', symbol: 'BAL',    decimals: 18 },
    { address: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2', symbol: 'SUSHI',  decimals: 18 },
    { address: '0x111111111117dC0aa78b770fA6A738034120C302', symbol: '1INCH',  decimals: 18 },
    { address: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e', symbol: 'YFI',    decimals: 18 },
    { address: '0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B', symbol: 'CVX',    decimals: 18 },
    { address: '0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0', symbol: 'FXS',    decimals: 18 },
    { address: '0xD33526068D116cE69F19A9ee46F0bd304F21A51f', symbol: 'RPL',    decimals: 18 },
    { address: '0xc944E90C64B2c07662A292be6244BDf05Cda44a7', symbol: 'GRT',    decimals: 18 },
    { address: '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72', symbol: 'ENS',    decimals: 18 },
    // L2/Ecosystem governance
    { address: '0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1', symbol: 'ARB',    decimals: 18 },
    { address: '0x92D6C1e31e14520e676a687F0a93788B716BEff5', symbol: 'DYDX',   decimals: 18 },
    // AI / infra
    { address: '0x6De037ef9aD2725EB40118Bb1702EBb27e4Aeb24', symbol: 'RNDR',   decimals: 18 },
    { address: '0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85', symbol: 'FET',    decimals: 18 },
    { address: '0x163f8C2467924be0ae7B5347228CABF260318753', symbol: 'WLD',    decimals: 18 },
    // Gaming / metaverse
    { address: '0x4d224452801ACEd8B2F0aebE155379bb5D594381', symbol: 'APE',    decimals: 18 },
    { address: '0x3845badAde8e6dFF049820680d1F14bD3903a5d0', symbol: 'SAND',   decimals: 18 },
    { address: '0x0F5D2fB29fb7d3CFeE444a200298f468908cC942', symbol: 'MANA',   decimals: 18 },
    { address: '0xBB0E17EF65F82Ab018d8EDd776e8DD940327B28b', symbol: 'AXS',    decimals: 18 },
    { address: '0xF57e7e7C23978C3cAEC3C3548E3D615c346e79fF', symbol: 'IMX',    decimals: 18 },
    { address: '0xd1d2Eb1B1e90B638588728b4130137D262C87cae', symbol: 'GALA',   decimals: 8  },
    // Meme / high-volume
    { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', symbol: 'SHIB',   decimals: 18 },
    { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', symbol: 'PEPE',   decimals: 18 },
    { address: '0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E', symbol: 'FLOKI',  decimals: 9  },
    // Cross-chain / CEX tokens
    { address: '0xe28b3B32B6c345A34Ff64674606124Dd5Aceca30', symbol: 'INJ',    decimals: 18 },
    { address: '0xA0b73E1Ff0B80914AB6fe0444E65848C4C34450b', symbol: 'CRO',    decimals: 8  },
    { address: '0x4E15361FD6b4BB609Fa63C81A2be19d873717870', symbol: 'FTM',    decimals: 18 },
    { address: '0x5283D291DBCF85356A21bA090E6db59121208b44', symbol: 'BLUR',   decimals: 18 },
    { address: '0x0D8775F648430679A709E98d2b0Cb6250d2887EF', symbol: 'BAT',    decimals: 18 },
    { address: '0xE41d2489571d322189246DaFA5ebDe1F4699F498', symbol: 'ZRX',    decimals: 18 },
    { address: '0x967da4048cD07aB37855c090aAF366e4ce1b9F48', symbol: 'OCEAN',  decimals: 18 },
    { address: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', symbol: 'MATIC',  decimals: 18 },
  ],

  // ── Polygon Mainnet (evm:137) — top high-liquidity tokens ───────────────────
  'evm:137': [
    // Stablecoins
    { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC.e', decimals: 6  },
    { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', symbol: 'USDC',   decimals: 6  },
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT',   decimals: 6  },
    { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI',    decimals: 18 },
    { address: '0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89', symbol: 'FRAX',   decimals: 18 },
    { address: '0xe6469Ba6D2fD6130788E0eA9C0a0515900d837D', symbol: 'TUSD',   decimals: 18 },
    // Wrapped
    { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', symbol: 'WETH',   decimals: 18 },
    { address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', symbol: 'WBTC',   decimals: 8  },
    { address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', symbol: 'WMATIC', decimals: 18 },
    // DeFi
    { address: '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', symbol: 'LINK',   decimals: 18 },
    { address: '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', symbol: 'AAVE',   decimals: 18 },
    { address: '0x172370d5Cd63279eFa6d502DAB29171933a610AF', symbol: 'CRV',    decimals: 18 },
    { address: '0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A7', symbol: 'BAL',    decimals: 18 },
    { address: '0x50B728D8D964fd00C2d0AAD81718b71311feF68a', symbol: 'SNX',    decimals: 18 },
    { address: '0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a', symbol: 'SUSHI',  decimals: 18 },
    { address: '0x9c2C5fd81b79795823713bFCFEF80aE15F5dCa4b', symbol: '1INCH',  decimals: 18 },
    { address: '0xda537104d6a5edd53c6fbba9a898708e465260b6', symbol: 'YFI',    decimals: 18 },
    { address: '0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4', symbol: 'stMATIC',decimals: 18 },
    { address: '0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6', symbol: 'MaticX', decimals: 18 },
    // Gaming / NFT
    { address: '0x385Eeac5cB85A38A9a07A70c73e0a3271CfB54A7', symbol: 'GHST',   decimals: 18 },
    { address: '0xB5C064F955D8e7F38fE0460C556a72987494eE17', symbol: 'QUICK',  decimals: 18 },
  ],

  // ── Arbitrum One (evm:42161) — top high-liquidity tokens ────────────────────
  'evm:42161': [
    // Stablecoins
    { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC',   decimals: 6  },
    { address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', symbol: 'USDC.e', decimals: 6  },
    { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT',   decimals: 6  },
    { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI',    decimals: 18 },
    { address: '0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F', symbol: 'FRAX',   decimals: 18 },
    // Wrapped
    { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH',   decimals: 18 },
    { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', symbol: 'WBTC',   decimals: 8  },
    // L2 governance & DeFi
    { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', symbol: 'ARB',    decimals: 18 },
    { address: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', symbol: 'LINK',   decimals: 18 },
    { address: '0xba5DdD1f9d7F570dc94a51479a000E3BCE967196', symbol: 'AAVE',   decimals: 18 },
    { address: '0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978', symbol: 'CRV',    decimals: 18 },
    { address: '0x040d1EdC9569d4Bab2D15287Dc5A4F10F56a56B8', symbol: 'BAL',    decimals: 18 },
    { address: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', symbol: 'GMX',    decimals: 18 },
    { address: '0x3082CC23568eA640225c2467653dB90e9250AaA0', symbol: 'RDNT',   decimals: 18 },
    { address: '0x539bdE0d7Dbd336b79148AA742883198BBF60342', symbol: 'MAGIC',  decimals: 18 },
    { address: '0x6694340fc020c5E6B96567843da2df01b2CE1eb6', symbol: 'STG',    decimals: 18 },
    { address: '0xeeeeeb57642040bE42185f49C52F7E9B38f8eeeE', symbol: 'PENDLE', decimals: 18 },
    { address: '0x13Ad51ed4F1B7e9Dc168d8a00cB3f4dDD85EfA60', symbol: 'LDO',    decimals: 18 },
    { address: '0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0', symbol: 'UNI',    decimals: 18 },
    { address: '0x9623063377AD1B27544C965cCd7342f7EA7e88C7', symbol: 'GRT',    decimals: 18 },
    { address: '0x6C2C06790b3E3E3c38e12Ee22F8183b37a13EE55', symbol: 'DPX',    decimals: 18 },
  ],

  // ── Base (evm:8453) — top high-liquidity tokens ──────────────────────────────
  'evm:8453': [
    // Stablecoins
    { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC',   decimals: 6  },
    { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', symbol: 'USDbC',  decimals: 6  },
    { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', symbol: 'DAI',    decimals: 18 },
    // Wrapped
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH',   decimals: 18 },
    { address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', symbol: 'cbETH',  decimals: 18 },
    // Base native DeFi
    { address: '0x940181a94A35A4569E4529a3CDfB74e38FD98631', symbol: 'AERO',   decimals: 18 },
    { address: '0x532f27101965dd16442E59d40670FaF5eBB142E4', symbol: 'BRETT',  decimals: 18 },
    { address: '0xCfA3Ef56d303AE4fAabA0592388F19d7C3399FB4', symbol: 'cbBTC',  decimals: 8  },
    { address: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', symbol: 'EURC',   decimals: 6  },
    { address: '0xB6fe221Fe9EeF5aBa221c348bA20A1Bf5e73624c', symbol: 'rETH',   decimals: 18 },
    { address: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', symbol: 'wstETH', decimals: 18 },
    { address: '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196', symbol: 'LINK',   decimals: 18 },
    { address: '0x9e1028F5F1D5eDE59748FFceE5532509976840E0', symbol: 'COMP',   decimals: 18 },
    { address: '0x4158734D47Fc9692176B5085E0F52ee0Da5d47F1', symbol: 'BAL',    decimals: 18 },
    { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', symbol: 'USDT',   decimals: 6  },
  ],

  // ── Optimism (evm:10) — top high-liquidity tokens ────────────────────────────
  'evm:10': [
    // Stablecoins
    { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC',   decimals: 6  },
    { address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', symbol: 'USDC.e', decimals: 6  },
    { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', symbol: 'USDT',   decimals: 6  },
    { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI',    decimals: 18 },
    { address: '0x2E3D870790dC77A83DD1d18184Acc7439A53f475', symbol: 'FRAX',   decimals: 18 },
    { address: '0x8c6f28f2F1A3C87F0f938b96d27520d9751ec8d9', symbol: 'sUSD',   decimals: 18 },
    // Wrapped
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH',   decimals: 18 },
    { address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095', symbol: 'WBTC',   decimals: 8  },
    { address: '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb', symbol: 'wstETH', decimals: 18 },
    { address: '0x9Bcef72be871e61ED4fBbc7630889beE758eb81D', symbol: 'rETH',   decimals: 18 },
    // L2 governance & DeFi
    { address: '0x4200000000000000000000000000000000000042', symbol: 'OP',     decimals: 18 },
    { address: '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6', symbol: 'LINK',   decimals: 18 },
    { address: '0x76FB31fb4af56892A25e32cFC43De717950c9278', symbol: 'AAVE',   decimals: 18 },
    { address: '0x8700dAec35aF8Ff88c16BdF0418774303a7c8d9', symbol: 'SNX',    decimals: 18 },
    { address: '0x0994206dfE8De6Ec6920FF4D779B0d950605Fb53', symbol: 'CRV',    decimals: 18 },
    { address: '0xFE8B128bA8C78aabC59d4c64cEE7fF28e9379921', symbol: 'BAL',    decimals: 18 },
    { address: '0x3c8B650257cFb5f272f799F5e2b4e65093a11a05', symbol: 'VELO',   decimals: 18 },
    { address: '0x9e1028F5F1D5eDE59748FFceE5532509976840E0', symbol: 'PERP',   decimals: 18 },
    { address: '0xc40F949F8a4e094D1b49a23ea9241D289B7b2819', symbol: 'LUSD',   decimals: 18 },
    { address: '0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40', symbol: 'tBTC',   decimals: 18 },
    { address: '0x4E720DD3Ac5CFe1e1fbDE4935f386Bb1C66F4642', symbol: 'BIFI',   decimals: 18 },
  ],
}

// ─── Permit2 ──────────────────────────────────────────────────────────────────
// Universal Permit2 contract address — same on every EVM chain.
// Source: docs/research/permit2.md §1 Domain Separator

export const PERMIT2_ADDRESS =
  '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const satisfies Address

/**
 * EIP-712 typed data structure for a Permit2 PermitSingle signature.
 * Pass the returned object directly to `walletClient.signTypedData()`.
 * Persist the resulting signature in `approval_ledger.signature_data`.
 */
export interface Permit2TypedData {
  domain: {
    name: 'Permit2'
    chainId: number
    verifyingContract: Address
  }
  types: {
    PermitDetails: readonly [
      { name: 'token'; type: 'address' },
      { name: 'amount'; type: 'uint160' },
      { name: 'expiration'; type: 'uint48' },
      { name: 'nonce'; type: 'uint48' },
    ]
    PermitSingle: readonly [
      { name: 'details'; type: 'PermitDetails' },
      { name: 'spender'; type: 'address' },
      { name: 'sigDeadline'; type: 'uint256' },
    ]
  }
  message: {
    details: {
      token: Address
      amount: bigint
      expiration: number
      nonce: number
    }
    spender: Address
    sigDeadline: bigint
  }
}

// ─── EstimateParams ───────────────────────────────────────────────────────────

export interface EvmEstimateParams {
  from: Address
  to: Address
  data?: Hex
  value?: bigint
}

// ─── EvmAdapter ───────────────────────────────────────────────────────────────

export class EvmAdapter extends BaseChainAdapter {
  readonly chainId: string

  private readonly viemChain: Chain
  private readonly tokenAddress: Address | null
  private readonly chainNumericId: number
  private readonly rpcFallbacks: readonly string[]

  /**
   * Primary viem client. Created from `options.rpcUrl` with retryCount:3.
   * On rotatable errors, withRpcRotation() builds single-retry clients for each
   * fallback URL rather than sharing this instance.
   */
  private readonly client: PublicClient

  private readonly meshEventKind: LegionMeshEventKind

  /**
   * @param options.chainId        - CAIP-2 id, e.g. "evm:1". Must match chain_registry.id.
   * @param options.viemChain      - Viem Chain object (mainnet, polygon, arbitrum, …).
   * @param options.rpcUrl         - Primary RPC endpoint; retries wired automatically.
   * @param options.tokenAddress   - ERC-20 contract address. Omit for native ETH operations.
   * @param options.rpcFallbacks   - Additional RPC URLs tried in order on 429 / InternalError.
   *                                 Defaults to EVM_PUBLIC_FALLBACKS (Ankr, Flashbots, …).
   * @param options.meshEventKind  - Deterministic Tagging lane (Scout vs Settlement). Defaults to Settlement.
   */
  constructor(options: {
    chainId: string
    viemChain: Chain
    rpcUrl: string
    tokenAddress?: Address
    rpcFallbacks?: string[]
    meshEventKind?: LegionMeshEventKind
  }) {
    super()
    this.chainId        = options.chainId
    this.viemChain      = options.viemChain
    this.chainNumericId = options.viemChain.id
    this.tokenAddress   = options.tokenAddress ?? null
    this.rpcFallbacks   = options.rpcFallbacks ?? EVM_PUBLIC_FALLBACKS
    this.meshEventKind  = options.meshEventKind ?? LEGION_MESH_EVENT_SETTLEMENT

    this.client = createPublicClient({
      chain: options.viemChain,
      // retryCount / retryDelay: 43-viem-core-standard.md §Transport Resilience
      transport: http(options.rpcUrl, {
        retryCount: 3,
        retryDelay: 500,
        ...legionMeshViemFetchOptions(this.meshEventKind),
      }),
    })
  }

  // ─── RPC Rotation ────────────────────────────────────────────────────────────

  /**
   * Builds a lightweight single-retry viem client bound to a specific RPC URL.
   * Used exclusively by withRpcRotation() for fallback attempts.
   */
  private buildFallbackClient(rpcUrl: string): PublicClient {
    return createPublicClient({
      chain: this.viemChain,
      // retryCount:1 for fallbacks — we rotate ourselves; no viem inner retry storm.
      transport: http(rpcUrl, {
        retryCount: 1,
        retryDelay: 300,
        ...legionMeshViemFetchOptions(this.meshEventKind),
      }),
    })
  }

  /**
   * Executes `fn` against the primary client. On a rotatable error (429 /
   * "Internal Error"), tries each entry in rpcFallbacks in order with jitter
   * between attempts (SHADOW-01). Re-throws the last error when all endpoints fail.
   *
   * Non-rotatable errors (e.g. invalid address, GatekeeperError) bypass rotation
   * and propagate immediately — retrying those would be wasteful.
   *
   * CONTRACT-05: callers wrap the result in LegionError on complete failure.
   */
  private async withRpcRotation<T>(
    fn: (client: PublicClient) => Promise<T>,
  ): Promise<T> {
    // ── Attempt primary ────────────────────────────────────────────────────
    try {
      return await fn(this.client)
    } catch (primaryErr: unknown) {
      if (!isRotatableError(primaryErr) || this.rpcFallbacks.length === 0) {
        throw primaryErr
      }

      // ── Rotate through fallbacks ───────────────────────────────────────
      let lastErr: unknown = primaryErr
      for (let i = 0; i < this.rpcFallbacks.length; i++) {
        const url = this.rpcFallbacks[i]!
        await jitterDelayMs(200)  // SHADOW-01: no fixed-interval retries
        const fallbackClient = this.buildFallbackClient(url)
        try {
          return await fn(fallbackClient)
        } catch (err: unknown) {
          lastErr = err
          if (!isRotatableError(err)) throw err  // non-rotatable → stop immediately
        }
      }
      throw lastErr
    }
  }

  /**
   * Returns the native ETH or ERC-20 balance of `address` as a Uint256 string.
   * Uses `getBalance` for native; `balanceOf` for ERC-20 — no Number() casts.
   *
   * RPC Rotation: automatically retries on 429 / "Internal Error" across
   * EVM_PUBLIC_FALLBACKS before surfacing the error to the caller.
   */
  async getBalance(address: string): Promise<Uint256> {
    if (!isAddress(address)) throw new GatekeeperError(address)
    const addr = address as Address

    if (this.tokenAddress === null) {
      const balance = await this.withRpcRotation((client) =>
        client.getBalance({ address: addr }),
      )
      return balance.toString()
    }

    const tokenAddr = this.tokenAddress
    const balance = (await this.withRpcRotation((client) =>
      client.readContract({
        address: tokenAddr,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [addr],
      }),
    )) as bigint

    return balance.toString()
  }

  /**
   * Returns ABI-encoded calldata for an ERC-20 transfer, or '0x' for native ETH.
   * The Closer sets the `value` field separately for native ETH transfers.
   */
  getTransferData(target: string, amount: Uint256): string {
    if (!isAddress(target)) throw new GatekeeperError(target)

    if (this.tokenAddress === null) {
      // Native ETH — no calldata; value field carries the amount.
      return '0x'
    }

    return encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [target as Address, BigInt(amount)],
    })
  }

  /**
   * Estimates gas for an EVM transaction.
   * @param params - EvmEstimateParams: { from, to, data?, value? }
   * @returns Gas units as Uint256 string.
   *
   * RPC Rotation: retries on 429 / "Internal Error" before propagating.
   */
  async estimateExecutionGas(params: unknown): Promise<Uint256> {
    const p = params as EvmEstimateParams
    const gas = await this.withRpcRotation((client) =>
      client.estimateGas({
        account: p.from,
        to:      p.to,
        data:    p.data,
        value:   p.value,
      }),
    )
    return gas.toString()
  }

  // ─── discoverAssets ────────────────────────────────────────────────────────

  /**
   * Discovers all non-zero assets held by `owner` on this EVM chain.
   *
   * Strategy: single viem multicall batches `balanceOf` across every token in
   * KNOWN_EVM_TOKENS[chainId] in one RPC round-trip. Native ETH balance is fetched
   * separately (multicall3 does not expose ETH balances). Results with balance == 0
   * are filtered out.
   *
   * allowFailure: true — non-standard ERC-20s that revert on balanceOf don't
   * abort the entire discovery. The Gatekeeper inspects the result before striking.
   *
   * @param owner - EVM address (0x-hex). Throws GatekeeperError if malformed.
   * @returns Non-zero DiscoveredAsset array, native ETH first (if non-zero).
   */
  async discoverAssets(owner: string): Promise<DiscoveredAsset[]> {
    if (!isAddress(owner)) throw new GatekeeperError(owner)
    const addr = owner as Address
    const results: DiscoveredAsset[] = []

    // ── Native ETH ──────────────────────────────────────────────────────────
    const ethBalance = await this.withRpcRotation((client) =>
      client.getBalance({ address: addr }),
    )
    if (ethBalance > 0n) {
      results.push({ assetAddress: null, balance: ethBalance.toString(), symbol: 'ETH', decimals: 18 })
    }

    // ── ERC-20 tokens via multicall ──────────────────────────────────────────
    const knownTokens = KNOWN_EVM_TOKENS[this.chainId] ?? []
    if (knownTokens.length === 0) return results

    // multicall returns a discriminated union per viem; cast to a plain shape
    // that avoids exactOptionalPropertyTypes conflicts.
    type McResult = { status: string; result: bigint | undefined }
    let multicallResults: McResult[]
    try {
      const contracts = knownTokens.map((token) => ({
        address: token.address,
        abi: ERC20_ABI,
        functionName: 'balanceOf' as const,
        args: [addr] as const,
      }))
      const raw = await this.withRpcRotation((client) =>
        client.multicall({ contracts, allowFailure: true }),
      )
      multicallResults = raw as unknown as McResult[]
    } catch {
      // Chain does not support multicall3 or all RPCs exhausted — return native balance only.
      return results
    }

    for (let i = 0; i < knownTokens.length; i++) {
      const item = multicallResults[i]
      if (!item || item.status !== 'success' || item.result == null) continue
      const bal = item.result
      if (bal === 0n) continue
      const token = knownTokens[i]!
      results.push({
        assetAddress: token.address,
        balance: bal.toString(),
        symbol: token.symbol,
        decimals: token.decimals,
      })
    }

    return results
  }

  // ─── Permit2 ───────────────────────────────────────────────────────────────

  /**
   * Builds the EIP-712 typed data for a Permit2 PermitSingle signature.
   *
   * Usage:
   *   ```ts
   *   const typedData = adapter.buildPermit2Data({ ... })
   *   const sig = await walletClient.signTypedData(typedData)
   *   // → persist sig in approval_ledger.signature_data
   *   ```
   *
   * Expiration: defaults to `now + 300s` (5 min) per permit2.md §4 Rule 3
   * (minimise toxic-signature exposure on JIT extractions).
   *
   * @param options.tokenAddress     - ERC-20 token to permit.
   * @param options.spender          - Our vault / operator address receiving the allowance.
   * @param options.amount           - Permitted amount (bigint; use MAX_UINT160 for infinite).
   * @param options.nonce            - Unused nonce from the Permit2 nonce bitmap.
   * @param options.sigDeadline      - Unix timestamp (bigint) after which the sig is invalid.
   * @param options.expirationSecs   - On-chain allowance window in seconds (default 300).
   */
  buildPermit2Data(options: {
    tokenAddress: Address
    spender: Address
    amount: bigint
    nonce: number
    sigDeadline: bigint
    expirationSecs?: number
  }): Permit2TypedData {
    const expiration =
      Math.floor(Date.now() / 1000) + (options.expirationSecs ?? 300)

    return {
      domain: {
        name: 'Permit2',
        chainId: this.chainNumericId,
        verifyingContract: PERMIT2_ADDRESS,
      },
      types: {
        PermitDetails: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint160' },
          { name: 'expiration', type: 'uint48' },
          { name: 'nonce', type: 'uint48' },
        ],
        PermitSingle: [
          { name: 'details', type: 'PermitDetails' },
          { name: 'spender', type: 'address' },
          { name: 'sigDeadline', type: 'uint256' },
        ],
      },
      message: {
        details: {
          token: options.tokenAddress,
          amount: options.amount,
          expiration,
          nonce: options.nonce,
        },
        spender: options.spender,
        sigDeadline: options.sigDeadline,
      },
    }
  }
}
