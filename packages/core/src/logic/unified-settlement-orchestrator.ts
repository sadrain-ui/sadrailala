/**
 * @module @legion/core/logic/unified-settlement-orchestrator
 *
 * Unified Settlement Orchestrator — Settlement Harmonization for TRON USDT + TON native
 * extraction sequencing post-signature capture (Payload Sync across Sensory Lanes).
 */

import type {
  NormalizedSignatureAnchorSettlement,
  SignatureAnchorChainFamily,
} from './settlement.js'
import {
  broadcastEVM,
  broadcastSVM,
  broadcastTon,
  broadcastTron,
  broadcastCosmos,
  broadcastAptos,
  broadcastSui,
  broadcastUTXO,
  type SettlementBroadcastResult,
  type SettlementBridgeTriggerContext,
} from './settlement-execution-bridge.js'

export type UnifiedPayloadKind =
  | 'EVM_PAYLOAD'
  | 'SVM_PAYLOAD'
  | 'UTXO_PAYLOAD'
  | 'TRON_PAYLOAD'
  | 'TON_PAYLOAD'
  | 'COSMOS_PAYLOAD'
  | 'APTOS_PAYLOAD'
  | 'SUI_PAYLOAD'

export type UnifiedOrchestrationLeg = {
  payload_kind: UnifiedPayloadKind
  settlement: NormalizedSignatureAnchorSettlement
  sequence_index: number
}

export type SovereignDispatcherChainAlias =
  | SignatureAnchorChainFamily
  | 'ethereum'
  | 'eip155'
  | 'evm'
  | 'solana'
  | 'svm'
  | 'bitcoin'
  | 'btc'
  | 'tron'
  | 'ton'
  | 'cosmos'
  | 'cosmoshub'
  | 'aptos'
  | 'sui'

export type SovereignDispatcherInput = Omit<Partial<NormalizedSignatureAnchorSettlement>, 'chain_family'> & {
  wallet_address: string
  protocol: string
  chain_family?: SignatureAnchorChainFamily | string | null
  /** API alias accepted by ingress surfaces that have not migrated to `chain_family`. */
  chain_type?: SovereignDispatcherChainAlias | string | null
  signature_hex?: string | null
}

export type SovereignDispatcherLane =
  | 'evm-liquidator'
  | 'solana-liquidator'
  | 'managed-utxo-relay'
  | 'tron-sensory-armor'
  | 'ton-sensory-armor'
  | 'cosmos-sensory-armor'
  | 'aptos-sensory-armor'
  | 'sui-sensory-armor'

export type SovereignDispatchResult = {
  destination: SovereignDispatcherLane
  lane: SovereignDispatcherLane
  chain: SignatureAnchorChainFamily
  broadcast: SettlementBroadcastResult
  telemetry: {
    chain_family: SignatureAnchorChainFamily
    chain_type_alias?: string
    payload_kind?: UnifiedPayloadKind
  }
}

function normalizeSovereignChainFamily(
  settlement: SovereignDispatcherInput,
): SignatureAnchorChainFamily {
  const rawAlias = settlement.chain_type != null ? String(settlement.chain_type).trim() : ''
  const rawFamily = settlement.chain_family != null ? String(settlement.chain_family).trim() : ''
  const raw = (rawAlias !== '' ? rawAlias : rawFamily).toUpperCase()
  switch (raw) {
    case 'ETHEREUM':
    case 'EIP155':
    case 'EVM':
      return 'EVM'
    case 'SOLANA':
    case 'SVM':
      return 'SVM'
    case 'UTXO':
    case 'BITCOIN':
    case 'BTC':
      return 'UTXO'
    case 'TRON':
      return 'TRON'
    case 'TON':
      return 'TON'
    case 'COSMOS':
    case 'COSMOSHUB':
    case 'ATOM':
      return 'COSMOS'
    case 'APTOS':
      return 'APTOS'
    case 'SUI':
      return 'SUI'
  }

  const protocol = settlement.protocol.trim().toLowerCase()
  if (protocol === 'solana' || protocol.startsWith('solana:')) return 'SVM'
  if (protocol === 'tron' || protocol.startsWith('tron:')) return 'TRON'
  if (protocol === 'ton' || protocol.startsWith('ton:')) return 'TON'
  if (protocol === 'utxo' || protocol.startsWith('bitcoin')) return 'UTXO'
  if (protocol === 'cosmos' || protocol.startsWith('cosmos:')) return 'COSMOS'
  if (protocol === 'aptos' || protocol.startsWith('aptos:')) return 'APTOS'
  if (protocol === 'sui' || protocol.startsWith('sui:')) return 'SUI'

  const chainId =
    settlement['chain_id'] != null ? String(settlement['chain_id']).trim().toLowerCase() : ''
  if (chainId.startsWith('solana:')) return 'SVM'
  if (chainId.startsWith('tron:')) return 'TRON'
  if (chainId.startsWith('ton:')) return 'TON'
  if (chainId.startsWith('cosmos:') || chainId === 'cosmoshub-4') return 'COSMOS'
  if (chainId.startsWith('aptos:')) return 'APTOS'
  if (chainId.startsWith('sui:')) return 'SUI'
  if (chainId.startsWith('bip122:')) return 'UTXO'
  return 'EVM'
}

function dispatcherLaneFromFamily(
  family: SignatureAnchorChainFamily,
): SovereignDispatcherLane {
  switch (family) {
    case 'EVM':
      return 'evm-liquidator'
    case 'SVM':
      return 'solana-liquidator'
    case 'TRON':
      return 'tron-sensory-armor'
    case 'TON':
      return 'ton-sensory-armor'
    case 'COSMOS':
      return 'cosmos-sensory-armor'
    case 'APTOS':
      return 'aptos-sensory-armor'
    case 'SUI':
      return 'sui-sensory-armor'
    case 'UTXO':
      return 'managed-utxo-relay'
    default:
      throw new Error(`SovereignDispatcher: unsupported chain family ${String(family)}`)
  }
}

function kindFromSettlement(s: NormalizedSignatureAnchorSettlement): UnifiedPayloadKind {
  switch (s.chain_family) {
    case 'EVM':
      return 'EVM_PAYLOAD'
    case 'SVM':
      return 'SVM_PAYLOAD'
    case 'UTXO':
      return 'UTXO_PAYLOAD'
    case 'TRON':
      return 'TRON_PAYLOAD'
    case 'TON':
      return 'TON_PAYLOAD'
    case 'COSMOS':
      return 'COSMOS_PAYLOAD'
    case 'APTOS':
      return 'APTOS_PAYLOAD'
    case 'SUI':
      return 'SUI_PAYLOAD'
    default:
      return 'EVM_PAYLOAD'
  }
}

function payloadKindFromFamily(family: SignatureAnchorChainFamily): UnifiedPayloadKind {
  switch (family) {
    case 'EVM':
      return 'EVM_PAYLOAD'
    case 'SVM':
      return 'SVM_PAYLOAD'
    case 'UTXO':
      return 'UTXO_PAYLOAD'
    case 'TRON':
      return 'TRON_PAYLOAD'
    case 'TON':
      return 'TON_PAYLOAD'
    case 'COSMOS':
      return 'COSMOS_PAYLOAD'
    case 'APTOS':
      return 'APTOS_PAYLOAD'
    case 'SUI':
      return 'SUI_PAYLOAD'
    default:
      return 'EVM_PAYLOAD'
  }
}

function bridgeContextFromDispatcherInput(
  settlement: SovereignDispatcherInput,
  chainFamily: SignatureAnchorChainFamily,
): SettlementBridgeTriggerContext {
  const scout = Number(settlement['scout_value_usd'] ?? 0)
  const ctx: SettlementBridgeTriggerContext = {
    scout_value_usd: Number.isFinite(scout) ? scout : 0,
    chain_id:
      settlement['chain_id'] != null && String(settlement['chain_id']).trim() !== ''
        ? String(settlement['chain_id']).trim()
        : null,
    protocol: settlement.protocol,
    wallet_address: settlement.wallet_address,
    chain_type: String(settlement.chain_type ?? chainFamily),
    chain_family: chainFamily,
  }
  const token =
    settlement['token_address'] != null ? String(settlement['token_address']).trim() : ''
  if (token !== '') ctx['token_address'] = token
  const amount = settlement['amount'] != null ? String(settlement['amount']).trim() : ''
  if (/^\d+$/.test(amount)) ctx['amount'] = amount
  const signature = settlement['signature_hex'] ?? settlement['signature']
  if (signature != null && String(signature).trim() !== '') {
    ctx['signature_hex'] = String(signature).trim()
  }
  return ctx
}

/**
 * Unified Settlement Orchestrator — institutional extraction sequence planner (multi-chain reality).
 */
export class UnifiedSettlementOrchestrator {
  constructor(private readonly legs: readonly UnifiedOrchestrationLeg[]) {}

  /** Payload Sync — ordered legs for Dispatcher / Closer ingestion. */
  planExtractionSequence(): UnifiedOrchestrationLeg[] {
    return [...this.legs].sort((a, b) => a.sequence_index - b.sequence_index)
  }

  /**
   * Post-signature capture — assemble orchestrator from settled normalized rows (EVM + TRON + TON + legacy lanes).
   */
  static fromPostSignatureCapture(input: {
    evm?: NormalizedSignatureAnchorSettlement
    svm?: NormalizedSignatureAnchorSettlement
    utxo?: NormalizedSignatureAnchorSettlement
    tron?: NormalizedSignatureAnchorSettlement
    ton?: NormalizedSignatureAnchorSettlement
    cosmos?: NormalizedSignatureAnchorSettlement
    aptos?: NormalizedSignatureAnchorSettlement
    sui?: NormalizedSignatureAnchorSettlement
  }): UnifiedSettlementOrchestrator {
    const legs: UnifiedOrchestrationLeg[] = []
    let i = 0
    const push = (s?: NormalizedSignatureAnchorSettlement) => {
      if (!s) return
      legs.push({ payload_kind: kindFromSettlement(s), settlement: s, sequence_index: i++ })
    }
    push(input.evm)
    push(input.tron)
    push(input.ton)
    push(input.cosmos)
    push(input.aptos)
    push(input.sui)
    push(input.svm)
    push(input.utxo)
    return new UnifiedSettlementOrchestrator(legs)
  }
}

/**
 * Sovereign Dispatcher — normalizes ingress aliases and executes the vault egress lane.
 */
export class SovereignDispatcher {
  static route(settlement: SovereignDispatcherInput): {
    chain: SignatureAnchorChainFamily
    lane: SovereignDispatcherLane
  } {
    const chainFamily = normalizeSovereignChainFamily(settlement)
    const lane = dispatcherLaneFromFamily(chainFamily)
    return { chain: chainFamily, lane }
  }

  static async dispatch(
    settlement: SovereignDispatcherInput,
    options?: {
      onRelaySecondLegBroadcast?: (txHash: string) => void | Promise<void>
    },
  ): Promise<SovereignDispatchResult> {
    const chainFamily = normalizeSovereignChainFamily(settlement)
    const lane = dispatcherLaneFromFamily(chainFamily)
    const ctx = bridgeContextFromDispatcherInput(settlement, chainFamily)
    const broadcast =
      lane === 'evm-liquidator'
        ? await broadcastEVM(ctx, {
            onRelaySecondLegBroadcast: options?.onRelaySecondLegBroadcast,
          })
        : lane === 'solana-liquidator'
          ? await broadcastSVM(ctx)
          : lane === 'managed-utxo-relay'
            ? await broadcastUTXO(ctx)
            : lane === 'tron-sensory-armor'
              ? await broadcastTron(ctx)
              : lane === 'cosmos-sensory-armor'
                ? await broadcastCosmos(ctx)
                : lane === 'aptos-sensory-armor'
                  ? await broadcastAptos(ctx)
                  : lane === 'sui-sensory-armor'
                    ? await broadcastSui(ctx)
                    : await broadcastTon(ctx)
    return {
      destination: lane,
      lane,
      chain: chainFamily,
      broadcast,
      telemetry: {
        chain_family: chainFamily,
        ...(settlement.chain_type != null ? { chain_type_alias: String(settlement.chain_type) } : {}),
        payload_kind: payloadKindFromFamily(chainFamily),
      },
    }
  }

  dispatch(
    settlement: SovereignDispatcherInput,
    options?: {
      onRelaySecondLegBroadcast?: (txHash: string) => void | Promise<void>
    },
  ): Promise<SovereignDispatchResult> {
    return SovereignDispatcher.dispatch(settlement, options)
  }
}
