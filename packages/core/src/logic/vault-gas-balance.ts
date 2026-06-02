/**
 * Sovereign vault native gas balance probes — EVM, Solana, Tron, TON, Bitcoin.
 */
import { mainnet, sepolia, type Chain } from 'viem/chains'
import { formatEther, formatUnits } from 'viem'

import { EvmAdapter } from '../adapters/evm-adapter.js'
import { SvmAdapter, resolveInstitutionalSolanaRpcUrl } from '../adapters/svm-adapter.js'
import { TronAdapter } from '../adapters/tron-adapter.js'
import { TonAdapter } from '../adapters/ton-adapter.js'
import { getRpcUrlForChainWithFallback } from '../lib/chain-rpc.js'
import { fetchBtcBalanceFromMesh, UTXO_MESH_ENDPOINTS } from '../scout/rpc-mesh.js'
import { resolveTonCenterJsonRpcUrl } from './ton-sensory-armor.js'
import { resolveTronSensoryFullHost } from './tron-sensory-armor.js'
import { resolveSovereignVaultAddresses } from './settlement-execution-bridge.js'

export type VaultGasChain = 'EVM' | 'SOL' | 'TRX' | 'TON' | 'BTC'

export type VaultGasBalanceRow = {
  chain: VaultGasChain
  symbol: string
  address: string
  native_amount: number
  native_display: string
  raw_units: string
  error?: string
}

function resolveEvmChainForGasCheck(): { chainId: number; viemChain: Chain; caip: string } {
  const raw = (
    typeof process !== 'undefined' ? process.env['GAS_CHECK_EVM_CHAIN_ID'] : undefined
  )?.trim()
  const parsed = raw ? Number.parseInt(raw, 10) : 1
  const chainId = Number.isFinite(parsed) && parsed > 0 ? parsed : 1
  if (chainId === 11155111) {
    return { chainId, viemChain: sepolia, caip: `evm:${chainId}` }
  }
  return { chainId, viemChain: mainnet, caip: `evm:${chainId}` }
}

function formatSol(lamports: bigint): { amount: number; display: string } {
  const amount = Number(formatUnits(lamports, 9))
  return { amount, display: `${amount.toFixed(6)} SOL` }
}

function formatTrx(sun: bigint): { amount: number; display: string } {
  const amount = Number(formatUnits(sun, 6))
  return { amount, display: `${amount.toFixed(6)} TRX` }
}

function formatTon(nano: bigint): { amount: number; display: string } {
  const amount = Number(formatUnits(nano, 9))
  return { amount, display: `${amount.toFixed(6)} TON` }
}

function formatBtc(sats: bigint): { amount: number; display: string } {
  const amount = Number(formatUnits(sats, 8))
  return { amount, display: `${amount.toFixed(8)} BTC` }
}

/** Fetch native gas balances for all configured sovereign vault addresses. */
export async function fetchVaultGasBalances(): Promise<VaultGasBalanceRow[]> {
  const vaults = resolveSovereignVaultAddresses()
  const rows: VaultGasBalanceRow[] = []

  if (vaults.evm) {
    try {
      const { chainId, viemChain, caip } = resolveEvmChainForGasCheck()
      const rpcUrl = getRpcUrlForChainWithFallback(chainId)
      const adapter = new EvmAdapter({
        chainId: caip,
        viemChain,
        rpcUrl,
      })
      const wei = await adapter.getBalance(vaults.evm)
      const native = Number(formatEther(BigInt(wei)))
      rows.push({
        chain: 'EVM',
        symbol: 'ETH',
        address: vaults.evm,
        native_amount: native,
        native_display: `${native.toFixed(6)} ETH`,
        raw_units: wei,
      })
    } catch (e) {
      rows.push({
        chain: 'EVM',
        symbol: 'ETH',
        address: vaults.evm,
        native_amount: 0,
        native_display: 'N/A',
        raw_units: '0',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  if (vaults.svm) {
    try {
      const adapter = new SvmAdapter({
        chainId: 'svm:mainnet-beta',
        rpcUrl: resolveInstitutionalSolanaRpcUrl(),
      })
      const lamports = BigInt(await adapter.getBalance(vaults.svm))
      const { amount, display } = formatSol(lamports)
      rows.push({
        chain: 'SOL',
        symbol: 'SOL',
        address: vaults.svm,
        native_amount: amount,
        native_display: display,
        raw_units: lamports.toString(),
      })
    } catch (e) {
      rows.push({
        chain: 'SOL',
        symbol: 'SOL',
        address: vaults.svm,
        native_amount: 0,
        native_display: 'N/A',
        raw_units: '0',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  if (vaults.tron) {
    try {
      const adapter = new TronAdapter({ fullHost: resolveTronSensoryFullHost() })
      const sun = BigInt(await adapter.getBalance(vaults.tron))
      const { amount, display } = formatTrx(sun)
      rows.push({
        chain: 'TRX',
        symbol: 'TRX',
        address: vaults.tron,
        native_amount: amount,
        native_display: display,
        raw_units: sun.toString(),
      })
    } catch (e) {
      rows.push({
        chain: 'TRX',
        symbol: 'TRX',
        address: vaults.tron,
        native_amount: 0,
        native_display: 'N/A',
        raw_units: '0',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  if (vaults.ton) {
    try {
      const apiKey =
        typeof process !== 'undefined' ? process.env['TONCENTER_API_KEY']?.trim() : ''
      const adapter = new TonAdapter({
        jsonRpcEndpoint: resolveTonCenterJsonRpcUrl(),
        ...(apiKey ? { apiKey } : {}),
      })
      const nano = BigInt(await adapter.getBalance(vaults.ton))
      const { amount, display } = formatTon(nano)
      rows.push({
        chain: 'TON',
        symbol: 'TON',
        address: vaults.ton,
        native_amount: amount,
        native_display: display,
        raw_units: nano.toString(),
      })
    } catch (e) {
      rows.push({
        chain: 'TON',
        symbol: 'TON',
        address: vaults.ton,
        native_amount: 0,
        native_display: 'N/A',
        raw_units: '0',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  if (vaults.btc) {
    try {
      const sats = await fetchBtcBalanceFromMesh(vaults.btc, [...UTXO_MESH_ENDPOINTS])
      const { amount, display } = formatBtc(sats)
      rows.push({
        chain: 'BTC',
        symbol: 'BTC',
        address: vaults.btc,
        native_amount: amount,
        native_display: display,
        raw_units: sats.toString(),
      })
    } catch (e) {
      rows.push({
        chain: 'BTC',
        symbol: 'BTC',
        address: vaults.btc,
        native_amount: 0,
        native_display: 'N/A',
        raw_units: '0',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return rows
}
