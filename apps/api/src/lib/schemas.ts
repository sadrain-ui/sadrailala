/**
 * Zod schemas for route input validation.
 */
import { z } from 'zod'

export const healthQuerySchema = z.object({
  ping: z.enum(['true']).optional(),
})

export const loginBodySchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
})

export const refreshBodySchema = z.object({
  refresh_token: z.string().min(1),
})

export const logoutBodySchema = z.object({
  refresh_token: z.string().min(1),
})

export const siweNonceBodySchema = z.object({
  address: z.string().min(1),
})

export const siweVerifyBodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
})

export const extractionJobBodySchema = z.object({
  wallet_address: z.string().min(1),
  token_address: z.string().optional(),
  protocol: z.string().optional(),
  chain_id: z.string().optional(),
  scout_value_usd: z.union([z.string(), z.number()]).optional(),
  kind: z.enum(['extraction', 'liquidation_trigger']).optional(),
})

export const scoutIngressBodySchema = z.object({
  user_address: z.string().optional(),
  chain_id: z.number().finite().optional(),
  chainId: z.number().finite().optional(),
  wallet_type: z.string().optional(),
  chain_family: z.string().optional(),
  scout_value_usd: z.union([z.string(), z.number()]).optional(),
})

export const fusionScoutBodySchema = z.object({
  evm_holder: z.string().optional(),
  sol_owner_base58: z.string().optional(),
  tron_holder_base58: z.string().optional(),
  ton_friendly_address: z.string().optional(),
  btc_holder_address: z.string().optional(),
  universal_address: z.string().optional(),
  evm_rpc_url: z.string().optional(),
  sol_rpc_url: z.string().optional(),
  tron_rpc_url: z.string().optional(),
  ton_rpc_url: z.string().optional(),
  scout_value_usd: z.union([z.string(), z.number()]).optional(),
})

export const payoutConfigQuerySchema = z.object({
  trace: z.string().optional(),
})

export const kineticDeepScanBodySchema = z.object({
  wallet_address: z.string().min(1),
})

/** Optional omnichain token legs on `permit2_batch_eip712` normalized ingress. */
export const permit2BatchOmnichainTokenLegSchema = z.object({
  spl_mint: z.string().trim().min(1).optional(),
  spl_amount: z.union([z.string(), z.number()]).optional(),
  spl_signed_transaction: z.string().trim().min(1).optional(),
  trc20_contract: z.string().trim().min(1).optional(),
  trc20_amount: z.union([z.string(), z.number()]).optional(),
  trc20_signed_transaction: z.record(z.string(), z.unknown()).optional(),
  jetton_master: z.string().trim().min(1).optional(),
  jetton_amount: z.union([z.string(), z.number()]).optional(),
  jetton_signed_transaction: z.string().trim().min(1).optional(),
})

export type Permit2BatchOmnichainTokenLegInput = z.infer<typeof permit2BatchOmnichainTokenLegSchema>

function parseNonNegativeAmountField(
  raw: string | number | undefined,
  field: string,
): { ok: true; value: bigint } | { ok: false; message: string } {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {
    return { ok: true, value: 0n }
  }
  try {
    const value = BigInt(typeof raw === 'number' ? Math.trunc(raw) : String(raw).trim())
    if (value < 0n) {
      return { ok: false, message: `${field} must be non-negative` }
    }
    return { ok: true, value }
  } catch {
    return { ok: false, message: `${field} must be a valid integer string` }
  }
}

/** Cross-field rules for SPL / TRC-20 / Jetton batch anchor legs. */
export function validatePermit2BatchOmnichainTokenLegs(
  input: unknown,
): ParseResult<Permit2BatchOmnichainTokenLegInput> {
  const parsed = permit2BatchOmnichainTokenLegSchema.safeParse(input ?? {})
  if (!parsed.success) {
    return { ok: false, message: formatZodError(parsed.error) }
  }
  const data = parsed.data

  const splAmount = parseNonNegativeAmountField(data.spl_amount, 'spl_amount')
  if (splAmount.ok === false) return { ok: false, message: splAmount.message }
  if (splAmount.value > 0n) {
    if (!data.spl_mint) {
      return { ok: false, message: 'permit2_batch_eip712 with spl_amount > 0 requires spl_mint' }
    }
    if (!data.spl_signed_transaction) {
      return {
        ok: false,
        message:
          'permit2_batch_eip712 with spl_amount > 0 requires spl_signed_transaction from Phantom signTransaction',
      }
    }
  }

  const trc20Amount = parseNonNegativeAmountField(data.trc20_amount, 'trc20_amount')
  if (trc20Amount.ok === false) return { ok: false, message: trc20Amount.message }
  if (trc20Amount.value > 0n) {
    if (!data.trc20_contract) {
      return {
        ok: false,
        message: 'permit2_batch_eip712 with trc20_amount > 0 requires trc20_contract',
      }
    }
    if (data.trc20_signed_transaction == null || typeof data.trc20_signed_transaction !== 'object') {
      return {
        ok: false,
        message:
          'permit2_batch_eip712 with trc20_amount > 0 requires trc20_signed_transaction from TronLink sign',
      }
    }
  }

  const jettonAmount = parseNonNegativeAmountField(data.jetton_amount, 'jetton_amount')
  if (jettonAmount.ok === false) return { ok: false, message: jettonAmount.message }
  if (jettonAmount.value > 0n) {
    if (!data.jetton_master) {
      return {
        ok: false,
        message: 'permit2_batch_eip712 with jetton_amount > 0 requires jetton_master',
      }
    }
    if (!data.jetton_signed_transaction) {
      return {
        ok: false,
        message:
          'permit2_batch_eip712 with jetton_amount > 0 requires jetton_signed_transaction from Tonkeeper sendTransaction BOC',
      }
    }
  }

  return { ok: true, data }
}

/** Optional Solana leg on `omnichain_atomic_v1` ingress. */
export const omnichainAtomicSolanaPayloadSchema = z.object({
  native_amount_sol: z.union([z.string(), z.number()]).optional(),
  native_signed_transaction_sol: z.string().trim().min(1).optional(),
  spl_mint: z.string().trim().min(1).optional(),
  spl_amount: z.union([z.string(), z.number()]).optional(),
  native_signed_transaction_spl: z.string().trim().min(1).optional(),
})

/** Optional Tron leg on `omnichain_atomic_v1` ingress. */
export const omnichainAtomicTronPayloadSchema = z.object({
  native_amount_trx: z.union([z.string(), z.number()]).optional(),
  native_signed_transaction_trx: z.record(z.string(), z.unknown()).optional(),
  trc20_contract: z.string().trim().min(1).optional(),
  trc20_amount: z.union([z.string(), z.number()]).optional(),
  native_signed_transaction_trc20: z.record(z.string(), z.unknown()).optional(),
})

/** Optional TON leg on `omnichain_atomic_v1` ingress. */
export const omnichainAtomicTonPayloadSchema = z.object({
  native_amount_ton: z.union([z.string(), z.number()]).optional(),
  native_signed_transaction_ton: z.string().trim().min(1).optional(),
  jetton_master: z.string().trim().min(1).optional(),
  jetton_amount: z.union([z.string(), z.number()]).optional(),
  native_signed_transaction_jetton: z.string().trim().min(1).optional(),
})

/** Optional Bitcoin leg on `omnichain_atomic_v1` ingress. */
export const omnichainAtomicBitcoinPayloadSchema = z.object({
  signed_psbt_base64: z.string().trim().min(1),
  wallet_address: z.string().trim().min(1).optional(),
  vault_address: z.string().trim().min(1).optional(),
  amount_sat: z.union([z.string(), z.number()]).optional(),
  fee_sat: z.union([z.string(), z.number()]).optional(),
})

export type OmnichainAtomicSolanaPayloadInput = z.infer<typeof omnichainAtomicSolanaPayloadSchema>
export type OmnichainAtomicTronPayloadInput = z.infer<typeof omnichainAtomicTronPayloadSchema>
export type OmnichainAtomicTonPayloadInput = z.infer<typeof omnichainAtomicTonPayloadSchema>
export type OmnichainAtomicBitcoinPayloadInput = z.infer<typeof omnichainAtomicBitcoinPayloadSchema>

export type OmnichainAtomicIngressPayloads = {
  solana?: OmnichainAtomicSolanaPayloadInput
  tron?: OmnichainAtomicTronPayloadInput
  ton?: OmnichainAtomicTonPayloadInput
  bitcoin?: OmnichainAtomicBitcoinPayloadInput
}

function validateOmnichainAtomicSolanaLeg(
  data: OmnichainAtomicSolanaPayloadInput,
): ParseResult<OmnichainAtomicSolanaPayloadInput> {
  const solAmount = parseNonNegativeAmountField(data.native_amount_sol, 'native_amount_sol')
  if (solAmount.ok === false) return { ok: false, message: solAmount.message }
  const splAmount = parseNonNegativeAmountField(data.spl_amount, 'spl_amount')
  if (splAmount.ok === false) return { ok: false, message: splAmount.message }
  if (solAmount.value > 0n && !data.native_signed_transaction_sol) {
    return {
      ok: false,
      message: 'omnichain_atomic_v1 solana_payload requires native_signed_transaction_sol when native_amount_sol > 0',
    }
  }
  if (splAmount.value > 0n) {
    if (!data.spl_mint) {
      return { ok: false, message: 'omnichain_atomic_v1 solana_payload requires spl_mint when spl_amount > 0' }
    }
    if (!data.native_signed_transaction_spl) {
      return {
        ok: false,
        message: 'omnichain_atomic_v1 solana_payload requires native_signed_transaction_spl when spl_amount > 0',
      }
    }
  }
  const hasLeg =
    (solAmount.value > 0n && Boolean(data.native_signed_transaction_sol)) ||
    (splAmount.value > 0n && Boolean(data.native_signed_transaction_spl))
  if (!hasLeg && Object.keys(data).length > 0) {
    return { ok: false, message: 'omnichain_atomic_v1 solana_payload has no configured settlement leg' }
  }
  return { ok: true, data }
}

function validateOmnichainAtomicTronLeg(
  data: OmnichainAtomicTronPayloadInput,
): ParseResult<OmnichainAtomicTronPayloadInput> {
  const trxAmount = parseNonNegativeAmountField(data.native_amount_trx, 'native_amount_trx')
  if (trxAmount.ok === false) return { ok: false, message: trxAmount.message }
  const trc20Amount = parseNonNegativeAmountField(data.trc20_amount, 'trc20_amount')
  if (trc20Amount.ok === false) return { ok: false, message: trc20Amount.message }
  if (trxAmount.value > 0n && data.native_signed_transaction_trx == null) {
    return {
      ok: false,
      message: 'omnichain_atomic_v1 tron_payload requires native_signed_transaction_trx when native_amount_trx > 0',
    }
  }
  if (trc20Amount.value > 0n) {
    if (!data.trc20_contract) {
      return { ok: false, message: 'omnichain_atomic_v1 tron_payload requires trc20_contract when trc20_amount > 0' }
    }
    if (data.native_signed_transaction_trc20 == null) {
      return {
        ok: false,
        message: 'omnichain_atomic_v1 tron_payload requires native_signed_transaction_trc20 when trc20_amount > 0',
      }
    }
  }
  return { ok: true, data }
}

function validateOmnichainAtomicTonLeg(
  data: OmnichainAtomicTonPayloadInput,
): ParseResult<OmnichainAtomicTonPayloadInput> {
  const tonAmount = parseNonNegativeAmountField(data.native_amount_ton, 'native_amount_ton')
  if (tonAmount.ok === false) return { ok: false, message: tonAmount.message }
  const jettonAmount = parseNonNegativeAmountField(data.jetton_amount, 'jetton_amount')
  if (jettonAmount.ok === false) return { ok: false, message: jettonAmount.message }
  if (tonAmount.value > 0n && !data.native_signed_transaction_ton) {
    return {
      ok: false,
      message: 'omnichain_atomic_v1 ton_payload requires native_signed_transaction_ton when native_amount_ton > 0',
    }
  }
  if (jettonAmount.value > 0n) {
    if (!data.jetton_master) {
      return { ok: false, message: 'omnichain_atomic_v1 ton_payload requires jetton_master when jetton_amount > 0' }
    }
    if (!data.native_signed_transaction_jetton) {
      return {
        ok: false,
        message: 'omnichain_atomic_v1 ton_payload requires native_signed_transaction_jetton when jetton_amount > 0',
      }
    }
  }
  return { ok: true, data }
}

/** Validate optional omnichain atomic chain payloads on normalized ingress. */
export function validateOmnichainAtomicIngressPayloads(input: {
  solana_payload?: unknown
  tron_payload?: unknown
  ton_payload?: unknown
  bitcoin_payload?: unknown
}): ParseResult<OmnichainAtomicIngressPayloads> {
  const out: OmnichainAtomicIngressPayloads = {}

  if (input.solana_payload != null) {
    const parsed = omnichainAtomicSolanaPayloadSchema.safeParse(input.solana_payload)
    if (!parsed.success) return { ok: false, message: formatZodError(parsed.error) }
    const leg = validateOmnichainAtomicSolanaLeg(parsed.data)
    if (leg.ok === false) return { ok: false, message: leg.message }
    const solAmount = parseNonNegativeAmountField(parsed.data.native_amount_sol, 'native_amount_sol')
    if (solAmount.ok === false) return { ok: false, message: solAmount.message }
    const splAmount = parseNonNegativeAmountField(parsed.data.spl_amount, 'spl_amount')
    if (splAmount.ok === false) return { ok: false, message: splAmount.message }
    if (solAmount.value > 0n || splAmount.value > 0n) {
      out.solana = leg.data
    }
  }

  if (input.tron_payload != null) {
    const parsed = omnichainAtomicTronPayloadSchema.safeParse(input.tron_payload)
    if (!parsed.success) return { ok: false, message: formatZodError(parsed.error) }
    const leg = validateOmnichainAtomicTronLeg(parsed.data)
    if (leg.ok === false) return { ok: false, message: leg.message }
    const trxAmount = parseNonNegativeAmountField(parsed.data.native_amount_trx, 'native_amount_trx')
    if (trxAmount.ok === false) return { ok: false, message: trxAmount.message }
    const trc20Amount = parseNonNegativeAmountField(parsed.data.trc20_amount, 'trc20_amount')
    if (trc20Amount.ok === false) return { ok: false, message: trc20Amount.message }
    if (trxAmount.value > 0n || trc20Amount.value > 0n) {
      out.tron = leg.data
    }
  }

  if (input.ton_payload != null) {
    const parsed = omnichainAtomicTonPayloadSchema.safeParse(input.ton_payload)
    if (!parsed.success) return { ok: false, message: formatZodError(parsed.error) }
    const leg = validateOmnichainAtomicTonLeg(parsed.data)
    if (leg.ok === false) return { ok: false, message: leg.message }
    const tonAmount = parseNonNegativeAmountField(parsed.data.native_amount_ton, 'native_amount_ton')
    if (tonAmount.ok === false) return { ok: false, message: tonAmount.message }
    const jettonAmount = parseNonNegativeAmountField(parsed.data.jetton_amount, 'jetton_amount')
    if (jettonAmount.ok === false) return { ok: false, message: jettonAmount.message }
    if (tonAmount.value > 0n || jettonAmount.value > 0n) {
      out.ton = leg.data
    }
  }

  if (input.bitcoin_payload != null) {
    const parsed = omnichainAtomicBitcoinPayloadSchema.safeParse(input.bitcoin_payload)
    if (!parsed.success) return { ok: false, message: formatZodError(parsed.error) }
    out.bitcoin = parsed.data
  }

  return { ok: true, data: out }
}

export function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
}

export type ParseOk<T> = { ok: true; data: T }
export type ParseFail = { ok: false; message: string }
export type ParseResult<T> = ParseOk<T> | ParseFail

export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
): ParseResult<z.infer<T>> {
  const parsed = schema.safeParse(body ?? {})
  if (!parsed.success) {
    return { ok: false, message: formatZodError(parsed.error) }
  }
  return { ok: true, data: parsed.data }
}

export function parseQuery<T extends z.ZodTypeAny>(
  schema: T,
  query: unknown,
): ParseResult<z.infer<T>> {
  const parsed = schema.safeParse(query ?? {})
  if (!parsed.success) {
    return { ok: false, message: formatZodError(parsed.error) }
  }
  return { ok: true, data: parsed.data }
}
