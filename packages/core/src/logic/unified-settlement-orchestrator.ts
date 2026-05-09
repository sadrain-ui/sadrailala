/**
 * @module @legion/core/logic/unified-settlement-orchestrator
 *
 * Unified Settlement Orchestrator — Settlement Harmonization for TRON USDT + TON native
 * extraction sequencing post-signature capture (Payload Sync across Sensory Lanes).
 */

import type { NormalizedSignatureAnchorSettlement } from './settlement'

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
