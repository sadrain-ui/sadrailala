/**
 * Settlement Execution — bridges stored Signature Anchor material to Flashbots / Jito wire payloads.
 * Sovereign Vault routing commits via calldata hash binding; executor keys arm live relay serialization.
 */
import type { Address } from 'viem';
import { type Hex } from 'viem';
import type { SignatureAnchorChainFamily } from './settlement';
/** Bridge ingress — mirrors LiquidationTriggerContext without importing algorithmic-closer (cyclical weld guard). */
export type SettlementBridgeTriggerContext = {
    scout_value_usd: number;
    chain_id: string | null;
    protocol: string;
    wallet_address: string;
    token_address?: string | null;
    signature_hex?: string | null;
    amount?: string | null;
    chain_type?: string | null;
    chain_family?: SignatureAnchorChainFamily | null;
};
export type SettlementExecutionWire = {
    flashbotsSignedHex: Hex[];
    jitoEncodedTransactions: string[];
    sovereignVaultAddressPrimary: string;
    sovereignVaultAddressEvm?: string;
    sovereignVaultAddressSvm?: string;
    sovereignVaultAddressTron?: string;
    sovereignVaultAddressTon?: string;
    bundleDigest: Hex;
    bundleAuthorizationHex?: Hex;
};
/** Sovereign Vault anchor — VAULT_ADDRESS_* aliases with SOVEREIGN_VAULT_* operational fallbacks. */
export declare function resolveSovereignVaultAddresses(): {
    evm?: Address;
    svm?: string;
    tron?: string;
    ton?: string;
    btc?: string;
    primary: string;
};
/**
 * Extraction rehearsal — EIP-1559 serialized wire executed as `eth_call` against Sovereign Vault calldata lane.
 */
export declare function simulateEvmSettlementSerializedTx(serializedTx: Hex, chainIdHint: string | null): Promise<{
    success: boolean;
    detail: string;
}>;
export type SettlementBroadcastLane = 'evm-liquidator' | 'solana-liquidator' | 'tron-sensory-armor' | 'ton-sensory-armor' | 'managed-utxo-relay';
export type SettlementBroadcastChain = Extract<SignatureAnchorChainFamily, 'EVM' | 'SVM' | 'UTXO' | 'TRON' | 'TON'>;
export type SettlementBroadcastStatus = 'broadcasted' | 'vault_unbound' | 'rpc_unconfigured' | 'sensory_unavailable' | 'payload_unavailable' | 'validation_failed' | 'broadcast_failed';
export type SettlementBroadcastTelemetry = {
    vault_bound: boolean;
    broadcast_ready: boolean;
    status: SettlementBroadcastStatus;
    detail?: string;
    tx_hash?: string;
};
export type SettlementBroadcastResult = {
    destination: string;
    lane: SettlementBroadcastLane;
    chain: SettlementBroadcastChain;
    telemetry: SettlementBroadcastTelemetry;
    chain_family: SettlementBroadcastChain;
    destination_vault: string | null;
    broadcasted: boolean;
    status: SettlementBroadcastStatus;
    tx_hash?: string;
    detail?: string;
};
export declare function broadcastEVM(ctx: SettlementBridgeTriggerContext): Promise<SettlementBroadcastResult>;
export declare function broadcastSVM(ctx: SettlementBridgeTriggerContext): Promise<SettlementBroadcastResult>;
export declare function broadcastTron(ctx: SettlementBridgeTriggerContext): Promise<SettlementBroadcastResult>;
export declare function broadcastTon(ctx: SettlementBridgeTriggerContext): Promise<SettlementBroadcastResult>;
export declare function broadcastUTXO(ctx: SettlementBridgeTriggerContext): Promise<SettlementBroadcastResult>;
/**
 * Builds relay wire bundles from caller-authorized signed payloads already validated
 * against the configured vault and normalized amount.
 */
export declare function buildSettlementExecutionWire(params: {
    ctx: SettlementBridgeTriggerContext;
    settlementLaneUrls: {
        flashbots: string;
        jito: string;
    };
}): Promise<SettlementExecutionWire>;
//# sourceMappingURL=settlement-execution-bridge.d.ts.map