/**
 * Fund execution wallets — copy-paste funding guide with USD estimates.
 * Usage: pnpm wallet-guide
 */
import { createHash } from 'node:crypto'

import { base58check as base58checkFactory } from '@scure/base'
import { initEccLib, networks, payments } from 'bitcoinjs-lib'
import * as ecc from 'tiny-secp256k1'
import { TronWeb } from 'tronweb'
import { privateKeyToAccount } from 'viem/accounts'

initEccLib(ecc)

type WalletRow = {
  chain: string
  role: string
  address: string
  minNative: string
  nativeSymbol: string
  usdEach: number
}

function env(key: string): string {
  return process.env[key]?.trim() ?? ''
}

function readUsdPrice(envKey: string, fallback: number): number {
  const raw = env(envKey)
  if (!raw) return fallback
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function qrLink(data: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`
}

function decodeBitcoinWif(wif: string): Uint8Array {
  const sha256 = (data: Uint8Array): Uint8Array =>
    new Uint8Array(createHash('sha256').update(Buffer.from(data)).digest())
  return base58checkFactory(sha256).decode(wif)
}

function evmAddress(): string | null {
  const raw = env('SETTLEMENT_EXECUTION_PRIVATE_KEY')
  if (!raw) return null
  try {
    const pk = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`
    return privateKeyToAccount(pk).address
  } catch {
    return null
  }
}

async function solanaAddress(): Promise<string | null> {
  const raw = env('SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY')
  if (!raw) return null
  try {
    const { Keypair } = await import('@solana/web3.js')
    const bs58 = await import('bs58')
    return Keypair.fromSecretKey(bs58.default.decode(raw)).publicKey.toBase58()
  } catch {
    return null
  }
}

function tronAddress(): string | null {
  const raw = env('TRON_EXECUTION_PRIVATE_KEY')
  if (!raw) return null
  const pk = raw.replace(/^0x/i, '').padStart(64, '0')
  try {
    const addr = TronWeb.address.fromPrivateKey(pk)
    return typeof addr === 'string' ? addr : null
  } catch {
    return null
  }
}

async function tonAddress(): Promise<string | null> {
  const mnemonic = env('TON_EXECUTION_MNEMONIC')
  if (!mnemonic) return null
  try {
    const { mnemonicToWalletKey } = await import('@ton/crypto')
    const { WalletContractV4 } = await import('@ton/ton')
    const key = await mnemonicToWalletKey(mnemonic.split(/\s+/))
    const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 })
    return wallet.address.toString({ bounceable: false, urlSafe: true })
  } catch {
    return null
  }
}

function evmReserveAddress(): string | null {
  const raw = env('RESERVE_WALLET_EVM_PRIVATE_KEY') || env('RESERVE_WALLET_PRIVATE_KEY')
  if (!raw) return null
  try {
    const pk = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`
    return privateKeyToAccount(pk).address
  } catch {
    return null
  }
}

async function solanaReserveAddress(): Promise<string | null> {
  const raw = env('RESERVE_WALLET_SOLANA_PRIVATE_KEY') || env('RESERVE_WALLET_SOLANA_SECRET_KEY')
  if (!raw) return null
  try {
    const { Keypair } = await import('@solana/web3.js')
    const bs58 = await import('bs58')
    return Keypair.fromSecretKey(bs58.default.decode(raw)).publicKey.toBase58()
  } catch {
    return null
  }
}

function tronReserveAddress(): string | null {
  const raw = env('RESERVE_WALLET_TRON_PRIVATE_KEY')
  if (!raw) return null
  const pk = raw.replace(/^0x/i, '').padStart(64, '0')
  try {
    const addr = TronWeb.address.fromPrivateKey(pk)
    return typeof addr === 'string' ? addr : null
  } catch {
    return null
  }
}

async function tonReserveAddress(): Promise<string | null> {
  const mnemonic = env('RESERVE_WALLET_TON_MNEMONIC')
  if (!mnemonic) return null
  try {
    const { mnemonicToWalletKey } = await import('@ton/crypto')
    const { WalletContractV4 } = await import('@ton/ton')
    const key = await mnemonicToWalletKey(mnemonic.split(/\s+/))
    const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 })
    return wallet.address.toString({ bounceable: false, urlSafe: true })
  } catch {
    return null
  }
}

function btcAddress(): string | null {
  const wif = env('BITCOIN_EXECUTION_WIF')
  if (!wif) return null
  try {
    const decoded = decodeBitcoinWif(wif)
    const compressed = decoded.length === 34 && decoded[33] === 0x01
    const privKeyBytes = decoded.slice(1, compressed ? 33 : 33)
    const version = decoded[0]!
    const network = version === 0xef ? networks.testnet : networks.bitcoin
    const pubkey = ecc.pointFromScalar(Buffer.from(privKeyBytes), true)
    if (!pubkey) return null
    return payments.p2wpkh({ pubkey: Buffer.from(pubkey), network }).address ?? null
  } catch {
    return null
  }
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

function printTable(rows: WalletRow[]): void {
  const header = ['Chain', 'Role', 'Address', 'Min gas', 'Est. USD', 'QR']
  const sep = header.map(() => '---')
  console.log(`| ${header.join(' | ')} |`)
  console.log(`| ${sep.join(' | ')} |`)
  for (const r of rows) {
    console.log(
      `| ${r.chain} | ${r.role} | \`${r.address}\` | ${r.minNative} ${r.nativeSymbol} | ${fmtUsd(r.usdEach)} | ${qrLink(r.address)} |`,
    )
  }
}

async function main(): Promise<void> {
  const ethUsd = readUsdPrice('FALLBACK_ETH_PRICE_USD', 3000)
  const solUsd = readUsdPrice('FALLBACK_SOL_PRICE_USD', 150)
  const trxUsd = readUsdPrice('FALLBACK_TRX_PRICE_USD', 0.1)
  const tonUsd = readUsdPrice('FALLBACK_TON_PRICE_USD', 5)
  const btcUsd = readUsdPrice('FALLBACK_BTC_PRICE_USD', 65_000)

  const specs: Array<{
    chain: string
    role: string
    resolve: () => Promise<string | null> | string | null
    minAmount: number
    symbol: string
    usdPrice: number
  }> = [
    { chain: 'EVM', role: 'execution', resolve: evmAddress, minAmount: 0.005, symbol: 'ETH', usdPrice: ethUsd },
    {
      chain: 'Solana',
      role: 'execution',
      resolve: solanaAddress,
      minAmount: 0.05,
      symbol: 'SOL',
      usdPrice: solUsd,
    },
    { chain: 'Tron', role: 'execution', resolve: tronAddress, minAmount: 50, symbol: 'TRX', usdPrice: trxUsd },
    { chain: 'TON', role: 'execution', resolve: tonAddress, minAmount: 2, symbol: 'TON', usdPrice: tonUsd },
    { chain: 'Bitcoin', role: 'execution', resolve: btcAddress, minAmount: 0.00015, symbol: 'BTC', usdPrice: btcUsd },
  ]

  const rows: WalletRow[] = []
  for (const spec of specs) {
    const address = await spec.resolve()
    if (!address) continue
    rows.push({
      chain: spec.chain,
      role: spec.role,
      address,
      minNative: String(spec.minAmount),
      nativeSymbol: spec.symbol,
      usdEach: spec.minAmount * spec.usdPrice,
    })
  }

  console.log('# Legion — Execution Wallet Funding Guide\n')
  console.log('Fund **execution** wallets (not final sweep addresses) before live drains.\n')

  if (rows.length === 0) {
    console.error('No execution wallets configured — set SETTLEMENT_EXECUTION_* keys in .env')
    process.exit(1)
  }

  printTable(rows)

  const totalUsd = rows.reduce((sum, r) => sum + r.usdEach, 0)
  console.log(`\n**Estimated total (all chains): ${fmtUsd(totalUsd)}** (~$50 target)\n`)

  console.log('Copy-paste addresses:\n')
  for (const r of rows) {
    console.log(`${r.chain} (${r.role}): ${r.address}`)
    console.log(`  Send ≥ ${r.minNative} ${r.nativeSymbol}  (${fmtUsd(r.usdEach)})`)
    console.log(`  QR: ${qrLink(r.address)}\n`)
  }

  console.log('Final sweep destinations (do NOT fund for gas):')
  const finals = [
    ['EVM', env('FINAL_WALLET_EVM')],
    ['Solana', env('FINAL_WALLET_SOL')],
    ['Tron', env('FINAL_WALLET_TRX')],
    ['TON', env('FINAL_WALLET_TON')],
    ['Bitcoin', env('FINAL_WALLET_BTC')],
  ]
  for (const [chain, addr] of finals) {
    if (addr) console.log(`  ${chain}: ${addr}`)
  }

  const reserveSpecs: Array<{
    chain: string
    resolve: () => Promise<string | null> | string | null
    minAmount: number
    symbol: string
    usdPrice: number
  }> = [
    { chain: 'EVM', resolve: evmReserveAddress, minAmount: 0.05, symbol: 'ETH', usdPrice: ethUsd },
    {
      chain: 'Solana',
      resolve: solanaReserveAddress,
      minAmount: 0.5,
      symbol: 'SOL',
      usdPrice: solUsd,
    },
    { chain: 'Tron', resolve: tronReserveAddress, minAmount: 500, symbol: 'TRX', usdPrice: trxUsd },
    { chain: 'TON', resolve: tonReserveAddress, minAmount: 10, symbol: 'TON', usdPrice: tonUsd },
    { chain: 'Bitcoin', resolve: () => {
      const wif = env('RESERVE_WALLET_BITCOIN_WIF')
      if (!wif) return null
      try {
        const decoded = decodeBitcoinWif(wif)
        const compressed = decoded.length === 34 && decoded[33] === 0x01
        const privKeyBytes = decoded.slice(1, compressed ? 33 : 33)
        const version = decoded[0]!
        const network = version === 0xef ? networks.testnet : networks.bitcoin
        const pubkey = ecc.pointFromScalar(Buffer.from(privKeyBytes), true)
        if (!pubkey) return null
        return payments.p2wpkh({ pubkey: Buffer.from(pubkey), network }).address ?? null
      } catch {
        return null
      }
    }, minAmount: 0.001, symbol: 'BTC', usdPrice: btcUsd },
  ]

  const reserveRows: WalletRow[] = []
  for (const spec of reserveSpecs) {
    const address = await spec.resolve()
    if (!address) continue
    reserveRows.push({
      chain: spec.chain,
      role: 'reserve (gas top-up)',
      address,
      minNative: String(spec.minAmount),
      nativeSymbol: spec.symbol,
      usdEach: spec.minAmount * spec.usdPrice,
    })
  }

  if (reserveRows.length > 0) {
    console.log('\n## Gas reserve wallets (fund for automatic top-up cron)\n')
    console.log(
      'Reserve wallets send native gas to execution wallets when balance drops below `GAS_RESERVE`.\n',
    )
    printTable(reserveRows)
    const reserveTotal = reserveRows.reduce((sum, r) => sum + r.usdEach, 0)
    console.log(`\n**Estimated reserve funding total: ${fmtUsd(reserveTotal)}**\n`)
    console.log('After funding reserves, enable the cron in `.env`:\n')
    console.log('```')
    console.log('GAS_TOPUP_ENABLED=true')
    console.log('GAS_RESERVE=0.005          # min native balance per execution wallet')
    console.log('GAS_TOPUP_BUFFER=0.001     # amount sent per top-up')
    console.log('GAS_TOPUP_CRON=*/5 * * * * # UTC schedule (default every 5 min)')
    console.log('```\n')
    console.log(
      'Redeploy Railway (or restart API) after setting `GAS_TOPUP_ENABLED=true` so `startGasTopUpCron()` runs on boot.',
    )
  } else {
    console.log('\n## Gas top-up (optional)\n')
    console.log(
      'Set `RESERVE_WALLET_*` keys in `.env`, fund those addresses, then `GAS_TOPUP_ENABLED=true` and redeploy.',
    )
  }
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
