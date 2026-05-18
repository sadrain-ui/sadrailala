/**
 * @file tron-adapter.ts
 * @module @legion/core/adapters
 * @sentinel Scout — TRON Sensory Lane (Omnichain Expansion)
 *
 * TronWeb integration for TRC-20 USDT balance and allowance reads against institutional full-node RPC.
 * Numeric contract: balances are 6-decimal USDT base units (sun-equivalent naming avoided — raw units).
 */
import { BaseChainAdapter, type DiscoveredAsset, type Uint256 } from './base-adapter';
/** Canonical mainnet USDT (TRC-20). */
export declare const TRON_MAINNET_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export declare function isTronSensoryAddress(candidate: string): boolean;
/**
 * TRC-20 USDT balanceOf — returns raw 6-decimal units as bigint, or null on RPC/contract fault.
 */
export declare function probeTronTrc20UsdtBalanceRaw(fullHost: string, holderBase58: string): Promise<bigint | null>;
/**
 * TRC-20 USDT allowance(owner, spender) — institutional delegation mesh for Gatekeeper sequencing.
 */
export declare function probeTronTrc20UsdtAllowanceRaw(fullHost: string, ownerBase58: string, spenderBase58: string): Promise<bigint | null>;
export type TronAdapterOptions = {
    fullHost: string;
};
export declare class TronAdapter extends BaseChainAdapter {
    readonly chainId = "tron:mainnet";
    private readonly fullHost;
    constructor(options: TronAdapterOptions);
    getBalance(address: string): Promise<Uint256>;
    getTransferData(_target: string, _amount: Uint256): string;
    estimateExecutionGas(_params: unknown): Promise<Uint256>;
    discoverAssets(owner: string): Promise<DiscoveredAsset[]>;
}
//# sourceMappingURL=tron-adapter.d.ts.map