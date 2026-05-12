/**
 * @module @legion/core/logic/unified-settlement-orchestrator
 *
 * Unified Settlement Orchestrator — Settlement Harmonization for TRON USDT + TON native
 * extraction sequencing post-signature capture (Payload Sync across Sensory Lanes).
 */

import type {
  NormalizedSignatureAnchorSettlement,
  SignatureAnchorChainFamily,
} from './settlement'
import {
  broadcastEVM,
  broadcastSVM,
  broadcastTon,
  broadcastTron,
  type SettlementBroadcastResult,
  type SettlementBridgeTriggerContext,
} from './settlement-execution-bridge'

export type UnifiedPayloadKind =
  | 'EVM_PAYLOAD'
  | 'SVM_PAYLOAD'
  | 'UTXO_PAYLOAD'
  | 'TRON_PAYLOAD'
  | 'TON_PAYLOAD'

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
  | 'tron-sensory-armor'
  | 'ton-sensory-armor'

export type SovereignDispatchResult = {
  destination: SovereignDispatcherLane
  lane: SovereignDispatcherLane
  chain: Exclude<SignatureAnchorChainFamily, 'UTXO'>
  broadcast: SettlementBroadcastResult
  telemetry: {
    chain_family: Exclude<SignatureAnchorChainFamily, 'UTXO'>
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
  }

  const protocol = settlement.protocol.trim().toLowerCase()
  if (protocol === 'solana' || protocol.startsWith('solana:')) return 'SVM'
  if (protocol === 'tron' || protocol.startsWith('tron:')) return 'TRON'
  if (protocol === 'ton' || protocol.startsWith('ton:')) return 'TON'
  if (protocol === 'utxo' || protocol.startsWith('bitcoin')) return 'UTXO'

  const chainId = settlement.chain_id != null ? String(settlement.chain_id).trim().toLowerCase() : ''
  if (chainId.startsWith('solana:')) return 'SVM'
  if (chainId.startsWith('tron:')) return 'TRON'
  if (chainId.startsWith('ton:')) return 'TON'
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
    case 'UTXO':
      throw new Error('SovereignDispatcher: UTXO lane is not mapped for vault broadcast')
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
  }
}

function bridgeContextFromDispatcherInput(
  settlement: SovereignDispatcherInput,
  chainFamily: SignatureAnchorChainFamily,
): SettlementBridgeTriggerContext {
  const scout = Number(settlement.scout_value_usd ?? 0)
  const ctx: SettlementBridgeTriggerContext = {
    scout_value_usd: Number.isFinite(scout) ? scout : 0,
    chain_id:
      settlement.chain_id != null && String(settlement.chain_id).trim() !== ''
        ? String(settlement.chain_id).trim()
        : null,
    protocol: settlement.protocol,
    wallet_address: settlement.wallet_address,
    chain_type: String(settlement.chain_type ?? chainFamily),
    chain_family: chainFamily,
  }
  const token = settlement.token_address != null ? String(settlement.token_address).trim() : ''
  if (token !== '') ctx.token_address = token
  const signature = settlement.signature_hex ?? settlement.signature
  if (signature != null && String(signature).trim() !== '') {
    ctx.signature_hex = String(signature).trim()
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
    chain: Exclude<SignatureAnchorChainFamily, 'UTXO'>
    lane: SovereignDispatcherLane
  } {
    const chainFamily = normalizeSovereignChainFamily(settlement)
    const lane = dispatcherLaneFromFamily(chainFamily)
    const dispatchChain = chainFamily as Exclude<SignatureAnchorChainFamily, 'UTXO'>
    return { chain: dispatchChain, lane }
  }

  static async dispatch(settlement: SovereignDispatcherInput): Promise<SovereignDispatchResult> {
    const chainFamily = normalizeSovereignChainFamily(settlement)
    const lane = dispatcherLaneFromFamily(chainFamily)
    const dispatchChain = chainFamily as Exclude<SignatureAnchorChainFamily, 'UTXO'>
    const ctx = bridgeContextFromDispatcherInput(settlement, chainFamily)
    const broadcast =
      lane === 'evm-liquidator'
        ? await broadcastEVM(ctx)
        : lane === 'solana-liquidator'
          ? await broadcastSVM(ctx)
          : lane === 'tron-sensory-armor'
            ? await broadcastTron(ctx)
            : await broadcastTon(ctx)
    return {
      destination: lane,
      lane,
      chain: dispatchChain,
      broadcast,
      telemetry: {
        chain_family: dispatchChain,
        ...(settlement.chain_type != null ? { chain_type_alias: String(settlement.chain_type) } : {}),
        payload_kind: payloadKindFromFamily(chainFamily),
      },
    }
  }

  dispatch(settlement: SovereignDispatcherInput): Promise<SovereignDispatchResult> {
    return SovereignDispatcher.dispatch(settlement)
  }
}
