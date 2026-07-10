import {
  APTOS_MAINNET,
  BIP122_BITCOIN_MAINNET,
  COSMOS_HUB,
  SOLANA_MAINNET,
  SUI_MAINNET,
  TON_MAINNET_WC,
  TRON_MAINNET,
  TVM_MAINNET_CAIP,
} from './constants.js'

export type CaipFamily =
  | 'EVM'
  | 'SVM'
  | 'UTXO'
  | 'TRON'
  | 'TON'
  | 'COSMOS'
  | 'APTOS'
  | 'SUI'
  | 'UNKNOWN'

const NAMESPACE_TO_FAMILY: Record<string, CaipFamily> = {
  eip155: 'EVM',
  solana: 'SVM',
  bip122: 'UTXO',
  tron: 'TRON',
  ton: 'TON',
  tvm: 'TON',
  cosmos: 'COSMOS',
  aptos: 'APTOS',
  sui: 'SUI',
}

const CAIP2_TO_FAMILY: Record<string, CaipFamily> = {
  [BIP122_BITCOIN_MAINNET]: 'UTXO',
  [SOLANA_MAINNET]: 'SVM',
  [TRON_MAINNET]: 'TRON',
  [TON_MAINNET_WC]: 'TON',
  [TVM_MAINNET_CAIP]: 'TON',
  [COSMOS_HUB]: 'COSMOS',
  [APTOS_MAINNET]: 'APTOS',
  [SUI_MAINNET]: 'SUI',
}

export function familyFromCaipNamespace(namespace: string): CaipFamily {
  return NAMESPACE_TO_FAMILY[String(namespace).toLowerCase()] ?? 'UNKNOWN'
}

export function familyFromCaip2(chainId: string): CaipFamily {
  const raw = String(chainId).trim()
  if (CAIP2_TO_FAMILY[raw]) return CAIP2_TO_FAMILY[raw]
  if (raw.startsWith('eip155:')) return 'EVM'
  if (raw.startsWith('solana:')) return 'SVM'
  if (raw.startsWith('bip122:')) return 'UTXO'
  if (raw.startsWith('tron:')) return 'TRON'
  if (raw.startsWith('ton:') || raw.startsWith('tvm:')) return 'TON'
  if (raw.startsWith('cosmos:')) return 'COSMOS'
  if (raw.startsWith('aptos:')) return 'APTOS'
  if (raw.startsWith('sui:')) return 'SUI'
  return 'UNKNOWN'
}
