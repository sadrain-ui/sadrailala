/**
 * Print execution + vault + final wallet addresses from .env (no private keys).
 * Usage: pnpm print-wallets
 */
import { createHash } from 'node:crypto'

import { base58check as base58checkFactory } from '@scure/base'
import { initEccLib, networks, payments } from 'bitcoinjs-lib'
import * as ecc from 'tiny-secp256k1'
import { TronWeb } from 'tronweb'
import { privateKeyToAccount } from 'viem/accounts'

initEccLib(ecc)

function env(key: string): string {
  return process.env[key]?.trim() ?? ''
}

function line(label: string, value: string | null | undefined): void {
  console.log(`${label.padEnd(22)} ${value?.trim() || '(not configured)'}`)
}

type DeriveResult = { ok: true; address: string } | { ok: false; detail: string }

function decodeBitcoinWif(wif: string): Uint8Array {
  const sha256 = (data: Uint8Array): Uint8Array =>
    new Uint8Array(createHash('sha256').update(Buffer.from(data)).digest())
  return base58checkFactory(sha256).decode(wif)
}

function evmFromKey(keyEnv: string): DeriveResult | null {
  const raw = env(keyEnv)
  if (!raw) return null
  try {
    const pk = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`
    return { ok: true, address: privateKeyToAccount(pk).address }
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'invalid SETTLEMENT_EXECUTION_PRIVATE_KEY',
    }
  }
}

async function solanaFromSecretAsync(): Promise<DeriveResult | null> {
  const raw = env('SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY')
  if (!raw) return null
  try {
    const { Keypair } = await import('@solana/web3.js')
    const bs58 = await import('bs58')
    const bytes = bs58.default.decode(raw)
    return { ok: true, address: Keypair.fromSecretKey(bytes).publicKey.toBase58() }
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'invalid SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY',
    }
  }
}

function tronFromKey(): DeriveResult | null {
  const raw = env('TRON_EXECUTION_PRIVATE_KEY')
  if (!raw) return null

  const pk = raw.replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{63,64}$/.test(pk)) {
    return { ok: false, detail: 'TRON_EXECUTION_PRIVATE_KEY must be 64 hex chars (optional 0x prefix)' }
  }

  try {
    const addr = TronWeb.address.fromPrivateKey(pk.padStart(64, '0'))
    if (typeof addr !== 'string' || !addr.startsWith('T')) {
      return { ok: false, detail: 'TronWeb.address.fromPrivateKey returned invalid address' }
    }
    return { ok: true, address: addr }
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'TronWeb address derivation failed',
    }
  }
}

async function tonFromMnemonic(): Promise<DeriveResult | null> {
  const mnemonic = env('TON_EXECUTION_MNEMONIC')
  if (!mnemonic) return null
  try {
    const { mnemonicToWalletKey } = await import('@ton/crypto')
    const { WalletContractV4 } = await import('@ton/ton')
    const key = await mnemonicToWalletKey(mnemonic.split(/\s+/))
    const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 })
    return {
      ok: true,
      address: wallet.address.toString({ bounceable: false, urlSafe: true }),
    }
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'TON_EXECUTION_MNEMONIC derivation failed',
    }
  }
}

function btcFromWif(): DeriveResult | null {
  const wif = env('BITCOIN_EXECUTION_WIF')
  if (!wif) return null

  try {
    const decoded = decodeBitcoinWif(wif)
    const compressed = decoded.length === 34 && decoded[33] === 0x01
    const privKeyBytes = decoded.slice(1, compressed ? 33 : 33)
    if (privKeyBytes.length !== 32) {
      return { ok: false, detail: 'WIF decoded to unexpected private key length' }
    }

    const version = decoded[0]!
    const btcNetwork = version === 0xef ? networks.testnet : networks.bitcoin

    const pubkey = ecc.pointFromScalar(Buffer.from(privKeyBytes), true)
    if (!pubkey) {
      return { ok: false, detail: 'secp256k1 pointFromScalar failed for WIF private key' }
    }

    const p2wpkh = payments.p2wpkh({ pubkey: Buffer.from(pubkey), network: btcNetwork })
    if (!p2wpkh.address) {
      return { ok: false, detail: 'p2wpkh address encoding failed' }
    }
    return { ok: true, address: p2wpkh.address }
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'BITCOIN_EXECUTION_WIF derivation failed',
    }
  }
}

function lineDerived(label: string, result: DeriveResult | null): void {
  if (!result) {
    line(label, null)
    return
  }
  if (result.ok) {
    line(label, result.address)
    return
  }
  console.warn(`[print-wallets] ${label}: key present — ${result.detail}`)
  console.log(`${label.padEnd(22)} (key set — derivation failed)`)
}

async function main(): Promise<void> {
  console.log('Legion wallet map (addresses only)\n')

  lineDerived('EVM execution', evmFromKey('SETTLEMENT_EXECUTION_PRIVATE_KEY'))
  line('EVM vault', env('SOVEREIGN_VAULT_EVM') || env('SOVEREIGN_VAULT_ADDRESS') || env('VAULT_ADDRESS_EVM'))
  line('EVM final', env('FINAL_WALLET_EVM'))

  lineDerived('Solana execution', await solanaFromSecretAsync())
  line('Solana vault', env('SOVEREIGN_VAULT_SOL') || env('VAULT_ADDRESS_SVM'))
  line('Solana final', env('FINAL_WALLET_SOL'))

  lineDerived('Tron execution', tronFromKey())
  line('Tron vault', env('SOVEREIGN_VAULT_TRON') || env('VAULT_ADDRESS_TRON'))
  line('Tron final', env('FINAL_WALLET_TRX'))

  lineDerived('TON execution', await tonFromMnemonic())
  line('TON vault', env('SOVEREIGN_VAULT_TON') || env('VAULT_ADDRESS_TON'))
  line('TON final', env('FINAL_WALLET_TON'))

  lineDerived('Bitcoin execution', btcFromWif())
  line('Bitcoin vault', env('SOVEREIGN_VAULT_BTC') || env('VAULT_ADDRESS_BTC'))
  line('Bitcoin final', env('FINAL_WALLET_BTC'))

  console.log('\nSuggested minimum native gas (execution wallets):')
  console.log('  EVM     0.01–0.05 ETH mainnet')
  console.log('  Solana  0.05–0.1 SOL')
  console.log('  Tron    50–200 TRX')
  console.log('  TON     1–5 TON')
  console.log('  Bitcoin 0.0001–0.001 BTC')
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
