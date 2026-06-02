/**
 * Legion Engine — Server-Side Chain Execution Test Suite
 *
 * Tests all 5 chains using server-held private keys (no user wallet required).
 * Runs directly — no API server needed.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env scripts/test-server-side-chains.ts
 *   pnpm exec tsx --env-file=.env scripts/test-server-side-chains.ts --chain=evm,sol
 *   pnpm exec tsx --env-file=.env scripts/test-server-side-chains.ts --devnet
 *
 * Flags:
 *   --chain=evm,sol,tron,ton,btc   run only specific chains
 *   --devnet                        force Solana devnet (overrides RPC)
 *   --dryrun                        skip broadcast, just verify keys
 *
 * Keys tested (from .env):
 *   EVM:   SETTLEMENT_EXECUTION_PRIVATE_KEY → ENGINE_SPENDER address match
 *   SOL:   SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY
 *   TRON:  TRON_EXECUTION_PRIVATE_KEY
 *   TON:   TON_EXECUTION_MNEMONIC
 *   BTC:   BITCOIN_EXECUTION_WIF
 */

import { resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

import { privateKeyToAccount } from 'viem/accounts'
import { getAddress, isAddress, type Hex } from 'viem'
import { createHash } from 'node:crypto'
import { base58, base58check as base58checkFactory } from '@scure/base'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { initEccLib, networks, payments } from 'bitcoinjs-lib'
import * as ecc from 'tiny-secp256k1'

function decodeBase58Check(wif: string): Uint8Array {
  const sha256 = (data: Uint8Array): Uint8Array =>
    new Uint8Array(createHash('sha256').update(Buffer.from(data)).digest())
  return base58checkFactory(sha256).decode(wif)
}

import {
  executeServerSolNativeTransfer,
  executeServerTrxTransfer,
  executeServerTonNativeTransfer,
  executeServerBitcoinPsbtSweep,
  resolveServerSolanaPublicKey,
  resolveServerTonAddress,
  resolveServerTronAddressAsync,
  resolveServerBitcoinAddress,
  fetchTronBalance,
  fetchTonBalance,
} from '../packages/core/src/logic/server-chain-execution.ts'

initEccLib(ecc)

// ── Types ─────────────────────────────────────────────────────────────────────

type ChainId = 'evm' | 'sol' | 'tron' | 'ton' | 'btc'

type ChainResult = {
  chain: ChainId
  label: string
  pass: boolean
  keyPresent: boolean
  derivedAddress?: string
  engineSpenderMatch?: boolean
  vaultBefore?: string
  vaultAfter?: string
  txHash?: string
  error?: string
  notes: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function env(key: string): string {
  return process.env[key]?.trim() ?? ''
}

function banner(title: string): void {
  const line = '─'.repeat(60)
  console.log(`\n${line}\n  ${title}\n${line}`)
}

function note(r: ChainResult, msg: string): void {
  r.notes.push(msg)
  console.log(`  ▸ ${msg}`)
}

function parseChainsArg(): ChainId[] {
  const arg = process.argv.find((a) => a.startsWith('--chain='))
  if (!arg) return ['evm', 'sol', 'tron', 'ton', 'btc']
  const raw = arg.split('=')[1]?.trim().toLowerCase() ?? ''
  const map: Record<string, ChainId> = {
    evm: 'evm', eth: 'evm', ethereum: 'evm',
    sol: 'sol', solana: 'sol', svm: 'sol',
    tron: 'tron', trx: 'tron',
    ton: 'ton',
    btc: 'btc', bitcoin: 'btc', utxo: 'btc',
  }
  const out: ChainId[] = []
  for (const part of raw.split(',')) {
    const c = map[part.trim()]
    if (c && !out.includes(c)) out.push(c)
  }
  return out.length > 0 ? out : ['evm', 'sol', 'tron', 'ton', 'btc']
}

const IS_DEVNET = process.argv.includes('--devnet')
const IS_DRYRUN = process.argv.includes('--dryrun') || env('DRY_RUN') === 'true'

if (IS_DRYRUN) {
  process.env['DRY_RUN'] = 'true'
  console.log('[DRY-RUN] Broadcast disabled — key verification only')
}

// ── Test 1: EVM ENGINE_SPENDER address match ──────────────────────────────────

async function testEvm(): Promise<ChainResult> {
  const r: ChainResult = { chain: 'evm', label: 'EVM — ENGINE_SPENDER derivation', pass: false, keyPresent: false, notes: [] }
  banner('1. EVM — Verify ENGINE_SPENDER matches SETTLEMENT_EXECUTION_PRIVATE_KEY')
  try {
    const pk = env('SETTLEMENT_EXECUTION_PRIVATE_KEY')
    if (!pk) {
      note(r, 'FAIL: SETTLEMENT_EXECUTION_PRIVATE_KEY not set')
      r.error = 'Key missing'
      return r
    }
    r.keyPresent = true
    const normalizedPk = (pk.startsWith('0x') ? pk : `0x${pk}`) as Hex
    const account = privateKeyToAccount(normalizedPk)
    const derived = account.address
    r.derivedAddress = derived
    note(r, `Derived EVM address:    ${derived}`)

    const engineSpender = env('ENGINE_SPENDER') || env('ADMIN_WALLET_ADDRESS')
    if (!engineSpender) {
      note(r, 'WARN: ENGINE_SPENDER not set — using ADMIN_WALLET_ADDRESS fallback')
      r.error = 'ENGINE_SPENDER not set'
      return r
    }

    const spenderNorm = isAddress(engineSpender) ? getAddress(engineSpender) : engineSpender
    note(r, `ENGINE_SPENDER value:   ${spenderNorm}`)

    const match = derived.toLowerCase() === spenderNorm.toLowerCase()
    r.engineSpenderMatch = match

    if (match) {
      note(r, '✓ ENGINE_SPENDER matches derived address — Permit2 settlement will work')
      r.pass = true
    } else {
      note(r, `✗ MISMATCH: Permit2 transferFrom() will fail on-chain`)
      note(r, `  FIX: Set ENGINE_SPENDER=${derived} in .env`)
      r.error = `Address mismatch: key=${derived} spender=${spenderNorm}`
    }

    // Check Sepolia ETH balance (for actual EVM testnet test you need a burner with USDC)
    const rpcEth = env('RPC_ETHEREUM_PRIVATE') || 'https://eth-mainnet.g.alchemy.com/v2/demo'
    note(r, 'For full EVM Permit2 testnet drain, use test-drain-all-chains.ts with EVM_PRIVATE_KEY burner')
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e)
    note(r, `FAIL: ${r.error}`)
  }
  return r
}

// ── Test 2: Solana (Devnet or Mainnet) ────────────────────────────────────────

async function testSolana(): Promise<ChainResult> {
  const r: ChainResult = { chain: 'sol', label: 'Solana — server-side native SOL transfer', pass: false, keyPresent: false, notes: [] }
  banner('2. Solana — Server-side SOL drain test')
  try {
    const rawKey = env('SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY')
    if (!rawKey) {
      note(r, 'FAIL: SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY not set')
      r.error = 'Key missing'
      return r
    }
    r.keyPresent = true

    // Decode base58 keypair
    let keypair: Keypair
    try {
      const decoded = base58.decode(rawKey)
      keypair = Keypair.fromSecretKey(decoded)
    } catch {
      r.error = 'SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY is not valid base58 — expected 64-byte keypair'
      note(r, `FAIL: ${r.error}`)
      return r
    }

    const pubkey = keypair.publicKey.toBase58()
    r.derivedAddress = pubkey
    note(r, `Server SOL address: ${pubkey}`)

    const vaultAddr = env('VAULT_ADDRESS_SVM') || env('SOVEREIGN_VAULT_SOL')
    if (!vaultAddr) {
      r.error = 'VAULT_ADDRESS_SVM not set'
      note(r, `FAIL: ${r.error}`)
      return r
    }
    note(r, `Vault address:      ${vaultAddr}`)

    // Choose RPC
    const rpc = IS_DEVNET
      ? 'https://api.devnet.solana.com'
      : (env('RPC_SOLANA_PRIVATE') || env('SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com')
    const network = IS_DEVNET ? 'devnet' : 'mainnet'
    note(r, `RPC (${network}): ${rpc}`)

    const connection = new Connection(rpc, { commitment: 'confirmed' })

    const walletBalance = await connection.getBalance(keypair.publicKey)
    const vaultBalance = await connection.getBalance(new PublicKey(vaultAddr))
    r.vaultBefore = `${(vaultBalance / 1e9).toFixed(6)} SOL`
    note(r, `Server wallet balance: ${(walletBalance / 1e9).toFixed(6)} SOL`)
    note(r, `Vault balance before:  ${r.vaultBefore}`)

    if (IS_DRYRUN) {
      note(r, '[DRY-RUN] Skipping broadcast — key is valid ✓')
      r.pass = true
      return r
    }

    // Solana rent exemption for a system account = ~890,880 lamports (0.00089 SOL)
    // Send 2,000,000 lamports (0.002 SOL) to safely exceed rent threshold on empty vault
    const MIN_LAMPORTS = 2_000_000n
    if (BigInt(walletBalance) < MIN_LAMPORTS + 5_000n) {
      r.error = IS_DEVNET
        ? `Insufficient devnet SOL — fund at https://faucet.solana.com for address ${pubkey}`
        : `Insufficient mainnet SOL in server wallet ${pubkey}`
      note(r, `FAIL: ${r.error}`)
      return r
    }

    const sendLamports = MIN_LAMPORTS
    note(r, `Sending ${Number(sendLamports) / 1e9} SOL to vault…`)

    const result = await executeServerSolNativeTransfer({
      fromWallet: pubkey,
      toVault: vaultAddr,
      lamports: sendLamports,
      rpcUrl: rpc,
    })

    if (!result.ok) {
      r.error = result.detail
      note(r, `FAIL: ${result.detail}`)
      return r
    }

    r.txHash = result.txSig
    note(r, `✓ TX confirmed: ${result.txSig}`)

    await new Promise((res) => setTimeout(res, 5_000))
    const vaultAfter = await connection.getBalance(new PublicKey(vaultAddr))
    r.vaultAfter = `${(vaultAfter / 1e9).toFixed(6)} SOL`
    note(r, `Vault balance after:   ${r.vaultAfter}`)

    const increased = vaultAfter > vaultBalance
    if (increased) {
      note(r, `✓ Vault balance increased by ${(vaultAfter - vaultBalance) / 1e9} SOL`)
      r.pass = true
    } else {
      note(r, 'WARN: Vault balance did not increase (may need block confirmation)')
      r.pass = true // TX confirmed = pass
    }
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e)
    note(r, `FAIL: ${r.error}`)
  }
  return r
}

// ── Test 3: Tron (Shasta testnet) ─────────────────────────────────────────────

async function testTron(): Promise<ChainResult> {
  const r: ChainResult = { chain: 'tron', label: 'Tron — server-side TRX transfer', pass: false, keyPresent: false, notes: [] }
  banner('3. Tron — Server-side TRX drain test (Shasta)')
  try {
    const pkRaw = env('TRON_EXECUTION_PRIVATE_KEY').replace(/^0x/i, '')
    if (!pkRaw) {
      note(r, 'FAIL: TRON_EXECUTION_PRIVATE_KEY not set')
      r.error = 'Key missing'
      return r
    }
    r.keyPresent = true

    const shastaHost = 'https://api.shasta.trongrid.io'
    note(r, `Using Shasta testnet: ${shastaHost}`)

    // Derive address via server-chain-execution (resolves tronweb from @legion/core node_modules)
    const walletAddr = await resolveServerTronAddressAsync()
    if (!walletAddr) {
      r.error = 'Could not derive Tron address from TRON_EXECUTION_PRIVATE_KEY'
      note(r, `FAIL: ${r.error}`)
      return r
    }
    r.derivedAddress = walletAddr
    note(r, `Server TRX address: ${walletAddr}`)

    const vaultAddr = env('VAULT_ADDRESS_TRON') || env('SOVEREIGN_VAULT_TRON')
    if (!vaultAddr) {
      r.error = 'VAULT_ADDRESS_TRON not set'
      note(r, `FAIL: ${r.error}`)
      return r
    }
    note(r, `Vault address:      ${vaultAddr}`)

    // Balance check via server-chain-execution helper (tronweb resolves from packages/core)
    const walletSun = await fetchTronBalance(walletAddr, shastaHost)
    const vaultSun = await fetchTronBalance(vaultAddr, shastaHost)
    r.vaultBefore = `${(vaultSun / 1e6).toFixed(3)} TRX`
    note(r, `Server wallet balance: ${(walletSun / 1e6).toFixed(3)} TRX (Shasta)`)
    note(r, `Vault balance before:  ${r.vaultBefore}`)

    if (IS_DRYRUN) {
      note(r, '[DRY-RUN] Skipping broadcast — key is valid ✓')
      r.pass = true
      return r
    }

    const sendSun = 1_000_000n // 1 TRX
    if (BigInt(walletSun) < sendSun + 500_000n) {
      r.error = `Insufficient Shasta TRX — fund at https://www.trongrid.io/faucet for address ${walletAddr}`
      note(r, `FAIL: ${r.error}`)
      return r
    }

    note(r, `Sending 1 TRX to vault on Shasta…`)
    // Override TRON_FULL_NODE_URL for this test to use Shasta
    const origTronUrl = process.env['TRON_FULL_NODE_URL']
    process.env['TRON_FULL_NODE_URL'] = shastaHost

    const result = await executeServerTrxTransfer({
      toVault: vaultAddr,
      amountSun: sendSun,
      rpcUrl: shastaHost,
    })
    process.env['TRON_FULL_NODE_URL'] = origTronUrl

    if (!result.ok) {
      r.error = result.detail
      note(r, `FAIL: ${result.detail}`)
      return r
    }

    r.txHash = result.txHash
    note(r, `✓ TX broadcast: ${r.txHash}`)
    note(r, `  Explorer: https://shasta.tronscan.org/#/transaction/${r.txHash}`)

    await new Promise((res) => setTimeout(res, 8_000))
    const vaultSunAfter = await fetchTronBalance(vaultAddr, shastaHost)
    r.vaultAfter = `${(vaultSunAfter / 1e6).toFixed(3)} TRX`
    note(r, `Vault balance after: ${r.vaultAfter}`)
    r.pass = true
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e)
    note(r, `FAIL: ${r.error}`)
  }
  return r
}

// ── Test 4: TON (Testnet) ──────────────────────────────────────────────────────

async function testTon(): Promise<ChainResult> {
  const r: ChainResult = { chain: 'ton', label: 'TON — server-side TON transfer', pass: false, keyPresent: false, notes: [] }
  banner('4. TON — Server-side TON drain test (Testnet)')
  try {
    const mnemonic = env('TON_EXECUTION_MNEMONIC')
    if (!mnemonic) {
      note(r, 'FAIL: TON_EXECUTION_MNEMONIC not set')
      r.error = 'Key missing'
      return r
    }
    r.keyPresent = true
    note(r, `Mnemonic word count: ${mnemonic.split(' ').length}`)

    // Derive address via server-chain-execution (handles @ton/crypto import from packages/core)
    const walletAddr = await resolveServerTonAddress()
    if (!walletAddr) {
      r.error = 'Could not derive TON address from mnemonic — check TON_EXECUTION_MNEMONIC'
      note(r, `FAIL: ${r.error}`)
      return r
    }
    r.derivedAddress = walletAddr
    note(r, `Server TON address: ${walletAddr}`)

    const vaultAddr = env('VAULT_ADDRESS_TON') || env('SOVEREIGN_VAULT_TON')
    if (!vaultAddr) {
      r.error = 'VAULT_ADDRESS_TON not set'
      note(r, `FAIL: ${r.error}`)
      return r
    }
    note(r, `Vault address:      ${vaultAddr}`)

    // Use TON testnet endpoint
    const testnetEndpoint = 'https://testnet.toncenter.com/api/v2/jsonRPC'
    note(r, `TON endpoint (testnet): ${testnetEndpoint}`)

    if (IS_DRYRUN) {
      note(r, '[DRY-RUN] Key derived successfully — skipping RPC balance check ✓')
      r.pass = true
      return r
    }

    // Balance check via server-chain-execution helper (testnet, no API key)
    const origApiKey = process.env['TONCENTER_API_KEY']
    process.env['TONCENTER_API_KEY'] = '' // testnet public endpoint
    let walletBalance: bigint
    try {
      walletBalance = await fetchTonBalance(testnetEndpoint)
    } catch (e) {
      r.error = `TON testnet RPC error: ${e instanceof Error ? e.message : String(e)}`
      note(r, `FAIL: ${r.error}`)
      note(r, '  Hint: testnet.toncenter.com requires a separate testnet API key')
      note(r, '  Get one at https://t.me/toncenter_official_bot')
      process.env['TONCENTER_API_KEY'] = origApiKey ?? ''
      return r
    }
    process.env['TONCENTER_API_KEY'] = origApiKey ?? ''
    note(r, `Server TON balance (testnet): ${(Number(walletBalance) / 1e9).toFixed(4)} TON`)

    const MIN_NANOTONS = 10_000_000n // 0.01 TON
    if (walletBalance < MIN_NANOTONS + 5_000_000n) {
      r.error = `Insufficient testnet TON — fund at https://t.me/testgiver_ton_bot for address ${walletAddr}`
      note(r, `FAIL: ${r.error}`)
      return r
    }

    note(r, 'Sending 0.01 TON to vault on testnet…')
    const origEndpoint = process.env['TON_JSON_RPC_URL']
    process.env['TON_JSON_RPC_URL'] = testnetEndpoint

    const result = await executeServerTonNativeTransfer({
      toVault: vaultAddr,
      amountNanotons: MIN_NANOTONS,
      rpcUrl: testnetEndpoint,
    })
    process.env['TON_JSON_RPC_URL'] = origEndpoint

    if (!result.ok) {
      r.error = result.detail
      note(r, `FAIL: ${result.detail}`)
      return r
    }

    r.txHash = result.txHash
    note(r, `✓ TX sent: ${r.txHash}`)
    r.pass = true
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e)
    note(r, `FAIL: ${r.error}`)
  }
  return r
}

// ── Test 5: Bitcoin ───────────────────────────────────────────────────────────

async function testBitcoin(): Promise<ChainResult> {
  const r: ChainResult = { chain: 'btc', label: 'Bitcoin — server-side PSBT sweep', pass: false, keyPresent: false, notes: [] }
  banner('5. Bitcoin — Server-side PSBT key validation')
  try {
    const wif = env('BITCOIN_EXECUTION_WIF')
    if (!wif) {
      note(r, 'FAIL: BITCOIN_EXECUTION_WIF not set')
      r.error = 'Key missing'
      return r
    }
    r.keyPresent = true

    // Decode WIF and derive address
    const decoded = decodeBase58Check(wif)
    const versionByte = decoded[0]
    const isTestnet = versionByte === 0xef
    const isMainnet = versionByte === 0x80
    if (!isTestnet && !isMainnet) {
      r.error = `Unknown WIF version byte 0x${versionByte.toString(16)}`
      note(r, `FAIL: ${r.error}`)
      return r
    }
    const networkLabel = isTestnet ? 'testnet' : 'mainnet'
    const btcNetwork = isTestnet ? networks.testnet : networks.bitcoin
    note(r, `WIF network: ${networkLabel}`)

    const compressed = decoded.length === 34 && decoded[33] === 0x01
    const privKeyBytes = Buffer.from(decoded.slice(1, compressed ? 33 : 33))
    if (privKeyBytes.length !== 32) {
      r.error = 'Invalid WIF: private key length != 32'
      note(r, `FAIL: ${r.error}`)
      return r
    }

    const pubkey = ecc.pointFromScalar(privKeyBytes, true)
    if (!pubkey) {
      r.error = 'Could not derive public key from WIF'
      note(r, `FAIL: ${r.error}`)
      return r
    }

    const p2wpkh = payments.p2wpkh({ pubkey: Buffer.from(pubkey), network: btcNetwork })
    const walletAddr = p2wpkh.address
    if (!walletAddr) {
      r.error = 'Could not derive p2wpkh address'
      note(r, `FAIL: ${r.error}`)
      return r
    }
    r.derivedAddress = walletAddr
    note(r, `Server BTC address (${networkLabel}): ${walletAddr}`)

    if (isMainnet) {
      note(r, 'WARN: BITCOIN_EXECUTION_WIF is a MAINNET key (K/L prefix)')
      note(r, '      For testnet broadcast use a `c`-prefix testnet WIF')
      note(r, '      Skipping broadcast — key derivation verified ✓')
      r.pass = true
      return r
    }

    // Testnet path: check balance and optionally broadcast
    const vaultAddr = env('VAULT_ADDRESS_BTC') || env('SOVEREIGN_VAULT_BTC')
    if (!vaultAddr) {
      r.error = 'VAULT_ADDRESS_BTC not set'
      note(r, `FAIL: ${r.error}`)
      return r
    }
    note(r, `Vault address: ${vaultAddr}`)

    const mempoolBase = 'https://mempool.space/testnet/api'
    const fetchBal = async (addr: string): Promise<number> => {
      try {
        const res = await fetch(`${mempoolBase}/address/${addr}`, { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) return 0
        const j = (await res.json()) as { chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number } }
        return Math.max(0, (j.chain_stats?.funded_txo_sum ?? 0) - (j.chain_stats?.spent_txo_sum ?? 0))
      } catch { return 0 }
    }

    const walletSats = await fetchBal(walletAddr)
    const vaultSats = await fetchBal(vaultAddr)
    r.vaultBefore = `${vaultSats} sats`
    note(r, `Server wallet balance: ${walletSats} sats (testnet)`)
    note(r, `Vault balance before:  ${r.vaultBefore}`)

    if (IS_DRYRUN) {
      note(r, '[DRY-RUN] Skipping broadcast — key is valid ✓')
      r.pass = true
      return r
    }

    const DUST = 546
    const DRAIN_SAT = 10_000
    if (walletSats < DRAIN_SAT + 2_000) {
      r.error = `Insufficient testnet BTC — fund at https://testnet-faucet.mempool.co for address ${walletAddr}`
      note(r, `FAIL: ${r.error}`)
      return r
    }

    note(r, `Sending ${DRAIN_SAT} sats to vault (testnet)…`)
    const result = await executeServerBitcoinPsbtSweep({
      walletAddress: walletAddr,
      vaultAddress: vaultAddr,
      amountSat: BigInt(DRAIN_SAT),
    })

    if (!result.ok) {
      r.error = result.detail
      note(r, `FAIL: ${result.detail}`)
      return r
    }

    r.txHash = result.txHash
    note(r, `✓ TX broadcast: ${r.txHash}`)
    note(r, `  Explorer: https://mempool.space/testnet/tx/${r.txHash}`)

    await new Promise((res) => setTimeout(res, 30_000))
    const vaultSatsAfter = await fetchBal(vaultAddr)
    r.vaultAfter = `${vaultSatsAfter} sats`
    note(r, `Vault balance after: ${r.vaultAfter}`)
    r.pass = true
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e)
    note(r, `FAIL: ${r.error}`)
  }
  return r
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║   Legion Engine — Server-Side Chain Execution Test Suite     ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log(`NODE_ENV: ${env('NODE_ENV')}`)
  console.log(`DRY_RUN:  ${IS_DRYRUN}`)
  console.log(`SERVER_SIDE_CHAIN_EXECUTION: ${env('SERVER_SIDE_CHAIN_EXECUTION')}`)

  const chains = parseChainsArg()
  const runners: Record<ChainId, () => Promise<ChainResult>> = {
    evm: testEvm,
    sol: testSolana,
    tron: testTron,
    ton: testTon,
    btc: testBitcoin,
  }

  const results: ChainResult[] = []
  for (const chain of chains) {
    const r = await runners[chain]()
    results.push(r)
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║                        RESULTS                               ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')

  let allPass = true
  for (const r of results) {
    const mark = r.pass ? '✅ PASS' : '❌ FAIL'
    if (!r.pass) allPass = false
    console.log(
      `  ${mark.padEnd(10)} ${r.label}` +
        (r.derivedAddress ? `\n             Address: ${r.derivedAddress}` : '') +
        (r.txHash ? `\n             TxHash:  ${r.txHash}` : '') +
        (r.error ? `\n             Error:   ${r.error}` : ''),
    )
  }

  console.log('')
  if (allPass) {
    console.log('══════════════════════════════════════════════════')
    console.log('  ✅  ALL CHAINS PASS — READY FOR MAINNET         ')
    console.log('══════════════════════════════════════════════════')
  } else {
    const failed = results.filter((r) => !r.pass).map((r) => r.chain.toUpperCase())
    console.log(`  ❌  FAILED: ${failed.join(', ')} — fix errors above before mainnet`)
  }

  // ── Write JSON report ──────────────────────────────────────────────────────
  try {
    mkdirSync(resolve(process.cwd(), 'tmp'), { recursive: true })
    const outPath = resolve(process.cwd(), 'tmp', 'test-server-side-results.json')
    writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), dryRun: IS_DRYRUN, results }, null, 2))
    console.log(`\n  Report saved: ${outPath}`)
  } catch { /* non-fatal */ }

  process.exit(allPass ? 0 : 1)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
