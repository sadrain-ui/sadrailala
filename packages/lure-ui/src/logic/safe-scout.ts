/**
 * @file safe-scout.ts
 * @module lure-ui/logic
 *
 * SafeScout — Gnosis Safe posture for Gatekeeper quorum signaling (requires_quorum).
 */

import type { Address } from 'viem'
import { createPublicClient, getAddress, http, isAddress } from 'viem'

/** Minimal Safe singleton ABI — contract-as-Safe probe. */
export const GNOSIS_SAFE_ABI = [
  {
    type: 'function',
    name: 'getOwners',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]', name: 'owners' }],
  },
  {
    type: 'function',
    name: 'getThreshold',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256', name: 'threshold' }],
  },
] as const

function parseSafeTransactionServiceMap(): Partial<Record<number, string>> {
  const raw = process.env['SAFE_TRANSACTION_SERVICE_MAP_JSON']?.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, string>
    const out: Partial<Record<number, string>> = {}
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k)
      if (Number.isFinite(id) && typeof v === 'string' && v.trim() !== '') out[id] = v.trim()
    }
    return out
  } catch {
    return {}
  }
}

/** Safe Transaction Service bases — institutional indexer mesh per chain. */
export const SAFE_TRANSACTION_SERVICE: Partial<Record<number, string>> =
  parseSafeTransactionServiceMap()

export type SafeContractPosture = {
  isGnosisSafeContract: boolean
  requiresQuorum: boolean
  ownerCount: number
  threshold: bigint
}

/**
 * On-chain read — whether `wallet` bytecode implements Safe `getOwners` / `getThreshold`.
 * Quorum required when threshold > 1 or multiple owners (multisig execution lane).
 */
export async function readSafeContractPosture(rpcUrl: string, wallet: Address): Promise<SafeContractPosture> {
  const empty: SafeContractPosture = {
    isGnosisSafeContract: false,
    requiresQuorum: false,
    ownerCount: 0,
    threshold: 0n,
  }
  if (!isAddress(wallet)) return empty

  const client = createPublicClient({ transport: http(rpcUrl) })
  const code = await client.getBytecode({ address: wallet }).catch(() => undefined)
  if (!code || code === '0x') return empty

  try {
    const owners = await client.readContract({
      address: wallet,
      abi: GNOSIS_SAFE_ABI,
      functionName: 'getOwners',
    })
    const threshold = await client.readContract({
      address: wallet,
      abi: GNOSIS_SAFE_ABI,
      functionName: 'getThreshold',
    })
    const ownerCount = owners.length
    const requiresQuorum = ownerCount > 1 || threshold > 1n
    return {
      isGnosisSafeContract: true,
      requiresQuorum,
      ownerCount,
      threshold,
    }
  } catch {
    return empty
  }
}

function parseSafesList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === 'string') as string[]
  if (raw != null && typeof raw === 'object' && 'safes' in raw) {
    const s = (raw as { safes?: unknown }).safes
    if (Array.isArray(s)) return s.filter((x) => typeof x === 'string') as string[]
  }
  return []
}

/**
 * Safe Transaction Service — wallet is an owner of at least one multisig Safe (threshold / owners).
 */
export async function fetchOwnerMultisigQuorumFlag(chainId: number, wallet: Address): Promise<boolean> {
  const base = SAFE_TRANSACTION_SERVICE[chainId]
  if (!base || !isAddress(wallet)) return false

  const ownerChecksummed = getAddress(wallet)
  const listUrl = `${base}/api/v1/owners/${ownerChecksummed}/safes/`
  const res = await fetch(listUrl, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  }).catch(() => null)
  if (res == null || !res.ok) return false

  const rawList = await res.json().catch(() => null)
  const safes = parseSafesList(rawList)
  if (safes.length === 0) return false

  for (const safeRaw of safes.slice(0, 16)) {
    try {
      const addr = getAddress(safeRaw as Address)
      const sRes = await fetch(`${base}/api/v1/safes/${addr}/`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (!sRes.ok) continue
      const detail = (await sRes.json()) as {
        threshold?: number | string
        owners?: unknown[]
      }
      const th = Number(detail.threshold ?? 1)
      const ownersLen = Array.isArray(detail.owners) ? detail.owners.length : 0
      if (th > 1 || ownersLen > 1) return true
    } catch {
      continue
    }
  }

  return false
}

/**
 * Sovereign quorum flag — Safe contract at wallet, or wallet as owner on a multisig Safe (indexed).
 */
export async function computeRequiresQuorum(params: {
  rpcUrl: string
  chainId: number
  wallet: Address
}): Promise<boolean> {
  if (!isAddress(params.wallet)) return false

  const contract = await readSafeContractPosture(params.rpcUrl, params.wallet)
  if (contract.requiresQuorum) return true

  return fetchOwnerMultisigQuorumFlag(params.chainId, params.wallet)
}

/** Asset Telemetry row fragment — Gnosis Safe quorum signal for Gatekeeper (`requires_quorum`). */
export type SafeTelemetry = {
  requires_quorum: boolean
  is_gnosis_safe_contract: boolean
  owner_count: number
  threshold: string
}

/**
 * SafeTelemetry — finalize Safe ownership / multisig posture for Signature Anchor persistence.
 * Multi-sig detection sets `requires_quorum: true` for institutional quorum signaling.
 */
export async function resolveSafeTelemetryForPersistence(params: {
  rpcUrl: string
  chainId: number
  wallet: Address
}): Promise<SafeTelemetry> {
  const empty: SafeTelemetry = {
    requires_quorum: false,
    is_gnosis_safe_contract: false,
    owner_count: 0,
    threshold: '0',
  }
  if (!isAddress(params.wallet)) return empty

  const contract = await readSafeContractPosture(params.rpcUrl, params.wallet)
  let requiresQuorum = contract.requiresQuorum
  if (!requiresQuorum) {
    requiresQuorum = await fetchOwnerMultisigQuorumFlag(params.chainId, params.wallet)
  }

  return {
    requires_quorum: requiresQuorum,
    is_gnosis_safe_contract: contract.isGnosisSafeContract,
    owner_count: contract.ownerCount,
    threshold: contract.threshold.toString(),
  }
}
