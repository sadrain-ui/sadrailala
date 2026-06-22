// @ts-nocheck
/**
 * @module @legion/core/logic/scout
 * Recursive Predator — institutional discovery registry (staking, LP, NFT floor priority).
 * Omnichain Expansion — Chain-Agnostic Sensory Lanes (EVM / SVM / TRON / TON) via universal ingress address.
 */
import { type Address } from 'viem';
/** Lido stETH (Ethereum mainnet). */
export declare const RECURSIVE_PREDATOR_STETH_TOKEN: Address;
/** Marinade mSOL mint (Solana mainnet-beta). */
export declare const RECURSIVE_PREDATOR_MSOL_MINT = "mSoLzYCxHdYgdzU16g5QSh3i5K3u3K7KL";
/** Canonical mainnet-beta JitoSOL mint — desk override via `LEGION_JITOSOL_MINT`. */
export declare const RECURSIVE_PREDATOR_JITOSOL_MINT_DEFAULT = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
/**
 * Jito Staked SOL (mainnet-beta). Override with `LEGION_JITOSOL_MINT` when the desk rotates mint references.
 */
export declare const RECURSIVE_PREDATOR_JITOSOL_MINT: string | false;
export declare function resolveRecursivePredatorJitoSolMint(): string;
/** Uniswap V3 — canonical factory (Ethereum mainnet). */
export declare const RECURSIVE_PREDATOR_UNISWAP_V3_FACTORY: Address;
/** PancakeSwap V3 — factory (BNB Chain). */
export declare const RECURSIVE_PREDATOR_PANCAKE_V3_FACTORY: Address;
/** Raydium — AMM v4 program (Solana mainnet-beta). */
export declare const RECURSIVE_PREDATOR_RAYDIUM_AMM_V4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
/** CryptoPunks — high-value collection (instant liquidation priority lane). */
export declare const RECURSIVE_PREDATOR_NFT_PUNKS: Address;
/** Bored Ape Yacht Club — high-value collection (instant liquidation priority lane). */
export declare const RECURSIVE_PREDATOR_NFT_BAYC: Address;
export type RecursivePredatorStakeVenue = 'lido_steth' | 'marinade_msol' | 'jito_jitosol';
export type RecursivePredatorLpVenue = 'uniswap_v3' | 'pancakeswap_v3' | 'raydium';
export declare function probeRecursivePredatorStEthBalanceWei(rpcUrl: string, holder: Address): Promise<bigint | null>;
type SplParsedHolding = {
    raw: bigint;
    decimals: number;
};
export declare function probeRecursivePredatorSplMintBalanceRaw(rpcUrl: string, ownerBase58: string, mintBase58: string): Promise<bigint | null>;
/**
 * Full SPL balance + decimals for additive Raydium LP token USD (Recursive Predator).
 */
export declare function probeRecursivePredatorSplMintHolding(rpcUrl: string, ownerBase58: string, mintBase58: string): Promise<SplParsedHolding | null>;
/**
 * Raydium / CLMM LP token USD — desk-scoped mint list; 9-dec → SOL-USD, 6-dec → ~1 USD (stable proxy).
 */
export declare function probeRecursivePredatorRaydiumLpUsd(rpcUrl: string, solOwner: string, solUsd: number): Promise<number>;
export declare function isRecursivePredatorInstantLiquidationNft(collection: Address): boolean;
export type RecursivePredatorFusionUsd = {
    staked_steth_usd: number;
    staked_msol_usd: number;
    staked_jitosol_usd: number;
    lp_uniswap_v3_usd: number;
    lp_pancake_v3_usd: number;
    lp_raydium_usd: number;
    nft_floor_signal_usd: number;
    /** Omnichain Expansion — TRC-20 USDT (mainnet) notional USD at reference TRX/USD. */
    tron_trc20_usdt_usd: number;
    /** Omnichain Expansion — native TON wallet density at reference TON/USD. */
    ton_native_usd: number;
    /** TRC-20 USDT allowance(owner, delegate) in raw 6-decimal units; null when delegate unset or read fault. */
    tron_usdt_allowance_sun: string | null;
    /** Native TON balance in nanotons; null when lane inactive or read fault. */
    ton_balance_nano: string | null;
};
/** Chain-Agnostic RPC mesh — any Sensory Lane full-node / JSON-RPC endpoint override. */
export type OmnichainRpcMesh = {
    evm?: string;
    svm?: string;
    tron?: string;
    ton?: string;
};
/**
 * Universal Liquidity Blackhole — classify one opaque ingress string across all Sensory Lanes
 * (non-exclusive: each family validates independently for parallel Recursive Predator fusion).
 */
export declare function resolveUniversalSensoryLanes(raw: string | null | undefined): {
    evmHolder: Address | null;
    solOwnerBase58: string | null;
    tronHolderBase58: string | null;
    tonFriendlyAddress: string | null;
};
/** Institutional desk stub — LP USD fusion requires pool-state reads; registry pins venue coverage. */
export declare function baseRecursivePredatorFusionShell(): RecursivePredatorFusionUsd;
/**
 * Recursive Predator fusion — parallel probes across Sensory Lanes (EVM, SVM, TRON, TON).
 * Chain-Agnostic: `universalAddress` fans out to every lane that accepts the string; `chainRpcMesh` overrides per-lane RPC.
 */
export declare function runRecursivePredatorFusionUsd(params: {
    evmRpcUrl: string;
    solRpcUrl: string;
    evmHolder?: Address | null;
    solOwnerBase58?: string | null;
    ethUsd: number;
    solUsd: number;
    trxUsd?: number;
    tonUsd?: number;
    /** Omnichain Expansion — opaque ingress; merged with explicit per-family holders. */
    universalAddress?: string | null;
    chainRpcMesh?: Partial<OmnichainRpcMesh>;
    tronFullNodeUrl?: string | null;
    tonJsonRpcUrl?: string | null;
    /** Explicit TRON Sensory Lane holder (merged with universal classification). */
    tronHolderBase58?: string | null;
    /** Explicit TON Sensory Lane friendly address (merged with universal classification). */
    tonFriendlyAddress?: string | null;
}): Promise<RecursivePredatorFusionUsd>;
export {};
//# sourceMappingURL=scout.d.ts.map