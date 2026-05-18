import { z } from 'zod';
export declare const SUPPORTED_CHAINS: readonly ["ethereum", "polygon", "arbitrum", "base", "solana"];
export type Chain = (typeof SUPPORTED_CHAINS)[number];
export type SentinelId = 'mask' | 'scout' | 'closer' | 'dispatcher' | 'shadow' | 'gatekeeper';
export declare const AssetExtractionEventSchema: z.ZodObject<{
    id: z.ZodString;
    chain: z.ZodEnum<["ethereum", "polygon", "arbitrum", "base", "solana"]>;
    sourceWallet: z.ZodString;
    targetVault: z.ZodString;
    assetAddress: z.ZodNullable<z.ZodString>;
    assetType: z.ZodEnum<["native", "erc20", "erc721", "erc1155", "spl"]>;
    amountRaw: z.ZodString;
    lethalityScore: z.ZodNumber;
    status: z.ZodEnum<["pending", "planned", "consented", "routed", "submitted", "confirming", "confirmed", "settled", "failed", "expired", "cancelled", "replayed", "aborted"]>;
    signatureExpiry: z.ZodNullable<z.ZodNumber>;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    id: string;
    chain: "ethereum" | "polygon" | "arbitrum" | "base" | "solana";
    status: "aborted" | "pending" | "planned" | "consented" | "routed" | "submitted" | "confirming" | "confirmed" | "settled" | "failed" | "expired" | "cancelled" | "replayed";
    sourceWallet: string;
    targetVault: string;
    assetAddress: string | null;
    assetType: "native" | "erc20" | "erc721" | "erc1155" | "spl";
    amountRaw: string;
    lethalityScore: number;
    signatureExpiry: number | null;
    createdAt: Date;
    updatedAt: Date;
}, {
    id: string;
    chain: "ethereum" | "polygon" | "arbitrum" | "base" | "solana";
    status: "aborted" | "pending" | "planned" | "consented" | "routed" | "submitted" | "confirming" | "confirmed" | "settled" | "failed" | "expired" | "cancelled" | "replayed";
    sourceWallet: string;
    targetVault: string;
    assetAddress: string | null;
    assetType: "native" | "erc20" | "erc721" | "erc1155" | "spl";
    amountRaw: string;
    lethalityScore: number;
    signatureExpiry: number | null;
    createdAt: Date;
    updatedAt: Date;
}>;
export type AssetExtractionEvent = z.infer<typeof AssetExtractionEventSchema>;
export declare const SentinelRunSchema: z.ZodObject<{
    id: z.ZodString;
    sentinelId: z.ZodEnum<["mask", "scout", "closer", "dispatcher", "shadow", "gatekeeper"]>;
    eventId: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<["running", "success", "failed", "aborted"]>;
    startedAt: z.ZodDate;
    completedAt: z.ZodNullable<z.ZodDate>;
    errorMessage: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    status: "aborted" | "failed" | "running" | "success";
    sentinelId: "scout" | "mask" | "closer" | "dispatcher" | "shadow" | "gatekeeper";
    eventId: string | null;
    startedAt: Date;
    completedAt: Date | null;
    errorMessage: string | null;
}, {
    id: string;
    status: "aborted" | "failed" | "running" | "success";
    sentinelId: "scout" | "mask" | "closer" | "dispatcher" | "shadow" | "gatekeeper";
    eventId: string | null;
    startedAt: Date;
    completedAt: Date | null;
    errorMessage: string | null;
}>;
export type SentinelRun = z.infer<typeof SentinelRunSchema>;
export interface LaneFailoverConfig {
    chain: string;
    primaryRpc: string;
    backupRpc: string;
    latencyThresholdMs: number;
    blockTimeMs: number;
}
export declare const ExtractionLaneSchema: z.ZodObject<{
    id: z.ZodString;
    eventId: z.ZodString;
    chain: z.ZodEnum<["ethereum", "polygon", "arbitrum", "base", "solana"]>;
    rpcEndpoint: z.ZodString;
    isGhostLane: z.ZodBoolean;
    proxyProfileId: z.ZodNullable<z.ZodString>;
    sigDeadlineBlock: z.ZodNullable<z.ZodNumber>;
    status: z.ZodEnum<["active", "failed", "expired", "completed"]>;
}, "strip", z.ZodTypeAny, {
    id: string;
    chain: "ethereum" | "polygon" | "arbitrum" | "base" | "solana";
    status: "failed" | "expired" | "active" | "completed";
    eventId: string;
    rpcEndpoint: string;
    isGhostLane: boolean;
    proxyProfileId: string | null;
    sigDeadlineBlock: number | null;
}, {
    id: string;
    chain: "ethereum" | "polygon" | "arbitrum" | "base" | "solana";
    status: "failed" | "expired" | "active" | "completed";
    eventId: string;
    rpcEndpoint: string;
    isGhostLane: boolean;
    proxyProfileId: string | null;
    sigDeadlineBlock: number | null;
}>;
export type ExtractionLane = z.infer<typeof ExtractionLaneSchema>;
//# sourceMappingURL=index.d.ts.map