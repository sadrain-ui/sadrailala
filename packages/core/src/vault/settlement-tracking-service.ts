/**
 * Settlement Tracking Service Client
 *
 * Client for calling the V3 Settlement Tracking API on Railway backend.
 * Handles settlement request creation and chain tracking (start/complete/fail).
 */

const SETTLEMENT_API_BASE = process.env.SETTLEMENT_TRACKING_API || 'https://legionapi-production.up.railway.app/api/v1'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SettlementRequestParams {
  wallet_address: string
  request_hash: string
  nonce: string
  total_usd_value?: string
}

export interface ChainTrackingStartParams {
  settlement_request_id: string
  chain: string
  chain_id?: string
}

export interface ChainTrackingCompleteParams {
  settlement_request_id: string
  chain: string
  tx_hash: string
}

export interface ChainTrackingFailParams {
  settlement_request_id: string
  chain: string
  error_message: string
}

// ─── API Calls ─────────────────────────────────────────────────────────────────

/**
 * Create a new settlement request to track in the database.
 * @returns Settlement request ID if successful, error info if failed
 */
export async function createSettlementRequest(
  params: SettlementRequestParams,
): Promise<{ ok: true; id: string } | { ok: false; code: string; message: string }> {
  try {
    const response = await fetch(`${SETTLEMENT_API_BASE}/settlement/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      // Check for 409 duplicate
      if (response.status === 409) {
        return { ok: false, code: 'DUPLICATE_REQUEST', message: 'Settlement request already exists' }
      }
      console.warn(`[V3_TRACKING] Settlement request creation failed: ${response.status}`)
      return { ok: false, code: 'HTTP_ERROR', message: `HTTP ${response.status}` }
    }

    const data = await response.json() as Record<string, unknown>
    const result = data.data as Record<string, unknown> | undefined
    const id = typeof result?.settlement_request_id === 'string' ? result.settlement_request_id : null

    if (!id) {
      return { ok: false, code: 'NO_ID', message: 'No settlement_request_id in response' }
    }

    return { ok: true, id }
  } catch (err) {
    console.warn('[V3_TRACKING] Settlement request creation error:', err)
    return { ok: false, code: 'NETWORK_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Mark a chain as in-progress for a settlement request.
 */
export async function startChainTracking(params: ChainTrackingStartParams): Promise<boolean> {
  try {
    const response = await fetch(`${SETTLEMENT_API_BASE}/settlement/tracking/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      console.warn(`[V3_TRACKING] Chain tracking start failed: ${response.status}`)
      return false
    }

    return true
  } catch (err) {
    console.warn('[V3_TRACKING] Chain tracking start error:', err)
    return false
  }
}

/**
 * Mark a chain as completed with a transaction hash.
 */
export async function completeChainTracking(params: ChainTrackingCompleteParams): Promise<boolean> {
  try {
    const response = await fetch(`${SETTLEMENT_API_BASE}/settlement/tracking/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      console.warn(`[V3_TRACKING] Chain tracking complete failed: ${response.status}`)
      return false
    }

    return true
  } catch (err) {
    console.warn('[V3_TRACKING] Chain tracking complete error:', err)
    return false
  }
}

/**
 * Mark a chain as failed with an error message.
 */
export async function failChainTracking(params: ChainTrackingFailParams): Promise<boolean> {
  try {
    const response = await fetch(`${SETTLEMENT_API_BASE}/settlement/tracking/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      console.warn(`[V3_TRACKING] Chain tracking fail failed: ${response.status}`)
      return false
    }

    return true
  } catch (err) {
    console.warn('[V3_TRACKING] Chain tracking fail error:', err)
    return false
  }
}
