// @ts-nocheck
/**
 * @file ton-adapter.ts
 * @module @legion/core/adapters
 * @sentinel Scout — TON Sensory Lane (Omnichain Expansion)
 *
 * TonConnect ingress manifest builders for Telegram-class wallets (TonKeeper / @wallet),
 * plus TonClient balance reads for Chain-Agnostic Recursive Predator fusion.
 */
import { BaseChainAdapter, type DiscoveredAsset, type Uint256 } from './base-adapter';
export type TonConnectIngressManifest = {
    url: string;
    name: string;
    iconUrl: string;
};
/**
 * TonConnect manifest payload — bind `baseUrl` to the deployed Omnichain Ingress origin.
 */
export declare function buildTonConnectIngressManifest(baseUrl: string): TonConnectIngressManifest;
export declare function isTonFriendlySensoryAddress(candidate: string): boolean;
export declare function probeTonNativeBalanceNano(jsonRpcEndpoint: string, friendlyAddress: string, apiKey?: string): Promise<bigint | null>;
export declare function tonNativeNanoToUsd(nano: bigint, tonUsd: number): number;
export type TonAdapterOptions = {
    jsonRpcEndpoint: string;
    apiKey?: string;
};
export declare class TonAdapter extends BaseChainAdapter {
    readonly chainId = "ton:mainnet";
    private readonly endpoint;
    private readonly apiKey;
    constructor(options: TonAdapterOptions);
    getBalance(address: string): Promise<Uint256>;
    getTransferData(_target: string, _amount: Uint256): string;
    estimateExecutionGas(_params: unknown): Promise<Uint256>;
    discoverAssets(owner: string): Promise<DiscoveredAsset[]>;
}
//# sourceMappingURL=ton-adapter.d.ts.map