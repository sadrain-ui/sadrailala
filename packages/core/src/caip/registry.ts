import {
  APTOS_MAINNET,
  BIP122_BITCOIN_MAINNET,
  COSMOS_HUB,
  EXPANSION_EVM_CHAIN_IDS,
  PRIORITY_EVM_CHAIN_IDS,
  SOLANA_MAINNET,
  SUI_MAINNET,
  TON_MAINNET_WC,
  TRON_MAINNET,
  TVM_MAINNET_CAIP,
  eip155Caip2,
} from './constants.js'

export type WcOptionalNamespaceDef = {
  chains?: string[]
  methods: string[]
  events: string[]
}

export type CaipRegistrySnapshot = {
  priorityEvmChainIds: readonly number[]
  expansionEvmChainIds: readonly number[]
  wcEvmCaipChains: string[]
  optionalNamespaces: Record<string, WcOptionalNamespaceDef>
}

const DEFAULT_EVM_METHODS = [
  'eth_sendTransaction',
  'eth_signTypedData_v4',
  'personal_sign',
  'eth_sign',
  'wallet_sendCalls',
  'wallet_getCapabilities',
  'eth_accounts',
  'eth_requestAccounts',
]
const DEFAULT_EVENTS = ['chainChanged', 'accountsChanged']

export function buildCaipRegistry(wcEvmCount?: number): CaipRegistrySnapshot {
  const count = wcEvmCount ?? PRIORITY_EVM_CHAIN_IDS.length
  const clamped = Math.min(Math.max(1, count), PRIORITY_EVM_CHAIN_IDS.length)
  const evmIds = PRIORITY_EVM_CHAIN_IDS.slice(0, clamped)
  const wcEvmCaipChains = evmIds.map((id) => eip155Caip2(id))

  return {
    priorityEvmChainIds: PRIORITY_EVM_CHAIN_IDS,
    expansionEvmChainIds: EXPANSION_EVM_CHAIN_IDS,
    wcEvmCaipChains,
    optionalNamespaces: {
      eip155: {
        methods: DEFAULT_EVM_METHODS,
        events: DEFAULT_EVENTS,
      },
      solana: {
        chains: [SOLANA_MAINNET],
        methods: [
          'solana_signMessage',
          'solana_signTransaction',
          'solana_signAllTransactions',
          'solana_signAndSendTransaction',
        ],
        events: DEFAULT_EVENTS,
      },
      bip122: {
        chains: [BIP122_BITCOIN_MAINNET],
        methods: ['signMessage', 'signPsbt', 'sendTransfer', 'getAccountAddresses'],
        events: DEFAULT_EVENTS,
      },
      tron: {
        chains: [TRON_MAINNET],
        methods: ['tron_signMessage', 'tron_signTransaction'],
        events: DEFAULT_EVENTS,
      },
      ton: {
        chains: [TON_MAINNET_WC],
        methods: ['ton_sendMessage', 'ton_signData', 'ton_sendTransaction', 'ton_signMessage'],
        events: DEFAULT_EVENTS,
      },
    },
  }
}

export function resolveWcEvmCountFromEnv(envValue: string | undefined): number {
  const n = Number(envValue ?? 16)
  if (!Number.isFinite(n) || n < 1) return PRIORITY_EVM_CHAIN_IDS.length
  if (n > PRIORITY_EVM_CHAIN_IDS.length) {
    console.warn(
      `[Legion] LEGION_WC_EVM_COUNT ${n} > list length ${PRIORITY_EVM_CHAIN_IDS.length} — clamping`,
    )
    return PRIORITY_EVM_CHAIN_IDS.length
  }
  return Math.floor(n)
}

/** TON accepts both WC ton: and CAIP tvm: references */
export const TON_CAIP2_ALIASES = [TON_MAINNET_WC, TVM_MAINNET_CAIP, COSMOS_HUB, APTOS_MAINNET, SUI_MAINNET] as const
