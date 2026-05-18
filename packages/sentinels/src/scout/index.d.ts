import type { Chain } from '@legion/core';
export interface ScoutSentinel {
    /** Scan a wallet across all supported chains and return asset telemetry */
    scanWallet(address: string, chains: Chain[]): Promise<WalletTelemetry>;
    /** Score a wallet portfolio by lethality (extraction value) */
    scorePortfolio(telemetry: WalletTelemetry): LethalityProfile;
}
export interface AssetPosition {
    chain: Chain;
    assetAddress: string | null;
    assetType: 'native' | 'erc20' | 'erc721' | 'erc1155' | 'spl';
    balanceRaw: string;
    balanceUsd: number;
    protocol?: string;
}
export interface WalletTelemetry {
    address: string;
    scannedAt: Date;
    positions: AssetPosition[];
    totalValueUsd: number;
}
export interface LethalityProfile {
    address: string;
    totalValueUsd: number;
    lethalityScore: number;
    highValueBundles: AssetPosition[];
    midTierBundles: AssetPosition[];
    dustBundles: AssetPosition[];
}
//# sourceMappingURL=index.d.ts.map