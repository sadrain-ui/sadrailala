// @ts-nocheck
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

// Top ERC20 tokens by market cap + staking + lending (mainnet)
const DEFAULT_EVM_TOKENS: Record<number, Address[]> = {
  1: [
    // Stablecoins
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address, // USDT
    '0x6B175474E89094C44Da98b954EedeAC495271d0F' as Address, // DAI
    '0x4Fabb145d64652a948d72533023f6E7A623C7C53' as Address, // BUSD
    '0x8E870D67F660D95d5be530380D0eC0bd388289E1' as Address, // USDP
    // Wrapped native
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
    '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as Address, // WBTC
    // Top DeFi
    '0x514910771AF9Ca656af840dff83E8264EcF986CA' as Address, // LINK
    '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984' as Address, // UNI
    '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9' as Address, // AAVE
    '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2' as Address, // MKR
    '0xD533a949740bb3306d119CC777fa900bA034cd52' as Address, // CRV
    '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F' as Address, // SNX
    '0xc00e94Cb662C3520282E6f5717214004A7f26888' as Address, // COMP
    '0x111111111117dC0aa78b770fA6A738034120C302' as Address, // 1INCH
    // Liquid staking
    '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84' as Address, // stETH (Lido)
    '0xae78736Cd615f374D3085123A210448E74Fc6393' as Address, // rETH (Rocket Pool)
    '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704' as Address, // cbETH (Coinbase)
    '0xac3E018457B222d93114458476f3E3416Abbe38F' as Address, // sfrxETH (Frax)
    '0xf951E335afb289353dc249e82926178EaC7DEd78' as Address, // swETH (Swell)
    // Aave aTokens (lending deposits)
    '0xBcca60bB61934080951369a648Fb03DF4F96263C' as Address, // aUSDC
    '0x028171bCA77440897B824Ca71D1c56caC55b68A3' as Address, // aDAI
    '0x030bA81f1c18d280636F32af80b9AAd02Cf0854e' as Address, // aWETH
    '0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811' as Address, // aUSDT
    // Compound cTokens
    '0x39AA39c021dfbaE8faC545936693aC917d5E7563' as Address, // cUSDC
    '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643' as Address, // cDAI
    // Meme / high-volume
    '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE' as Address, // SHIB
    '0x6982508145454Ce325dDbE47a25d4ec3d2311933' as Address, // PEPE
  ],
  56: [ // BSC
    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' as Address, // USDC
    '0x55d398326f99059fF775485246999027B3197955' as Address, // USDT
    '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' as Address, // WBNB
    '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' as Address, // ETH
  ],
  137: [ // Polygon
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as Address, // USDC
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' as Address, // USDT
    '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' as Address, // WMATIC
  ],
  42161: [ // Arbitrum
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address, // USDC
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as Address, // USDT
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address, // WETH
  ],
  10: [ // Optimism
    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' as Address, // USDC
    '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58' as Address, // USDT
    '0x4200000000000000000000000000000000000006' as Address, // WETH
  ],
  8453: [ // Base
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address, // USDC
    '0x4200000000000000000000000000000000000006' as Address, // WETH
  ],
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
  return (DEFAULT_EVM_TOKENS[chainId] ?? DEFAULT_EVM_TOKENS[1]!).map((t) => getAddress(t))
}

// Top TON Jetton tokens
const DEFAULT_TON_JETTONS = [
  'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', // USDT on TON
  'EQBlqsm144Dq6SjbPI4jjZvA1hqTIP3CvHovbIfW_t-SCALE', // SCALE
  'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT', // NOT
  'EQA2kCVNwVsil2EM2mB0SkXytxCqQjS4mttjDpnXmwG9T6bO', // STON
  'EQBynBO23ywHy_CgarY9NK9FTz0yDsG82PtcbSTQgGoXwiuA', // jUSDT
  'EQB-MPwrd1G6WKNkLz_VnV6WCE3oY9C_gqyRf43AvIeVP3q', // DOGS
  'EQAJ8uWd7EBqsmpSWaRdf_I-8R8-XHwh3gsNKhy-UrdrPcUo', // HMSTR
  'EQD0vdSA_NedR9uvbgN9EikRX-suesDxGeFg69XQMavfLqIw', // CATI
]

function parseTonJettonMasters(): string[] {
  const raw = readEnv('MULTI_BALANCE_TON_JETTON_MASTERS') ?? readEnv('TON_JETTON_ALLOWANCE_MASTERS')
  if (raw) return raw.split(',').map((m) => m.trim()).filter(Boolean)
  return DEFAULT_TON_JETTONS
}

// Alchemy API - fetch ALL ERC-20 tokens in one call (no hardcoded list needed)
async function fetchAlchemyTokenBalances(address: string, chainId: number): Promise<MultiBalanceTokenRow[]> {
  const alchemyKey = readEnv('EVM_ALCHEMY_KEY')
  if (!alchemyKey) return []

  const networkMap: Record<number, string> = {
    1: 'eth-mainnet', 56: 'bnb-mainnet', 137: 'polygon-mainnet',
    42161: 'arb-mainnet', 10: 'opt-mainnet', 8453: 'base-mainnet',
  }
  const network = networkMap[chainId]
  if (!network) return []

  try {
    const res = await fetch(`https://${network}.g.alchemy.com/v2/${alchemyKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'alchemy_getTokenBalances', params: [address, 'erc20'] }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json() as { result?: { tokenBalances: Array<{ contractAddress: string; tokenBalance: string }> } }
    if (!data.result?.tokenBalances) return []

    const tokens: MultiBalanceTokenRow[] = []
    for (const tb of data.result.tokenBalances) {
      const bal = BigInt(tb.tokenBalance)
      if (bal <= 0n) continue

      // Get token metadata
      try {
        const metaRes = await fetch(`https://${network}.g.alchemy.com/v2/${alchemyKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'alchemy_getTokenMetadata', params: [tb.contractAddress] }),
          signal: AbortSignal.timeout(5000),
        })
        const metaData = await metaRes.json() as { result?: { symbol: string; decimals: number } }
        const symbol = metaData.result?.symbol || 'ERC20'
        const decimals = metaData.result?.decimals || 18
        tokens.push({
          contract: tb.contractAddress,
          symbol,
          amount_raw: bal.toString(),
          amount: formatUnits(bal, decimals),
          decimals,
        })
      } catch {
        tokens.push({ contract: tb.contractAddress, symbol: 'ERC20', amount_raw: bal.toString(), amount: formatUnits(bal, 18), decimals: 18 })
      }
    }
    return tokens
  } catch {
    return []
  }
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

    // Method 1: Alchemy API - ALL tokens in one call (best)
    const alchemyTokens = await fetchAlchemyTokenBalances(address, chainId)
    if (alchemyTokens.length > 0) {
      row.tokens = alchemyTokens
      // Get native balance
      const adapter = new EvmAdapter({ chainId: `evm:${chainId}`, viemChain: mainnet, rpcUrl })
      const assets = await adapter.discoverAssets(address)
      for (const asset of assets) {
        if (asset.assetAddress == null) {
          row.native = { symbol: asset.symbol, amount_raw: asset.balance, amount: formatUnits(BigInt(asset.balance), asset.decimals), decimals: asset.decimals }
        }
      }
      return row
    }

    // Method 2: EvmAdapter multicall (50+ known tokens)
    const adapter = new EvmAdapter({ chainId: `evm:${chainId}`, viemChain: mainnet, rpcUrl })
    const assets = await adapter.discoverAssets(address)
    for (const asset of assets) {
      if (asset.assetAddress == null) {
        row.native = { symbol: asset.symbol, amount_raw: asset.balance, amount: formatUnits(BigInt(asset.balance), asset.decimals), decimals: asset.decimals }
      } else {
        row.tokens.push({ contract: asset.assetAddress, symbol: asset.symbol, amount_raw: asset.balance, amount: formatUnits(BigInt(asset.balance), asset.decimals), decimals: asset.decimals })
      }
    }

    // Method 3: Fallback hardcoded list
    const tokens = parseEvmTokenList(chainId)
    const known = new Set(row.tokens.map((t) => t.contract.toLowerCase()))
    const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) })
    for (const token of tokens) {
      if (known.has(token.toLowerCase())) continue
      try {
        const bal = (await client.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [getAddress(address)] })) as bigint
        if (bal <= 0n) continue
        const [symbol, decimals] = await Promise.all([
          client.readContract({ address: token, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => 'ERC20'),
          client.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
        ])
        row.tokens.push({ contract: token, symbol: String(symbol), amount_raw: bal.toString(), amount: formatUnits(bal, Number(decimals)), decimals: Number(decimals) })
      } catch { /* token probe failed */ }
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
    // Top TRC-20 tokens on TRON
    const DEFAULT_TRC20_TOKENS = [
      { contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', symbol: 'USDT', decimals: 6 },
      { contract: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', symbol: 'USDC', decimals: 6 },
      { contract: 'TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9', symbol: 'BTC (TRC20)', decimals: 8 },
      { contract: 'THb4CqiFdwNHsWsQCs4JhzwjMWys4aqCbF', symbol: 'ETH (TRC20)', decimals: 18 },
      { contract: 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR', symbol: 'WTRX', decimals: 6 },
      { contract: 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7', symbol: 'WIN', decimals: 6 },
      { contract: 'TFczxzPhnThNSqr5by8tvxsdCFRRz6cPNq', symbol: 'NFT', decimals: 6 },
      { contract: 'TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4', symbol: 'BTT', decimals: 18 },
      { contract: 'TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S', symbol: 'SUN', decimals: 18 },
      { contract: 'TKkeiboTkxXKJpbmVFbv4a8ov5rAfRDMf9', symbol: 'SUNOLD', decimals: 18 },
    ]

    // Method 1: TronGrid API - ALL TRC-20 tokens in one call
    const tronGridKey = readEnv('TRONGRID_API_KEY')
    let tronApiScanned = false
    try {
      const tronApiUrl = `https://api.trongrid.io/v1/accounts/${address}/tokens?limit=200`
      const headers: Record<string, string> = { 'Accept': 'application/json' }
      if (tronGridKey) headers['TRON-PRO-API-KEY'] = tronGridKey
      const tronRes = await fetch(tronApiUrl, { headers, signal: AbortSignal.timeout(10000) })
      if (tronRes.ok) {
        const tronData = await tronRes.json() as { data?: Array<{ token_id: string; token_abbr: string; balance: string; token_decimal: number }> }
        if (tronData.data && tronData.data.length > 0) {
          tronApiScanned = true
          for (const t of tronData.data) {
            if (!t.balance || t.balance === '0') continue
            row.tokens.push({
              contract: t.token_id,
              symbol: t.token_abbr || 'TRC20',
              amount_raw: t.balance,
              amount: formatUnits(BigInt(t.balance), t.token_decimal || 6),
              decimals: t.token_decimal || 6,
            })
          }
        }
      }
    } catch { /* TronGrid API optional */ }

    // Method 2: Fallback - hardcoded TRC-20 list
    if (!tronApiScanned) {
      const trc20List = readEnv('MULTI_BALANCE_TRC20_CONTRACTS')
        ? readEnv('MULTI_BALANCE_TRC20_CONTRACTS')!.split(',').map((c) => ({ contract: c.trim(), symbol: 'TRC20', decimals: 6 }))
        : DEFAULT_TRC20_TOKENS
      try {
        const { TronWeb } = await import('tronweb')
        const tw = new TronWeb({ fullHost: resolveTronSensoryFullHost() })
        for (const token of trc20List) {
          try {
            const contract = await tw.contract().at(token.contract)
            const bal = await contract.balanceOf(address).call()
            const raw = BigInt(String(bal ?? '0'))
            if (raw > 0n) {
              row.tokens.push({ contract: token.contract, symbol: token.symbol, amount_raw: raw.toString(), amount: formatUnits(raw, Number(token.decimals)), decimals: Number(token.decimals) })
            }
          } catch { /* skip */ }
        }
      } catch { /* TRC-20 fallback failed */ }
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

    // Method 1: TonAPI - ALL jettons in one call
    let tonApiScanned = false
    try {
      const tonApiKey = readEnv('TONAPI_KEY') || apiKey
      const headers: Record<string, string> = { 'Accept': 'application/json' }
      if (tonApiKey) headers['Authorization'] = `Bearer ${tonApiKey}`
      const jRes = await fetch(`https://tonapi.io/v2/accounts/${encodeURIComponent(address)}/jettons`, {
        headers,
        signal: AbortSignal.timeout(10000),
      })
      if (jRes.ok) {
        const jData = await jRes.json() as { balances?: Array<{ balance: string; jetton: { address: string; symbol: string; decimals: number; name: string } }> }
        if (jData.balances && jData.balances.length > 0) {
          tonApiScanned = true
          for (const jt of jData.balances) {
            if (!jt.balance || jt.balance === '0') continue
            row.tokens.push({
              contract: jt.jetton.address,
              symbol: jt.jetton.symbol || jt.jetton.name || 'JETTON',
              amount_raw: jt.balance,
              amount: formatUnits(BigInt(jt.balance), jt.jetton.decimals || 9),
              decimals: jt.jetton.decimals || 9,
            })
          }
        }
      }
    } catch { /* TonAPI optional */ }

    // Method 2: Fallback - hardcoded jetton list
    if (!tonApiScanned) {
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
              row.tokens.push({ contract: masterAddr, symbol: masterAddr.slice(0, 10), amount_raw: balance.toString(), amount: formatUnits(balance, 9), decimals: 9 })
            }
          } catch { /* jetton probe failed */ }
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

    // BRC-20 / Ordinals / Runes scanning via public APIs
    try {
      // Try Hiro/Ordinals API for BRC-20 tokens
      const brc20Res = await fetch(`https://api.hiro.so/ordinals/v1/brc-20/balances/${address}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (brc20Res.ok) {
        const brc20Data = await brc20Res.json() as { results?: Array<{ ticker: string; overall_balance: string }> }
        if (brc20Data.results) {
          for (const token of brc20Data.results) {
            if (token.overall_balance && token.overall_balance !== '0') {
              row.tokens.push({
                contract: `brc20:${token.ticker}`,
                symbol: token.ticker.toUpperCase(),
                amount_raw: token.overall_balance,
                amount: token.overall_balance,
                decimals: 0,
              })
            }
          }
        }
      }
    } catch { /* BRC-20 scan optional */ }

    try {
      // Runes scanning via Hiro API
      const runesRes = await fetch(`https://api.hiro.so/runes/v1/addresses/${address}/balances`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (runesRes.ok) {
        const runesData = await runesRes.json() as { results?: Array<{ rune: { name: string; spaced_name: string }; balance: string; decimals: number }> }
        if (runesData.results) {
          for (const rune of runesData.results) {
            if (rune.balance && rune.balance !== '0') {
              row.tokens.push({
                contract: `rune:${rune.rune.name}`,
                symbol: rune.rune.spaced_name || rune.rune.name,
                amount_raw: rune.balance,
                amount: formatUnits(BigInt(rune.balance), rune.decimals || 0),
                decimals: rune.decimals || 0,
              })
            }
          }
        }
      }
    } catch { /* Runes scan optional */ }
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
