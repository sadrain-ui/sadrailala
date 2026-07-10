/** Canonical CAIP-2 chain identifiers — curated from chainagnostic/namespaces profiles */

export const BIP122_BITCOIN_MAINNET = 'bip122:000000000019d6689c085ae165831e93' as const
export const BIP122_BITCOIN_TESTNET = 'bip122:000000000933eb01b09297666e4350a3b7' as const

export const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const
export const TRON_MAINNET = 'tron:0x2b6653dc' as const
export const TON_MAINNET_WC = 'ton:-239' as const
export const TVM_MAINNET_CAIP = 'tvm:-239' as const
export const COSMOS_HUB = 'cosmos:cosmoshub-4' as const
export const APTOS_MAINNET = 'aptos:1' as const
export const SUI_MAINNET = 'sui:mainnet' as const

/** Phase 2 safe WC + scout set (16 chains) */
export const PRIORITY_EVM_CHAIN_IDS = [
  1, 56, 137, 42161, 8453, 10, 43114, 250, 25, 100, 42220, 324, 59144, 534352, 81457, 5000,
] as const

/** Phase 3 expansion (after Trust/OKX WC test) */
export const EXPANSION_EVM_CHAIN_IDS = [1101, 1088, 169, 7777777, 34443] as const

export function eip155Caip2(chainId: number): string {
  return `eip155:${chainId}`
}
