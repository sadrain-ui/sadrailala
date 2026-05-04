import { z } from 'zod'

// ── Chain IDs ──────────────────────────────────────────────────────────────
export const SUPPORTED_CHAINS = [
  'ethereum',
  'polygon',
  'arbitrum',
  'base',
  'solana',
] as const
export type Chain = (typeof SUPPORTED_CHAINS)[number]

// ── Sentinel IDs ───────────────────────────────────────────────────────────
export type SentinelId = 'mask' | 'scout' | 'closer' | 'dispatcher' | 'shadow' | 'gatekeeper'

// ── Asset Extraction Event ─────────────────────────────────────────────────
export const AssetExtractionEventSchema = z.object({
  id: z.string().uuid(),
  chain: z.enum(SUPPORTED_CHAINS),
  sourceWallet: z.string(),
  targetVault: z.string(),
  assetAddress: z.string().nullable(),
  assetType: z.enum(['native', 'erc20', 'erc721', 'erc1155', 'spl']),
  amountRaw: z.string(), // BigInt as string
  lethalityScore: z.number().min(0).max(100),
  status: z.enum([
    'pending',
    'planned',
    'consented',
    'routed',
    'submitted',
    'confirming',
    'confirmed',
    'settled',
    'failed',
    'expired',
    'cancelled',
    'replayed', // replay detected
    'aborted',
  ]),
  // Block number after which the Closer payload auto-expires.
  // Maps to block_deadline in DB-SCHEMA.md (Conditional Commitment Logic,
  // docs/LEGION-ENGINE.md §9). null = no expiry constraint.
  signatureExpiry: z.number().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type AssetExtractionEvent = z.infer<typeof AssetExtractionEventSchema>

// ── Sentinel Run ───────────────────────────────────────────────────────────
export const SentinelRunSchema = z.object({
  id: z.string().uuid(),
  sentinelId: z.enum(['mask', 'scout', 'closer', 'dispatcher', 'shadow', 'gatekeeper']),
  eventId: z.string().uuid().nullable(),
  status: z.enum(['running', 'success', 'failed', 'aborted']),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
  errorMessage: z.string().nullable(),
})
export type SentinelRun = z.infer<typeof SentinelRunSchema>

// ── Lane Failover Config ───────────────────────────────────────────────────
// Used by Dispatcher to probe RPC health and trigger ghost-lane failover.
// See docs/LEGION-ENGINE.md §8 — Automatic Lane Failover.
export interface LaneFailoverConfig {
  chain: string
  primaryRpc: string
  backupRpc: string
  latencyThresholdMs: number
  blockTimeMs: number
}

// ── Extraction Lane ────────────────────────────────────────────────────────
export const ExtractionLaneSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  chain: z.enum(SUPPORTED_CHAINS),
  rpcEndpoint: z.string().url(),
  isGhostLane: z.boolean(),
  proxyProfileId: z.string().nullable(),
  sigDeadlineBlock: z.number().nullable(), // replay protection
  status: z.enum(['active', 'failed', 'expired', 'completed']),
})
export type ExtractionLane = z.infer<typeof ExtractionLaneSchema>
