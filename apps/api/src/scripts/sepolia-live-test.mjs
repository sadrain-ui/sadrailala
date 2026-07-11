/**
 * Sepolia end-to-end settlement verification.
 *
 * Signs real Permit2 EIP-712 + a signed EVM raw tx (intermediary hop), POSTs normalized_v1
 * to production signature-anchor, polls Supabase settlement_status, reports relay hashes.
 *
 * Usage (from repo root):
 *   node apps/api/src/scripts/sepolia-live-test.mjs
 *
 * Required env (.env or process):
 *   RPC_ETHEREUM_PRIVATE          Sepolia JSON-RPC URL (Alchemy/Infura Sepolia endpoint)
 *   SEPOLIA_TEST_WALLET_KEY       0x… private key — funds first leg to RELAY_INTERMEDIARY_EVM
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Recommended (must match Railway production for relay path):
 *   ENGINE_SPENDER or NEXT_PUBLIC_ENGINE_SPENDER or ADMIN_WALLET_ADDRESS
 *   RELAY_INTERMEDIARY_EVM        first-leg `to` (production)
 *   VAULT_ADDRESS_EVM or SOVEREIGN_VAULT_EVM
 *
 * Optional:
 *   SEPOLIA_LIVE_TEST_BASE        default https://sadrailala-production.up.railway.app
 *   SEPOLIA_TEST_TOKEN            default Sepolia USDC
 *   SEPOLIA_TEST_AMOUNT_WEI       default 1000000000000000 (0.001 ETH)
 *   SEPOLIA_POLL_MAX_SEC          default 1200 (20 min — includes 2–8 min anti-correlation + second leg)
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  keccak256,
  stringToHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const CHAIN_ID = 11155111
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const DEFAULT_BASE = 'https://sadrailala-production.up.railway.app'
const DEFAULT_SEPOLIA_USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const EXPIRY_ISO = '2099-12-31T23:59:59.999Z'
const PERMIT2_MAX_AMOUNT = (1n << 160n) - 1n
const SIG_DEADLINE_2099 = 4102444800n
const POLL_INTERVAL_MS = 10_000

const permit2AllowanceAbi = [
  {
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
]

function loadEnvFile() {
  const merged = { ...process.env }
  try {
    const text = readFileSync(new URL('../../../../.env', import.meta.url), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!m) continue
      if (merged[m[1]] == null || merged[m[1]] === '') {
        merged[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
      }
    }
  } catch {
    /* optional local .env */
  }
  return merged
}

function requireEnv(env, key) {
  const v = env[key]?.trim()
  if (!v) throw new Error(`Missing required env: ${key}`)
  return v
}

function normalizePrivateKey(raw) {
  const t = raw.trim()
  return t.startsWith('0x') ? t : `0x${t}`
}

function buildPermit2SingleTypedData(params) {
  return {
    domain: {
      name: 'Permit2',
      chainId: params.chainId,
      verifyingContract: params.permit2Address,
    },
    types: {
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
    },
    primaryType: 'PermitSingle',
    message: {
      details: {
        token: params.token,
        amount: params.amount,
        expiration: params.expiration,
        nonce: params.nonce,
      },
      spender: params.spender,
      sigDeadline: params.sigDeadline,
    },
  }
}

function computeAnchorExpirationSec(fromSec = Math.floor(Date.now() / 1000)) {
  return fromSec + 30 * 24 * 60 * 60
}

function buildLegionNormalizedPayload({
  wallet,
  token,
  signatureHex,
  nonce,
  engineSpender,
  permit2,
  amountWei,
}) {
  return {
    ingress: 'normalized_v1',
    chain_family: 'EVM',
    wallet_address: wallet,
    token_address: token,
    signature: signatureHex,
    signature_hex: signatureHex,
    nonce,
    expiry_iso: EXPIRY_ISO,
    wallet_type: 'SepoliaLiveTest',
    protocol: 'permit2_eip712',
    chain_id: CHAIN_ID,
    engine_spender: engineSpender,
    permit2,
    scout_value_usd: 5000,
    amount: String(amountWei),
    max_allowance: String(PERMIT2_MAX_AMOUNT),
    requires_quorum: false,
  }
}

function encodeLegionSignatureEnvelope(envelope) {
  const json = JSON.stringify(envelope)
  return stringToHex(json)
}

async function readPermit2Nonce(publicClient, owner, token, spender) {
  const [, , nonce] = await publicClient.readContract({
    address: PERMIT2_ADDRESS,
    abi: permit2AllowanceAbi,
    functionName: 'allowance',
    args: [owner, token, spender],
  })
  return Number(nonce)
}

async function signFirstLegRawTx({ publicClient, account, chain, to, value }) {
  const walletClient = createWalletClient({
    account,
    chain,
    transport: publicClient.transport,
  })
  const request = await publicClient.prepareTransactionRequest({
    account,
    chain,
    to,
    value,
  })
  const serialized = await account.signTransaction(request)
  const txHash = keccak256(serialized)
  return { serialized, txHash }
}

async function findSecondLegHash(publicClient, { from, to, afterBlock }) {
  const latest = await publicClient.getBlockNumber()
  const start = afterBlock > 0n ? afterBlock : latest > 20n ? latest - 20n : 0n
  for (let blockNum = start; blockNum <= latest; blockNum++) {
    const block = await publicClient.getBlock({
      blockNumber: blockNum,
      includeTransactions: true,
    })
    for (const tx of block.transactions) {
      if (typeof tx !== 'object' || tx == null) continue
      if (tx.from && getAddress(tx.from) === getAddress(from) && tx.to && getAddress(tx.to) === getAddress(to)) {
        return tx.hash
      }
    }
  }
  return null
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollSettlement(sb, nonce, maxMs) {
  const deadline = Date.now() + maxMs
  let last = null
  while (Date.now() < deadline) {
    const { data, error } = await sb
      .from('signatures')
      .select(
        'nonce,settlement_status,scheduled_broadcast_time,amount,chain_id,wallet_address,created_at',
      )
      .eq('nonce', nonce)
      .maybeSingle()
    if (error) throw new Error(`Supabase poll failed: ${error.message}`)
    if (data) {
      const status = data.settlement_status ?? 'PENDING'
      const stamp = new Date().toISOString()
      if (last?.settlement_status !== status) {
        console.log(`[${stamp}] settlement_status -> ${status}`)
        if (data.scheduled_broadcast_time) {
          console.log(`  scheduled_broadcast_time: ${data.scheduled_broadcast_time}`)
        }
      }
      last = data
      if (status === 'SETTLED' || status === 'FAILED_SETTLEMENT' || status === 'FAILED_STRIKE') {
        return data
      }
    } else {
      console.log(`[${new Date().toISOString()}] row not visible yet (nonce=${nonce})`)
    }
    await sleep(POLL_INTERVAL_MS)
  }
  return last
}

async function main() {
  const env = loadEnvFile()
  const rpcUrl = requireEnv(env, 'RPC_ETHEREUM_PRIVATE')
  const testKey = normalizePrivateKey(requireEnv(env, 'SEPOLIA_TEST_WALLET_KEY'))
  const supabaseUrl = requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL')
  const supabaseKey = requireEnv(env, 'SUPABASE_SERVICE_ROLE_KEY')

  const base = env.SEPOLIA_LIVE_TEST_BASE?.trim() || DEFAULT_BASE
  const token = getAddress(env.SEPOLIA_TEST_TOKEN?.trim() || DEFAULT_SEPOLIA_USDC)
  const amountWei = BigInt(env.SEPOLIA_TEST_AMOUNT_WEI?.trim() || '1000000000000000')
  const pollMaxSec = Number(env.SEPOLIA_POLL_MAX_SEC?.trim() || '1200')

  const engineSpender = getAddress(
    env.ENGINE_SPENDER?.trim() ||
      env.NEXT_PUBLIC_ENGINE_SPENDER?.trim() ||
      env.ADMIN_WALLET_ADDRESS?.trim() ||
      '0xd52C5968E9aCBf970c60a5Dbaf9eA7385715E90f',
  )
  const permit2 = getAddress(PERMIT2_ADDRESS)

  const vaultRaw = env.VAULT_ADDRESS_EVM?.trim() || env.SOVEREIGN_VAULT_EVM?.trim()
  const intermediaryRaw = env.RELAY_INTERMEDIARY_EVM?.trim()

  if (!vaultRaw || !isAddress(vaultRaw)) {
    console.warn('WARN: VAULT_ADDRESS_EVM / SOVEREIGN_VAULT_EVM not set locally — second-leg discovery may fail')
  }
  const vault = vaultRaw && isAddress(vaultRaw) ? getAddress(vaultRaw) : null
  const intermediary =
    intermediaryRaw && isAddress(intermediaryRaw) ? getAddress(intermediaryRaw) : vault
  const firstLegTo = intermediary ?? vault
  if (!firstLegTo) {
    throw new Error('Set RELAY_INTERMEDIARY_EVM or VAULT_ADDRESS_EVM in env for relay destination')
  }

  const account = privateKeyToAccount(testKey)
  const wallet = getAddress(account.address)
  const nonce = `sepolia-live-${Date.now()}`

  const transport = http(rpcUrl)
  const publicClient = createPublicClient({ chain: sepolia, transport })

  console.log('=== SEPOLIA LIVE SETTLEMENT TEST ===')
  console.log('api_base:', base)
  console.log('chain_id:', CHAIN_ID)
  console.log('wallet:', wallet)
  console.log('token:', token)
  console.log('amount_wei:', amountWei.toString())
  console.log('engine_spender:', engineSpender)
  console.log('permit2:', permit2)
  console.log('relay_first_leg_to:', firstLegTo)
  console.log('relay_vault:', vault ?? '(unknown locally)')
  console.log('nonce:', nonce)

  const balance = await publicClient.getBalance({ address: wallet })
  console.log('wallet_balance_wei:', balance.toString())
  if (balance < amountWei) {
    throw new Error(
      `Insufficient Sepolia ETH on test wallet (need >= ${amountWei} wei for first leg value)`,
    )
  }

  const permitNonce = await readPermit2Nonce(publicClient, wallet, token, engineSpender)
  const expiration = computeAnchorExpirationSec()

  const permitTyped = buildPermit2SingleTypedData({
    chainId: CHAIN_ID,
    permit2Address: permit2,
    token,
    amount: PERMIT2_MAX_AMOUNT,
    expiration,
    nonce: permitNonce,
    spender: engineSpender,
    sigDeadline: SIG_DEADLINE_2099,
  })

  const permit2Signature = await account.signTypedData(permitTyped)

  console.log('permit2_eip712_signed:', permit2Signature.slice(0, 18) + '…')

  const { serialized: evmRawTransaction, txHash: firstLegTxHash } = await signFirstLegRawTx({
    publicClient,
    account,
    chain: sepolia,
    to: firstLegTo,
    value: amountWei,
  })

  console.log('first_leg_tx_hash (local):', firstLegTxHash)
  console.log('first_leg_raw_bytes:', evmRawTransaction.length)

  const legionEnvelope = {
    ingress_lane: 'permit2_eip712_relay_v1',
    permit2_signature: permit2Signature,
    evm_raw_transaction: evmRawTransaction,
    chain_id: CHAIN_ID,
    wallet_address: wallet,
    token_address: token,
    relay_first_leg_to: firstLegTo,
    relay_vault: vault,
  }
  const signatureHex = encodeLegionSignatureEnvelope(legionEnvelope)
  const body = buildLegionNormalizedPayload({
    wallet,
    token,
    signatureHex,
    nonce,
    engineSpender,
    permit2,
    amountWei,
  })

  console.log('\nPOST /api/signature-anchor …')
  const started = Date.now()
  const res = await fetch(`${base}/api/signature-anchor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const responseText = await res.text()
  let responseJson
  try {
    responseJson = JSON.parse(responseText)
  } catch {
    responseJson = { raw: responseText }
  }
  console.log('anchor_status:', res.status, `${Date.now() - started}ms`)
  console.log('anchor_response:', JSON.stringify(responseJson, null, 2))

  if (!res.ok || responseJson?.ok !== true) {
    process.exitCode = 1
    return
  }

  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  console.log(`\nPolling Supabase every ${POLL_INTERVAL_MS / 1000}s (max ${pollMaxSec}s) …`)
  const finalRow = await pollSettlement(sb, nonce, pollMaxSec * 1000)

  let firstLegOnChain = firstLegTxHash
  let firstLegBlock = 0n
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: firstLegTxHash,
      timeout: 120_000,
    })
    firstLegOnChain = receipt.transactionHash
    firstLegBlock = receipt.blockNumber
    console.log('first_leg_confirmed:', firstLegOnChain, 'block', firstLegBlock.toString())
  } catch (e) {
    console.warn(
      'first_leg_receipt:',
      e instanceof Error ? e.message : String(e),
      '(server may still broadcast after anti-correlation delay)',
    )
  }

  let secondLegTxHash = null
  if (vault && intermediary && getAddress(intermediary) !== getAddress(vault)) {
    console.log('scanning for second leg (intermediary -> vault) …')
    await sleep(95_000)
    secondLegTxHash = await findSecondLegHash(publicClient, {
      from: intermediary,
      to: vault,
      afterBlock: firstLegBlock > 0n ? firstLegBlock : 0n,
    })
  }

  const status = finalRow?.settlement_status ?? 'TIMEOUT'
  const relayPath =
    intermediary && vault && getAddress(intermediary) !== getAddress(vault)
      ? 'two_hop_intermediary'
      : 'direct_vault'

  console.log('\n=== RESULT ===')
  console.log(
    JSON.stringify(
      {
        ok: status === 'SETTLED',
        nonce,
        settlement_status: status,
        relay_path: relayPath,
        first_leg: {
          expected_to: firstLegTo,
          tx_hash: firstLegOnChain,
        },
        second_leg: secondLegTxHash
          ? { expected_to: vault, tx_hash: secondLegTxHash }
          : vault && intermediary
            ? { expected_to: vault, tx_hash: null, note: 'not found on-chain yet — check Telegram / Railway logs' }
            : null,
        db_row: finalRow,
        hints:
          status === 'FAILED_SETTLEMENT'
            ? [
                'Ensure Railway has VAULT_ADDRESS_EVM, RELAY_INTERMEDIARY_EVM, RELAY_INTERMEDIARY_PRIVATE_KEY',
                'RPC on Railway must reach Sepolia when chain_id=11155111',
                'Test wallet must sign tx to RELAY_INTERMEDIARY_EVM with exact amount field',
              ]
            : status === 'SETTLED' && !secondLegTxHash && relayPath === 'two_hop_intermediary'
              ? ['Second leg broadcasts 30–90s after first leg; re-scan explorer if needed']
              : [],
      },
      null,
      2,
    ),
  )

  if (status !== 'SETTLED') process.exitCode = 1
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
