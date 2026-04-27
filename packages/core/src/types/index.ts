import { z } from 'zod'

// ─── Chain IDs ───────────────────────────────────────────────────────────────
export const SUPPORTED_CHAINS = [
  'ethereum',
  'base',
  'arbitrum',
  'bnb',
  'solana',
] as const
export type SupportedChain = (typeof SUPPORTED_CHAINS)[number]

// ─── Sentinel Names ───────────────────────────────────────────────────────────
export const SENTINEL_NAMES = [
  'mask',
  'scout',
  'closer',
  'dispatcher',
  'shadow',
  'gatekeeper',
] as const
export type SentinelName = (typeof SENTINEL_NAMES)[number]

// ─── Extraction Lane State Machine ──────────────────────────────────────────
export const ExtractionLaneStatus = z.enum([
  'pending',
  'telemetry',
  'planning',
  'awaiting_consent',
  'consent_given',
  'routing',
  'submitted',
  'confirming',
  'confirmed',
  'anonymity_hop',
  'settled',
  'failed',
  'expired',
])
export type ExtractionLaneStatus = z.infer<typeof ExtractionLaneStatus>

// ─── Asset Extraction Event ──────────────────────────────────────────────────
export const AssetExtractionEvent = z.object({
  id: z.string().uuid(),
  chain: z.enum(SUPPORTED_CHAINS),
  walletAddress: z.string(),
  assetAddress: z.string().nullable(),
  assetSymbol: z.string(),
  amountRaw: z.string(),   // BigInt as string
  amountUsd: z.number(),
  status: ExtractionLaneStatus,
  sentinelLog: z.array(z.object({
    sentinel: z.enum(SENTINEL_NAMES),
    action: z.string(),
    timestamp: z.date(),
  })),
  signatureExpiry: z.number().nullable(), // block number
  relayer: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type AssetExtractionEvent = z.infer<typeof AssetExtractionEvent>

// ─── Sentinel Interface ──────────────────────────────────────────────────────
export interface SentinelModule {
  name: SentinelName
  init(): Promise<void>
  healthCheck(): Promise<{ ok: boolean; latencyMs: number }>
  shutdown(): Promise<void>
}

// ─── Lethality Profile ───────────────────────────────────────────────────────
export const LethalityTier = z.enum(['high', 'mid', 'dust'])
export type LethalityTier = z.infer<typeof LethalityTier>

export function classifyLethality(usdValue: number): LethalityTier {
  if (usdValue >= 10_000) return 'high'
  if (usdValue >= 500) return 'mid'
  return 'dust'
}
