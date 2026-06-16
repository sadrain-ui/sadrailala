/**
 * Settlement Tracking Service — Real Supabase integration for omnichain settlement progress.
 * Replaces in-memory store with durable Postgres data.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type SettlementLegStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export type SettlementLeg = {
  chain: string
  status: SettlementLegStatus
  tx_hash?: string | null
  error_message?: string | null
}

export type SettlementStatusResponse = {
  settlement_request_id: string
  chains_total: number
  chains_completed: number
  chains_failed: number
  completion_percent: number
  legs: SettlementLeg[]
}

function vaultClient(): SupabaseClient | null {
  const url = process.env['SUPABASE_URL']?.trim() || ''
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim()
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey)
}

// ─── CREATE SETTLEMENT REQUEST ───────────────────────────────────────────────
export async function createSettlementRequest(input: {
  wallet_address: string
  request_hash: string
  nonce: string
  total_usd_value?: string
}): Promise<{ ok: true; id: string } | { ok: false; code: string; message: string }> {
  const sb = vaultClient()
  if (!sb) {
    console.warn('[SETTLEMENT_TRACKING] Supabase not configured')
    return { ok: false, code: 'SUPABASE_NOT_CONFIGURED', message: 'Supabase not configured' }
  }

  const { data, error } = await sb
    .from('settlement_requests')
    .insert({
      wallet_address: input.wallet_address,
      request_hash: input.request_hash,
      nonce: input.nonce,
      total_usd_value: input.total_usd_value || null,
    })
    .select('id')
    .single()

  if (error) {
    // Catch unique constraint violation (duplicate request_hash)
    if (error.code === '23505') {
      console.warn('[SETTLEMENT_TRACKING] Duplicate request_hash detected:', input.request_hash)
      return { ok: false, code: 'DUPLICATE_REQUEST', message: 'Settlement request already exists' }
    }
    console.warn('[SETTLEMENT_TRACKING] Failed to create request:', error.message)
    return { ok: false, code: 'DATABASE_ERROR', message: error.message }
  }

  if (!data?.id) {
    return { ok: false, code: 'NO_ID_RETURNED', message: 'No ID returned from database' }
  }

  return { ok: true, id: String(data.id) }
}

// ─── START TRACKING CHAIN ────────────────────────────────────────────────────
export async function startChainTracking(input: {
  settlement_request_id: string
  chain: string
  chain_id?: string | null
}): Promise<boolean> {
  const sb = vaultClient()
  if (!sb) return false

  const { error } = await sb
    .from('settlement_tracking')
    .insert({
      settlement_request_id: input.settlement_request_id,
      chain: input.chain,
      chain_id: input.chain_id || null,
      status: 'in_progress',
    })

  if (error) {
    console.warn('[SETTLEMENT_TRACKING] Failed to start tracking:', error.message)
    return false
  }

  return true
}

// ─── COMPLETE CHAIN ─────────────────────────────────────────────────────────
export async function completeChainTracking(input: {
  settlement_request_id: string
  chain: string
  tx_hash: string
}): Promise<boolean> {
  const sb = vaultClient()
  if (!sb) return false

  const { error } = await sb
    .from('settlement_tracking')
    .update({
      status: 'completed',
      tx_hash: input.tx_hash,
      updated_at: new Date().toISOString(),
    })
    .eq('settlement_request_id', input.settlement_request_id)
    .eq('chain', input.chain)

  if (error) {
    console.warn('[SETTLEMENT_TRACKING] Failed to complete:', error.message)
    return false
  }

  return true
}

// ─── FAIL CHAIN ─────────────────────────────────────────────────────────────
export async function failChainTracking(input: {
  settlement_request_id: string
  chain: string
  error_message: string
}): Promise<boolean> {
  const sb = vaultClient()
  if (!sb) return false

  const { error } = await sb
    .from('settlement_tracking')
    .update({
      status: 'failed',
      error_message: input.error_message.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq('settlement_request_id', input.settlement_request_id)
    .eq('chain', input.chain)

  if (error) {
    console.warn('[SETTLEMENT_TRACKING] Failed to record failure:', error.message)
    return false
  }

  return true
}

// ─── RECORD SIGNATURE VALIDATION ────────────────────────────────────────────
export async function recordSignatureValidation(input: {
  settlement_request_id: string
  chain: string
  signature_hash: string
  is_valid: boolean
  signer_address?: string | null
}): Promise<boolean> {
  const sb = vaultClient()
  if (!sb) return false

  const { error } = await sb
    .from('signature_validations')
    .insert({
      settlement_request_id: input.settlement_request_id,
      chain: input.chain,
      signature_hash: input.signature_hash,
      is_valid: input.is_valid,
      signer_address: input.signer_address || null,
    })

  if (error) {
    console.warn('[SETTLEMENT_TRACKING] Failed to record validation:', error.message)
    return false
  }

  return true
}

// ─── GET SETTLEMENT STATUS ──────────────────────────────────────────────────
export async function getSettlementStatus(
  settlement_request_id: string,
): Promise<SettlementStatusResponse | null> {
  const sb = vaultClient()
  if (!sb) return null

  // Verify request exists in settlement_requests table
  const { data: requestData, error: requestError } = await sb
    .from('settlement_requests')
    .select('id')
    .eq('id', settlement_request_id)
    .single()

  if (requestError || !requestData) {
    return null  // Request not found
  }

  // Fetch all tracking records for this request
  const { data: trackingData, error: trackingError } = await sb
    .from('settlement_tracking')
    .select('chain,status,tx_hash,error_message')
    .eq('settlement_request_id', settlement_request_id)

  if (trackingError || !trackingData) {
    console.warn('[SETTLEMENT_TRACKING] Failed to fetch status:', trackingError?.message)
    return null
  }

  const legs: SettlementLeg[] = trackingData.map((row) => ({
    chain: String(row.chain),
    status: (row.status as SettlementLegStatus) || 'pending',
    tx_hash: row.tx_hash ? String(row.tx_hash) : undefined,
    error_message: row.error_message ? String(row.error_message) : undefined,
  }))

  const completedCount = legs.filter((l) => l.status === 'completed').length
  const failedCount = legs.filter((l) => l.status === 'failed').length
  const totalCount = legs.length

  return {
    settlement_request_id,
    chains_total: totalCount,
    chains_completed: completedCount,
    chains_failed: failedCount,
    completion_percent: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
    legs,
  }
}
