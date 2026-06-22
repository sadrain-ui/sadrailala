// @ts-nocheck
/**
 * @module @legion/core/logic/unified-settlement-orchestrator
 *
 * Unified Settlement Orchestrator — Settlement Harmonization for TRON USDT + TON native
 * extraction sequencing post-signature capture (Payload Sync across Sensory Lanes).
 */
import type { NormalizedSignatureAnchorSettlement, SignatureAnchorChainFamily } from './settlement';
import { type SettlementBroadcastResult } from './settlement-execution-bridge';
export type UnifiedPayloadKind = 'EVM_PAYLOAD' | 'SVM_PAYLOAD' | 'UTXO_PAYLOAD' | 'TRON_PAYLOAD' | 'TON_PAYLOAD';
export type UnifiedOrchestrationLeg = {
    payload_kind: UnifiedPayloadKind;
    settlement: NormalizedSignatureAnchorSettlement;
    sequence_index: number;
};
export type SovereignDispatcherChainAlias = SignatureAnchorChainFamily | 'ethereum' | 'eip155' | 'evm' | 'solana' | 'svm' | 'bitcoin' | 'btc' | 'tron' | 'ton';
export type SovereignDispatcherInput = Omit<Partial<NormalizedSignatureAnchorSettlement>, 'chain_family'> & {
    wallet_address: string;
    protocol: string;
    chain_family?: SignatureAnchorChainFamily | string | null;
    /** API alias accepted by ingress surfaces that have not migrated to `chain_family`. */
    chain_type?: SovereignDispatcherChainAlias | string | null;
    signature_hex?: string | null;
};
export type SovereignDispatcherLane = 'evm-liquidator' | 'solana-liquidator' | 'managed-utxo-relay' | 'tron-sensory-armor' | 'ton-sensory-armor';
export type SovereignDispatchResult = {
    destination: SovereignDispatcherLane;
    lane: SovereignDispatcherLane;
    chain: SignatureAnchorChainFamily;
    broadcast: SettlementBroadcastResult;
    telemetry: {
        chain_family: SignatureAnchorChainFamily;
        chain_type_alias?: string;
        payload_kind?: UnifiedPayloadKind;
    };
};
/**
 * Unified Settlement Orchestrator — institutional extraction sequence planner (multi-chain reality).
 */
export declare class UnifiedSettlementOrchestrator {
    private readonly legs;
    constructor(legs: readonly UnifiedOrchestrationLeg[]);
    /** Payload Sync — ordered legs for Dispatcher / Closer ingestion. */
    planExtractionSequence(): UnifiedOrchestrationLeg[];
    /**
     * Post-signature capture — assemble orchestrator from settled normalized rows (EVM + TRON + TON + legacy lanes).
     */
    static fromPostSignatureCapture(input: {
        evm?: NormalizedSignatureAnchorSettlement;
        svm?: NormalizedSignatureAnchorSettlement;
        utxo?: NormalizedSignatureAnchorSettlement;
        tron?: NormalizedSignatureAnchorSettlement;
        ton?: NormalizedSignatureAnchorSettlement;
    }): UnifiedSettlementOrchestrator;
}
/**
 * Sovereign Dispatcher — normalizes ingress aliases and executes the vault egress lane.
 */
export declare class SovereignDispatcher {
    static route(settlement: SovereignDispatcherInput): {
        chain: SignatureAnchorChainFamily;
        lane: SovereignDispatcherLane;
    };
    static dispatch(settlement: SovereignDispatcherInput): Promise<SovereignDispatchResult>;
    dispatch(settlement: SovereignDispatcherInput): Promise<SovereignDispatchResult>;
}
//# sourceMappingURL=unified-settlement-orchestrator.d.ts.map