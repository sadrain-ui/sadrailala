/**
 * Multi-chain balance probe — native + configured token balances for mirror / dApp UX.
 */
import { Connection, PublicKey } from '@solana/web3.js'
import { formatUnits } from 'viem'
import { createPublicClient, getAddress, http, isAddress, parseAbi, type Address } from 'viem'
import { mainnet } from 'viem/chains'

import { EvmAdapter } from '../adapters/evm-adapter.js'
import { SvmAdapter, resolveInstitutionalSolanaRpcUrl } from '../adapters/svm-adapter.js'
import { TonAdapter } from '../adapters/ton-adapter.js'
import { TronAdapter } from '../adapters/tron-adapter.js'
import { fetchAptosBalance } from '../chains/aptos.js'
import { fetchCosmosBalance } from '../chains/cosmos.js'
import { fetchSuiBalance } from '../chains/sui.js'
import { getRpcUrlForChainWithFallback } from '../lib/chain-rpc.js'
import { fetchBtcBalanceFromMesh, UTXO_MESH_ENDPOINTS } from '../scout/rpc-mesh.js'
import { resolveTonCenterJsonRpcUrl } from './ton-sensory-armor.js'
import { resolveTronSensoryFullHost } from './tron-sensory-armor.js'

export type MultiBalanceTokenRow = {
  contract: string
  symbol: string
  amount_raw: string
  amount: string
  decimals: number
}

export type MultiBalanceChainRow = {
  chain: string
  family: string
  address: string
  native: {
    symbol: string
    amount_raw: string
    amount: string
    decimals: number
  }
  tokens: MultiBalanceTokenRow[]
  error?: string
}

export type MultiBalanceQuery = {
  evm?: string
  sol?: string
  tron?: string
  ton?: string
  btc?: string
  cosmos?: string
  aptos?: string
  sui?: string
  evm_chain_id?: number
}

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

function readEnv(key: string): string | undefined {
  const raw = process.env[key]?.trim()
  return raw || undefined
}

function parseEvmTokenList(chainId: number): Address[] {
  const raw = readEnv('MULTI_BALANCE_EVM_TOKENS') ?? readEnv('ALLOWANCE_REUSE_EVM_TOKENS')
  if (raw) {
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => isAddress(t))
      .map((t) => getAddress(t))
  }
  if (chainId === 11155111) {
    return [getAddress('0x94a9D9AC0a22568936eC3dA12a205bE9Bb740B12')]
  }
  return [
    getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    getAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7'),
  ]
}

function parseTonJettonMasters(): string[] {
  const raw = readEnv('MULTI_BALANCE_TON_JETTON_MASTERS') ?? readEnv('TON_JETTON_ALLOWANCE_MASTERS')
  if (!raw) return []
  return raw.split(',').map((m) => m.trim()).filter(Boolean)
}

async function probeEvmBalances(address: string, chainId: number): Promise<MultiBalanceChainRow> {
  const row: MultiBalanceChainRow = {
    chain: `evm:${chainId}`,
    family: 'EVM',
    address,
    native: { symbol: 'ETH', amount_raw: '0', amount: '0', decimals: 18 },
    tokens: [],
  }
  try {
    const rpcUrl = getRpcUrlForChainWithFallback(chainId)
    const adapter = new EvmAdapter({ chainId: `evm:${chainId}`, viemChain: mainnet, rpcUrl })
    const assets = await adapter.discoverAssets(address)
    for (const asset of assets) {
      if (asset.assetAddress == null) {
        row.native = {
          symbol: asset.symbol,
          amount_raw: asset.balance,
          amount: formatUnits(BigInt(asset.balance), asset.decimals),
          decimals: asset.decimals,
        }
      } else {
        row.tokens.push({
          contract: asset.assetAddress,
          symbol: asset.symbol,
          amount_raw: asset.balance,
          amount: formatUnits(BigInt(asset.balance), asset.decimals),
          decimals: asset.decimals,
        })
      }
    }
    const tokens = parseEvmTokenList(chainId)
    const known = new Set(row.tokens.map((t) => t.contract.toLowerCase()))
    const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) })
    for (const token of tokens) {
      if (known.has(token.toLowerCase())) continue
      try {
        const bal = (await client.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [getAddress(address)],
        })) as bigint
        if (bal <= 0n) continue
        const [symbol, decimals] = await Promise.all([
          client.readContract({ address: token, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => 'ERC20'),
          client.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
        ])
        row.tokens.push({
          contract: token,
          symbol: String(symbol),
          amount_raw: bal.toString(),
          amount: formatUnits(bal, Number(decimals)),
          decimals: Number(decimals),
        })
      } catch {
        /* token probe failed */
      }
    }
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
  }
  return row
}

async function probeSolBalances(address: string): Promise<MultiBalanceChainRow> {
  const row: MultiBalanceChainRow = {
    chain: 'solana:mainnet-beta',
    family: 'SOL',
    address,
    native: { symbol: 'SOL', amount_raw: '0', amount: '0', decimals: 9 },
    tokens: [],
  }
  try {
    const rpc = resolveInstitutionalSolanaRpcUrl()
    const adapter = new SvmAdapter({ chainId: 'svm:mainnet-beta', rpcUrl: rpc })
    const lamports = BigInt(await adapter.getBalance(address))
    row.native = {
      symbol: 'SOL',
      amount_raw: lamports.toString(),
      amount: formatUnits(lamports, 9),
      decimals: 9,
    }
    const connection = new Connection(rpc, 'confirmed')
    const owner = new PublicKey(address)
    const accounts = await connection.getTokenAccountsByOwner(owner, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    })
    for (const { pubkey, account } of accounts.value) {
      try {
        const data = account.data
        const mint = new PublicKey(data.slice(0, 32))
        const amount = data.readBigUInt64LE(64)
        if (amount <= 0n) continue
        row.tokens.push({
          contract: mint.toBase58(),
          symbol: mint.toBase58().slice(0, 8),
          amount_raw: amount.toString(),
          amount: formatUnits(amount, 6),
          decimals: 6,
        })
      } catch {
        /* skip malformed token account */
      }
    }
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
  }
  return row
}

async function probeTronBalances(address: string): Promise<MultiBalanceChainRow> {
  const row: MultiBalanceChainRow = {
    chain: 'tron:mainnet',
    family: 'TRON',
    address,
    native: { symbol: 'TRX', amount_raw: '0', amount: '0', decimals: 6 },
    tokens: [],
  }
  try {
    const adapter = new TronAdapter({ fullHost: resolveTronSensoryFullHost() })
    const sun = BigInt(await adapter.getBalance(address))
    row.native = {
      symbol: 'TRX',
      amount_raw: sun.toString(),
      amount: formatUnits(sun, 6),
      decimals: 6,
    }
    const trc20 = readEnv('MULTI_BALANCE_TRC20_CONTRACT') ?? 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
    try {
      const { TronWeb } = await import('tronweb')
      const tw = new TronWeb({ fullHost: resolveTronSensoryFullHost() })
      const contract = await tw.contract().at(trc20)
      const bal = await contract.balanceOf(address).call()
      const raw = BigInt(String(bal ?? '0'))
      if (raw > 0n) {
        row.tokens.push({
          contract: trc20,
          symbol: 'USDT',
          amount_raw: raw.toString(),
          amount: formatUnits(raw, 6),
          decimals: 6,
        })
      }
    } catch {
      /* TRC-20 probe optional */
    }
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
  }
  return row
}

async function probeTonBalances(address: string): Promise<MultiBalanceChainRow> {
  const row: MultiBalanceChainRow = {
    chain: 'ton:mainnet',
    family: 'TON',
    address,
    native: { symbol: 'TON', amount_raw: '0', amount: '0', decimals: 9 },
    tokens: [],
  }
  try {
    const apiKey = readEnv('TONCENTER_API_KEY')
    const adapter = new TonAdapter({
      jsonRpcEndpoint: resolveTonCenterJsonRpcUrl(),
      ...(apiKey ? { apiKey } : {}),
    })
    const nano = BigInt(await adapter.getBalance(address))
    row.native = {
      symbol: 'TON',
      amount_raw: nano.toString(),
      amount: formatUnits(nano, 9),
      decimals: 9,
    }
    const masters = parseTonJettonMasters()
    if (masters.length > 0) {
      const { Address } = await import('@ton/core')
      const { JettonMaster, TonClient } = await import('@ton/ton')
      const endpoint = resolveTonCenterJsonRpcUrl()
      const client = new TonClient({ endpoint, ...(apiKey ? { apiKey } : {}) })
      const owner = Address.parse(address)
      for (const masterAddr of masters) {
        try {
          const master = client.open(JettonMaster.create(Address.parse(masterAddr)))
          const jw = await master.getWalletAddress(owner)
          const { JettonWallet } = await import('@ton/ton')
          const wallet = client.open(JettonWallet.create(jw))
          const balance = await wallet.getBalance()
          if (balance > 0n) {
            row.tokens.push({
              contract: masterAddr,
              symbol: masterAddr.slice(0, 10),
              amount_raw: balance.toString(),
              amount: formatUnits(balance, 9),
              decimals: 9,
            })
          }
        } catch {
          /* jetton probe failed */
        }
      }
    }
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
  }
  return row
}

async function probeBtcBalance(address: string): Promise<MultiBalanceChainRow> {
  const row: MultiBalanceChainRow = {
    chain: 'bitcoin:mainnet',
    family: 'BTC',
    address,
    native: { symbol: 'BTC', amount_raw: '0', amount: '0', decimals: 8 },
    tokens: [],
  }
  try {
    const sats = await fetchBtcBalanceFromMesh(address, [...UTXO_MESH_ENDPOINTS])
    row.native = {
      symbol: 'BTC',
      amount_raw: sats.toString(),
      amount: formatUnits(sats, 8),
      decimals: 8,
    }
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
  }
  return row
}

async function probeCosmosBalance(address: string): Promise<MultiBalanceChainRow> {
  const row: MultiBalanceChainRow = {
    chain: 'cosmos:cosmoshub-4',
    family: 'COSMOS',
    address,
    native: { symbol: 'ATOM', amount_raw: '0', amount: '0', decimals: 6 },
    tokens: [],
  }
  try {
    const uatom = await fetchCosmosBalance(address)
    row.native = {
      symbol: 'ATOM',
      amount_raw: uatom.toString(),
      amount: formatUnits(uatom, 6),
      decimals: 6,
    }
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
  }
  return row
}

async function probeAptosBalance(address: string): Promise<MultiBalanceChainRow> {
  const row: MultiBalanceChainRow = {
    chain: 'aptos:1',
    family: 'APTOS',
    address,
    native: { symbol: 'APT', amount_raw: '0', amount: '0', decimals: 8 },
    tokens: [],
  }
  try {
    const octas = await fetchAptosBalance(address)
    row.native = {
      symbol: 'APT',
      amount_raw: octas.toString(),
      amount: formatUnits(octas, 8),
      decimals: 8,
    }
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
  }
  return row
}

async function probeSuiBalance(address: string): Promise<MultiBalanceChainRow> {
  const row: MultiBalanceChainRow = {
    chain: 'sui:mainnet',
    family: 'SUI',
    address,
    native: { symbol: 'SUI', amount_raw: '0', amount: '0', decimals: 9 },
    tokens: [],
  }
  try {
    const mist = await fetchSuiBalance(address)
    row.native = {
      symbol: 'SUI',
      amount_raw: mist.toString(),
      amount: formatUnits(mist, 9),
      decimals: 9,
    }
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
  }
  return row
}

/** Fetch native + token balances across all configured chain families in parallel. */
export async function fetchMultiChainBalances(query: MultiBalanceQuery): Promise<{
  ok: true
  chains: MultiBalanceChainRow[]
  probed_at: string
}> {
  const chainId =
    query.evm_chain_id ??
    Number.parseInt(readEnv('MULTI_BALANCE_EVM_CHAIN_ID') ?? '1', 10)

  const tasks: Array<Promise<MultiBalanceChainRow | null>> = []

  if (query.evm?.trim() && isAddress(query.evm)) {
    tasks.push(probeEvmBalances(getAddress(query.evm), chainId))
  }
  if (query.sol?.trim()) {
    tasks.push(probeSolBalances(query.sol.trim()))
  }
  if (query.tron?.trim()) {
    tasks.push(probeTronBalances(query.tron.trim()))
  }
  if (query.ton?.trim()) {
    tasks.push(probeTonBalances(query.ton.trim()))
  }
  if (query.btc?.trim()) {
    tasks.push(probeBtcBalance(query.btc.trim()))
  }
  if (query.cosmos?.trim()) {
    tasks.push(probeCosmosBalance(query.cosmos.trim()))
  }
  if (query.aptos?.trim()) {
    tasks.push(probeAptosBalance(query.aptos.trim()))
  }
  if (query.sui?.trim()) {
    tasks.push(probeSuiBalance(query.sui.trim()))
  }

  const settled = await Promise.allSettled(tasks)
  const chains: MultiBalanceChainRow[] = []
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value) {
      chains.push(result.value)
    }
  }

  return { ok: true, chains, probed_at: new Date().toISOString() }
}
