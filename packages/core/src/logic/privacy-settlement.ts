/**
 * Production privacy settlement — routes vault balances through configured mixers after settlement.
 * Armed when PRIVACY_MIXER_ENABLED=true (independent of SECURITY_RESEARCH_MODE).
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, mainnet, optimism, polygon, sepolia } from 'viem/chains'

import { normalizeEvmExecutionPrivateKey } from '../lib/evm-execution-key.js'
import { resolveSovereignVaultAddresses } from './settlement-execution-bridge.js'
import { resolveEvmRpcUrlForChain } from './permit2-executor.js'

function readEnv(keys: readonly string[]): string {
  for (const key of keys) {
    const raw = process.env[key]?.trim()
    if (raw) return raw
  }
  return ''
}

function resolveEvmSettlementPrivateKey(): Hex | null {
  const raw = readEnv([
    'SETTLEMENT_EXECUTION_PRIVATE_KEY',
    'RELAY_INTERMEDIARY_PRIVATE_KEY',
    'PRIVATE_KEY',
  ])
  return normalizeEvmExecutionPrivateKey(raw)
}

export type PrivacyMixerType = 'aztec' | 'railgun' | 'thorchain_xmr' | 'auto'
export type PrivacySettlementChain = 'EVM' | 'SOL' | 'TRON' | 'TON' | 'BTC'

export type PrivacySettlementJob = {
  chain: PrivacySettlementChain
  vault_address: string
  token_address?: string
  settlement_tx_hash?: string
  amount_raw?: string
  scout_value_usd?: number
  chain_id?: number
}

export type PrivacySettlementResult =
  | {
      ok: true
      lane: PrivacyMixerType | 'chain_hop'
      tx_hashes: string[]
      detail?: string
    }
  | {
      ok: false
      funds_remain_in_vault: true
      error: string
      lane?: string
    }

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
])

const SWAP_ROUTER_ABI = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
])

const MAINNET_USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const SWAP_ROUTER_02 = getAddress('0x68b3465833fb72A70ecDF487E86da69B732B385b')
const WETH_MAINNET = getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')

function isTruthyEnv(key: string): boolean {
  const v = process.env[key]?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export function isPrivacyMixerEnabled(): boolean {
  return isTruthyEnv('PRIVACY_MIXER_ENABLED')
}

export function readPrivacyMixerType(): PrivacyMixerType {
  const raw = process.env['PRIVACY_MIXER_TYPE']?.trim().toLowerCase()
  if (raw === 'aztec' || raw === 'railgun' || raw === 'thorchain_xmr') return raw
  return 'auto'
}

export function readPrivacyMixerRouting(): PrivacySettlementChain[] | null {
  const raw = process.env['PRIVACY_MIXER_ROUTING']?.trim()
  if (!raw) return null
  const allowed = new Set<PrivacySettlementChain>(['EVM', 'SOL', 'TRON', 'TON', 'BTC'])
  const chains = raw
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c): c is PrivacySettlementChain => allowed.has(c as PrivacySettlementChain))
  return chains.length > 0 ? chains : null
}

function resolveEvmChain(chainId: number): Chain {
  const map: Record<number, Chain> = {
    1: mainnet,
    137: polygon,
    42161: arbitrum,
    8453: base,
    10: optimism,
    11155111: sepolia,
  }
  return map[chainId] ?? mainnet
}

function resolvePrivacyTokenAddress(chainId: number): Address {
  const custom = process.env['PRIVACY_MIXER_TOKEN_ADDRESS']?.trim()
  if (custom && isAddress(custom)) return getAddress(custom)
  if (chainId === 11155111) {
    return getAddress('0x94a9D9AC0a22568936eC3dA12a205bE9Bb740B12')
  }
  return MAINNET_USDC
}

function resolveThornodeBase(): string {
  return (
    process.env['THORCHAIN_NODE_URL']?.trim().replace(/\/$/, '') ||
    'https://thornode.ninerealms.com'
  )
}

function resolveXmrDestination(): string | null {
  return process.env['PRIVACY_MIXER_XMR_DESTINATION']?.trim() || null
}

type EvmSignerContext = {
  rawPrivKey: Hex
  account: ReturnType<typeof privateKeyToAccount>
  chain: Chain
  chainId: number
  rpcUrl: string
}

async function resolveEvmSigner(chainId: number): Promise<EvmSignerContext | null> {
  const customKey = normalizeEvmExecutionPrivateKey(
    process.env['PRIVACY_MIXER_EVM_SIGNING_KEY']?.trim(),
  )
  const pk = customKey ?? resolveEvmSettlementPrivateKey()
  if (!pk) return null

  const rpcUrl =
    (await resolveEvmRpcUrlForChain(chainId))
  if (!rpcUrl) return null

  return {
    rawPrivKey: pk,
    account: privateKeyToAccount(pk),
    chain: resolveEvmChain(chainId),
    chainId,
    rpcUrl,
  }
}

async function readVaultTokenBalance(
  vault: Address,
  token: Address,
  ctx: EvmSignerContext,
): Promise<{ balance: bigint; decimals: number }> {
  const publicClient = createPublicClient({
    chain: ctx.chain,
    transport: http(ctx.rpcUrl, { timeout: 20_000 }),
  })
  const [balance, decimals] = await Promise.all([
    publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [vault],
    }),
    publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'decimals',
      args: [],
    }),
  ])
  return { balance: balance as bigint, decimals: Number(decimals) }
}

async function sendEvmContractTx(
  ctx: EvmSignerContext,
  params: {
    to: Address
    data: Hex
    gas?: bigint
  },
): Promise<Hex> {
  const publicClient = createPublicClient({
    chain: ctx.chain,
    transport: http(ctx.rpcUrl, { timeout: 20_000 }),
  })
  const walletClient = createWalletClient({
    account: ctx.account,
    chain: ctx.chain,
    transport: http(ctx.rpcUrl, { timeout: 20_000 }),
  })

  const nonce = await publicClient.getTransactionCount({ address: ctx.account.address })
  const request = await walletClient.prepareTransactionRequest({
    account: ctx.account,
    to: params.to,
    data: params.data,
    chain: ctx.chain,
    nonce,
    ...(params.gas != null ? { gas: params.gas } : {}),
  } as unknown as Parameters<typeof walletClient.prepareTransactionRequest>[0])
  const signed = await walletClient.signTransaction({
    ...request,
    account: ctx.account,
    chain: ctx.chain,
  } as unknown as Parameters<typeof walletClient.signTransaction>[0])
  return walletClient.sendRawTransaction({ serializedTransaction: signed })
}

async function ensureAllowanceAndPullFromVault(
  vault: Address,
  token: Address,
  amount: bigint,
  spender: Address,
  ctx: EvmSignerContext,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const publicClient = createPublicClient({
    chain: ctx.chain,
    transport: http(ctx.rpcUrl, { timeout: 20_000 }),
  })

  if (ctx.account.address.toLowerCase() === vault.toLowerCase()) {
    return { ok: true }
  }

  const allowance = (await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [vault, spender],
  })) as bigint

  if (allowance < amount) {
    return {
      ok: false,
      error:
        'Vault has not approved the privacy signer to move tokens — funds remain in vault',
    }
  }

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transferFrom',
    args: [vault, ctx.account.address, amount],
  })
  await sendEvmContractTx(ctx, { to: token, data })
  return { ok: true }
}

/**
 * Helper to bypass TypeScript module resolution for optional @aztec packages.
 * Falls back to null if the package is not installed — the caller checks and
 * falls through to the Thorchain lane automatically.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aztecDynImport(specifier: string): Promise<any> {
  return (new Function('s', 'return import(s)') as (s: string) => Promise<unknown>)(specifier)
}

/**
 * Deposit ERC-20 tokens into Aztec L2 as a private (shielded) note.
 *
 * Pre-conditions (must all be satisfied; any failure falls through to Thorchain):
 *   • `AZTEC_RPC_URL`                — Aztec L2 node endpoint
 *   • `AZTEC_TOKEN_CONTRACT_ADDRESS` — Deployed token contract address on Aztec L2
 *   • `AZTEC_RECIPIENT_ADDRESS`      — Aztec L2 recipient (AztecAddress string)
 *   • The execution account must have a **public** token balance on Aztec L2
 *     (tokens bridged from L1 via the token portal, or minted on L2).
 *   • @aztec/aztec.js, @aztec/wallets, @aztec/accounts, @aztec/noir-contracts.js installed.
 *
 * Flow:
 *   1. Connect EmbeddedWallet to Aztec node (ephemeral — no disk writes).
 *   2. Load ECDSA secp256k1 account derived from the EVM execution private key.
 *   3. Deploy the account contract if not already on L2 (requires Fee Juice).
 *   4. Call `transfer_to_private(recipient, amount)` on the Aztec TokenContract.
 *   5. Wait for inclusion; return transaction hash.
 *
 * On any failure, returns `{ ok: false, reason }` so the caller falls back to Thorchain.
 */
async function tryAztecDeposit(
  rawPrivKey: Hex,
  amount: bigint,
  _token: Address,
  _ctx: EvmSignerContext,
): Promise<{ ok: true; tx_hash: string } | { ok: false; reason: string }> {
  const aztecRpc = process.env['AZTEC_RPC_URL']?.trim()
  if (!aztecRpc) return { ok: false, reason: 'AZTEC_RPC_URL not configured' }

  const aztecTokenAddr = process.env['AZTEC_TOKEN_CONTRACT_ADDRESS']?.trim()
  if (!aztecTokenAddr) {
    return {
      ok: false,
      reason:
        'AZTEC_TOKEN_CONTRACT_ADDRESS not configured — set to the Aztec L2 token contract address',
    }
  }

  const aztecRecipientRaw = process.env['AZTEC_RECIPIENT_ADDRESS']?.trim()
  if (!aztecRecipientRaw) {
    return {
      ok: false,
      reason:
        'AZTEC_RECIPIENT_ADDRESS not configured — set to the Aztec L2 AztecAddress of the recipient',
    }
  }

  try {
    // Load all required @aztec modules dynamically.  Returns null per package if not installed.
    const [nodeModule, walletModule, ecdsaModule, fieldsModule, addrModule, contractsModule] =
      await Promise.all([
        aztecDynImport('@aztec/aztec.js/node').catch(() => null),
        aztecDynImport('@aztec/wallets/embedded').catch(() => null),
        aztecDynImport('@aztec/accounts/ecdsa').catch(() => null),
        aztecDynImport('@aztec/aztec.js/fields').catch(() => null),
        aztecDynImport('@aztec/aztec.js/addresses').catch(() => null),
        aztecDynImport('@aztec/noir-contracts.js/Token').catch(() => null),
      ])

    if (!nodeModule?.createAztecNodeClient) {
      console.warn('[PRIVACY] Aztec not available – skipping (@aztec/aztec.js/node not installed)')
      return {
        ok: false,
        reason:
          '@aztec/aztec.js/node unavailable — install: pnpm add @aztec/aztec.js @aztec/wallets @aztec/accounts @aztec/noir-contracts.js',
      }
    }
    if (!walletModule?.EmbeddedWallet) {
      console.warn('[PRIVACY] Aztec not available – skipping (@aztec/wallets/embedded not installed)')
      return { ok: false, reason: '@aztec/wallets/embedded not installed' }
    }
    if (!ecdsaModule?.getEcdsaKAccount) {
      console.warn('[PRIVACY] Aztec not available – skipping (@aztec/accounts/ecdsa not installed)')
      return { ok: false, reason: '@aztec/accounts/ecdsa not installed' }
    }
    if (!contractsModule?.TokenContract) {
      console.warn('[PRIVACY] Aztec not available – skipping (@aztec/noir-contracts.js/Token not installed)')
      return { ok: false, reason: '@aztec/noir-contracts.js/Token not installed' }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { createAztecNodeClient } = nodeModule
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { EmbeddedWallet } = walletModule
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { getEcdsaKAccount } = ecdsaModule
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { TokenContract } = contractsModule
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { AztecAddress } = addrModule ?? {}
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { Fr } = fieldsModule ?? {}

    // ── 1. Connect EmbeddedWallet (ephemeral — no disk state written) ──────────
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const embeddedWallet = await EmbeddedWallet.create(aztecRpc, { ephemeral: true })

    // ── 2. Derive EcdsaK account from EVM private key (secp256k1 — Ethereum compatible) ──
    const pkHex = rawPrivKey.replace(/^0x/i, '').padStart(64, '0')
    const signingKeyBytes = Buffer.from(pkHex, 'hex')

    // Salt: use AZTEC_ACCOUNT_SALT env var, or derive deterministically from the private key
    const saltHex = (
      process.env['AZTEC_ACCOUNT_SALT']?.trim().replace(/^0x/i, '') ?? pkHex.slice(0, 64)
    ).padStart(64, '0')
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const salt = Fr ? Fr.fromBuffer(Buffer.from(saltHex, 'hex')) : saltHex

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const accountManager = getEcdsaKAccount(embeddedWallet, signingKeyBytes, salt)

    // ── 3. Get or deploy the Aztec account contract ─────────────────────────────
    let aztecWallet: unknown
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      aztecWallet = await accountManager.getWallet()
    } catch {
      // Account not registered on L2 — deploy it (requires Fee Juice pre-funded on the address)
      console.info('[PRIVACY_MIXER] Aztec account not found — attempting contract deployment…')
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await accountManager.deploy().send().wait()
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      aztecWallet = await accountManager.getWallet()
    }

    // ── 4. Resolve recipient AztecAddress ───────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const recipient = AztecAddress
      ? AztecAddress.fromString(aztecRecipientRaw)
      : aztecRecipientRaw

    // ── 5. Get token contract on Aztec L2 ───────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const tokenContract = await TokenContract.at(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      AztecAddress ? AztecAddress.fromString(aztecTokenAddr) : aztecTokenAddr,
      aztecWallet,
    )

    // ── 6. Shield: transfer_to_private(recipient, amount) ──────────────────────
    // Moves `amount` tokens from the account's *public* L2 balance into a
    // private note owned by `recipient`.  Requires public balance to be funded
    // (bridge from L1 first, or mint on L2).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const receipt = await tokenContract.methods
      .transfer_to_private(recipient, amount)
      .send()
      .wait()

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const txHash: string =
      receipt?.txHash != null
        ? String(receipt.txHash)
        : // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          receipt?.blockHash != null
          ? String(receipt.blockHash)
          : 'aztec-pending'

    console.info(`[PRIVACY_MIXER] Aztec private deposit confirmed — tx: ${txHash}`)
    return { ok: true, tx_hash: txHash }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    console.warn(`[PRIVACY_MIXER] Aztec deposit failed: ${reason}`)
    return { ok: false, reason }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Railgun helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deployed Railgun RailgunSmartWallet contract addresses (v3) per EVM chain.
 * Source: https://github.com/Railgun-Community/deployments
 */
const RAILGUN_CONTRACTS: Record<number, Address> = {
  1: getAddress('0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b4'), // Ethereum mainnet
  137: getAddress('0x19B620929f97b7b990801496c3b361CA5dEf8C71'), // Polygon
  56: getAddress('0x590162bf4b50F6576a459B75309eE21D92178A10'), // BNB Chain
  42161: getAddress('0xA3aB62132f0B9dF55D55Ba19d3C21b3f4fA9f4D8'), // Arbitrum
}

/**
 * Maps viem chainId to the Railgun SDK NetworkName string.
 * These are the enum value strings used by @railgun-community/wallet.
 */
function resolveRailgunNetworkName(chainId: number): string | null {
  const map: Record<number, string> = {
    1: 'Ethereum',
    137: 'Polygon',
    56: 'BNBChain',
    42161: 'Arbitrum',
  }
  return map[chainId] ?? null
}

/**
 * Shield ERC-20 tokens into a Railgun private balance.
 *
 * Pre-conditions (any failure falls through to Thorchain):
 *   • `RAILGUN_DESTINATION_ADDRESS` — 0zk-prefixed Railgun encoded recipient address
 *   • `@railgun-community/wallet` installed as an optional dependency
 *   • Chain is one of: Ethereum (1), Polygon (137), BNB Chain (56), Arbitrum (42161)
 *
 * Flow:
 *   1. Approve the Railgun RailgunSmartWallet contract to spend `amount` of `token`.
 *   2. Call `populateShield` from the Railgun SDK to generate the calldata
 *      (no ZK proof needed for shielding — only unshielding requires proofs).
 *   3. Sign and broadcast the shield transaction from the execution wallet.
 *   4. Log the tx hash and return.
 *
 * On any failure, returns `{ ok: false, reason }` → caller falls back to Thorchain.
 */
async function tryRailgunDeposit(
  amount: bigint,
  token: Address,
  ctx: EvmSignerContext,
): Promise<{ ok: true; tx_hash: string } | { ok: false; reason: string }> {
  const railgunDest = process.env['RAILGUN_DESTINATION_ADDRESS']?.trim()
  if (!railgunDest) {
    return {
      ok: false,
      reason:
        'RAILGUN_DESTINATION_ADDRESS not configured — set to 0zk-prefixed Railgun encoded address',
    }
  }

  const networkName = resolveRailgunNetworkName(ctx.chainId)
  if (!networkName) {
    return { ok: false, reason: `Railgun not supported on chain ${ctx.chainId}` }
  }

  const railgunContract = RAILGUN_CONTRACTS[ctx.chainId]
  if (!railgunContract) {
    return { ok: false, reason: `No Railgun contract address for chain ${ctx.chainId}` }
  }

  // The shield private key is a 32-byte random scalar used to generate the
  // note commitment preimage.  Use RAILGUN_SHIELD_PRIVATE_KEY if provided,
  // or derive deterministically from the execution key (acceptable for server use).
  const shieldKeyHex = (
    process.env['RAILGUN_SHIELD_PRIVATE_KEY']?.trim().replace(/^0x/i, '') ||
    ctx.rawPrivKey.replace(/^0x/i, '')
  ).padStart(64, '0')

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walletModule: any = await aztecDynImport('@railgun-community/wallet').catch(() => null)
    if (!walletModule?.populateShield) {
      return {
        ok: false,
        reason:
          '@railgun-community/wallet not installed — run: pnpm add @railgun-community/wallet',
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { populateShield, EVMGasType } = walletModule

    const publicClient = createPublicClient({
      chain: ctx.chain,
      transport: http(ctx.rpcUrl, { timeout: 20_000 }),
    })
    const walletClient = createWalletClient({
      account: ctx.account,
      chain: ctx.chain,
      transport: http(ctx.rpcUrl, { timeout: 20_000 }),
    })

    // ── 1. Approve Railgun contract ─────────────────────────────────────────
    const currentAllowance = (await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [ctx.account.address, railgunContract],
    })) as bigint

    if (currentAllowance < amount) {
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [railgunContract, amount],
      })
      const approveTx = await sendEvmContractTx(ctx, { to: token, data: approveData })
      await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 90_000 })
      console.info(`[PRIVACY_MIXER] Railgun approval tx: ${approveTx}`)
    }

    // ── 2. Estimate current gas price ───────────────────────────────────────
    const [gasPrice, maxPriority] = await Promise.all([
      publicClient.getGasPrice(),
      publicClient.estimateMaxPriorityFeePerGas?.().catch(() => 1_000_000_000n) ?? 1_000_000_000n,
    ])
    const maxFee = (gasPrice * 130n) / 100n // 30 % buffer

    const gasDetails = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      evmGasType: EVMGasType?.Type2 ?? 2,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: maxPriority,
    }

    // ── 3. Populate shield calldata ─────────────────────────────────────────
    const erc20Amounts = [
      {
        tokenAddress: token.toLowerCase(),
        amount,
        recipientAddress: railgunDest,
      },
    ]

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const populated = await populateShield(
      networkName,
      shieldKeyHex,
      erc20Amounts,
      [], // no NFTs
      gasDetails,
    )

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const txTo = populated?.transaction?.to ?? populated?.to
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const txData = populated?.transaction?.data ?? populated?.data

    if (!txTo || !txData) {
      return { ok: false, reason: 'Railgun populateShield returned empty transaction' }
    }

    // ── 4. Sign and broadcast ───────────────────────────────────────────────
    const nonce = await publicClient.getTransactionCount({
      address: ctx.account.address,
      blockTag: 'pending',
    })
    const request = await walletClient.prepareTransactionRequest({
      account: ctx.account,
      to: txTo as Address,
      data: txData as Hex,
      chain: ctx.chain,
      nonce,
    } as unknown as Parameters<typeof walletClient.prepareTransactionRequest>[0])

    const signed = await walletClient.signTransaction({
      ...request,
      account: ctx.account,
      chain: ctx.chain,
    } as unknown as Parameters<typeof walletClient.signTransaction>[0])

    const txHash = await walletClient.sendRawTransaction({ serializedTransaction: signed })
    console.info(`[PRIVACY_MIXER] Railgun shield broadcast — tx: ${txHash}`)
    return { ok: true, tx_hash: txHash }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    console.warn(`[PRIVACY_MIXER] Railgun deposit failed: ${reason}`)
    return { ok: false, reason }
  }
}

type ThorchainQuote = {
  inbound_address?: string
  memo?: string
  expected_amount_out?: string
}

async function fetchThorchainQuote(params: {
  fromAsset: string
  toAsset: string
  amount: string
  destination: string
}): Promise<ThorchainQuote> {
  const base = resolveThornodeBase()
  const url = new URL(`${base}/thorchain/quote/swap`)
  url.searchParams.set('from_asset', params.fromAsset)
  url.searchParams.set('to_asset', params.toAsset)
  url.searchParams.set('amount', params.amount)
  url.searchParams.set('destination', params.destination)
  url.searchParams.set('affiliate_bps', '0')

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(25_000) })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Thorchain quote HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return (await res.json()) as ThorchainQuote
}

function resolveThorchainFromAsset(chainId: number, token: Address): string {
  const custom = process.env['PRIVACY_MIXER_THOR_FROM_ASSET']?.trim()
  if (custom) return custom
  if (chainId === 11155111) {
    return `ETH.USDC-${token}`
  }
  return `ETH.USDC-${token}`
}

async function executeThorchainEvmSwap(
  vault: Address,
  token: Address,
  amount: bigint,
  ctx: EvmSignerContext,
): Promise<{ ok: true; tx_hashes: Hex[] } | { ok: false; error: string }> {
  const xmrDest = resolveXmrDestination()
  if (!xmrDest) {
    return { ok: false, error: 'PRIVACY_MIXER_XMR_DESTINATION is not configured' }
  }

  const quote = await fetchThorchainQuote({
    fromAsset: resolveThorchainFromAsset(ctx.chainId, token),
    toAsset: process.env['PRIVACY_MIXER_THOR_TO_ASSET']?.trim() || 'XMR.XMR',
    amount: amount.toString(),
    destination: xmrDest,
  })

  const inbound = quote.inbound_address?.trim()
  if (!inbound || !isAddress(inbound)) {
    return { ok: false, error: 'Thorchain quote missing valid inbound_address' }
  }

  const txHashes: Hex[] = []
  const signerIsVault = ctx.account.address.toLowerCase() === vault.toLowerCase()

  if (!signerIsVault) {
    const pull = await ensureAllowanceAndPullFromVault(
      vault,
      token,
      amount,
      ctx.account.address,
      ctx,
    )
    if (pull.ok === false) return { ok: false, error: pull.error }
  }

  const transferFrom = signerIsVault ? vault : ctx.account.address
  const publicClient = createPublicClient({
    chain: ctx.chain,
    transport: http(ctx.rpcUrl, { timeout: 20_000 }),
  })
  const allowance = (await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [transferFrom, SWAP_ROUTER_02],
  })) as bigint

  if (allowance < amount) {
    const approveData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [SWAP_ROUTER_02, amount],
    })
    txHashes.push(await sendEvmContractTx(ctx, { to: token, data: approveData }))
  }

  const transferData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [getAddress(inbound), amount],
  })
  txHashes.push(await sendEvmContractTx(ctx, { to: token, data: transferData }))

  if (quote.memo) {
    console.info(`[PRIVACY_MIXER] Thorchain memo (verify router if ERC20): ${quote.memo}`)
  }

  return { ok: true, tx_hashes: txHashes }
}

async function executeEvmUniswapFallbackSwap(
  token: Address,
  amount: bigint,
  ctx: EvmSignerContext,
): Promise<Hex> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)
  const path =
    token.toLowerCase() === WETH_MAINNET.toLowerCase()
      ? [token, MAINNET_USDC]
      : [token, WETH_MAINNET]

  const data = encodeFunctionData({
    abi: SWAP_ROUTER_ABI,
    functionName: 'swapExactTokensForTokens',
    args: [amount, 0n, path, ctx.account.address, deadline],
  })
  return sendEvmContractTx(ctx, { to: SWAP_ROUTER_02, data })
}

/**
 * Lightweight direct-HTTP Telegram alert for privacy-mixer lane failures.
 * Uses TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars directly so the core
 * package has no dependency on the API telegram module.  Fire-and-forget.
 */
async function sendAztecFailureAlert(
  reason: string,
  vault: Address,
  amount: bigint,
  decimals: number,
): Promise<void> {
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim()
  const chatId =
    process.env['TELEGRAM_CHAT_ID']?.trim() ||
    process.env['TELEMETRY_CHAT_ID']?.trim() ||
    process.env['TELEGRAM_ALERT_CHAT_ID']?.trim()
  if (!token || !chatId) return

  const amountFmt = formatUnits(amount, decimals)
  const text =
    `⚠️ *Aztec deposit failed* — falling back to Thorchain\n` +
    `Vault: \`${vault}\`\n` +
    `Amount: ${amountFmt}\n` +
    `Reason: ${reason.slice(0, 300)}`

  const url = `https://api.telegram.org/bot${token}/sendMessage`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    signal: AbortSignal.timeout(8_000),
  }).catch((err: unknown) => {
    console.warn('[PRIVACY_MIXER] Telegram alert send failed:', err)
  })
}

export async function executeEvmPrivacySettlement(
  job: PrivacySettlementJob,
): Promise<PrivacySettlementResult> {
  const vaults = resolveSovereignVaultAddresses()
  const vaultRaw = job.vault_address?.trim() || vaults.evm
  if (!vaultRaw || !isAddress(vaultRaw)) {
    return { ok: false, funds_remain_in_vault: true, error: 'EVM vault address not configured' }
  }
  const vault = getAddress(vaultRaw)
  const chainId =
    job.chain_id ??
    Number.parseInt(process.env['PRIVACY_MIXER_EVM_CHAIN_ID']?.trim() ?? '1', 10)
  const ctx = await resolveEvmSigner(chainId)
  if (!ctx) {
    return {
      ok: false,
      funds_remain_in_vault: true,
      error: 'EVM privacy signer key not configured',
    }
  }

  const token = resolvePrivacyTokenAddress(chainId)
  const { balance, decimals } = await readVaultTokenBalance(vault, token, ctx)
  if (balance <= 0n) {
    return {
      ok: false,
      funds_remain_in_vault: true,
      error: `No ${token} balance on vault for privacy routing`,
    }
  }

  let amount = balance
  if (job.amount_raw?.trim()) {
    try {
      amount = BigInt(job.amount_raw.trim())
    } catch {
      amount = balance
    }
  }
  if (amount > balance) amount = balance

  const mixerType = readPrivacyMixerType()
  const txHashes: string[] = []

  const tryAztec = mixerType === 'aztec' || mixerType === 'auto'
  if (tryAztec) {
    const aztec = await tryAztecDeposit(ctx.rawPrivKey, amount, token, ctx)
    if (aztec.ok) {
      txHashes.push(aztec.tx_hash)
      return { ok: true, lane: 'aztec', tx_hashes: txHashes }
    }
    const aztecReason = 'reason' in aztec ? aztec.reason : 'unknown'
    console.warn(`[PRIVACY_MIXER] Aztec lane failed: ${aztecReason}`)
    // Emit a lightweight Telegram alert for the Aztec-specific failure before
    // falling through to the Thorchain lane.  Fire-and-forget — do not await.
    sendAztecFailureAlert(aztecReason, vault, amount, decimals).catch(() => undefined)
  }

  if (mixerType === 'railgun' || mixerType === 'auto') {
    const rail = await tryRailgunDeposit(amount, token, ctx)
    if (rail.ok) {
      txHashes.push(rail.tx_hash)
      return { ok: true, lane: 'railgun', tx_hashes: txHashes }
    }
    const railReason = 'reason' in rail ? rail.reason : 'unknown'
    if (mixerType === 'railgun') {
      // Explicit Railgun mode: alert before Thorchain fallback
      console.warn(`[PRIVACY_MIXER] Railgun lane failed: ${railReason}`)
      sendAztecFailureAlert(`Railgun: ${railReason}`, vault, amount, decimals).catch(() => undefined)
    }
  }

  const thor = await executeThorchainEvmSwap(vault, token, amount, ctx)
  if (thor.ok) {
    return {
      ok: true,
      lane: 'thorchain_xmr',
      tx_hashes: thor.tx_hashes,
      detail: `Routed ${formatUnits(amount, decimals)} tokens toward XMR via Thorchain`,
    }
  }
  const thorError = thor.ok === false ? thor.error : 'Thorchain swap failed'

  try {
    const pull = await ensureAllowanceAndPullFromVault(
      vault,
      token,
      amount,
      ctx.account.address,
      ctx,
    )
    if (pull.ok === false) {
      return {
        ok: false,
        funds_remain_in_vault: true,
        error: pull.error,
        lane: 'thorchain_xmr',
      }
    }
    const swapTx = await executeEvmUniswapFallbackSwap(token, amount, ctx)
    txHashes.push(swapTx)
    return {
      ok: true,
      lane: 'thorchain_xmr',
      tx_hashes: txHashes,
      detail: `Thorchain failed (${thorError}); executed Uniswap swap fallback on executor wallet`,
    }
  } catch (e) {
    return {
      ok: false,
      funds_remain_in_vault: true,
      error: e instanceof Error ? e.message : String(e),
      lane: mixerType,
    }
  }
}

async function executeSolPrivacySettlement(
  job: PrivacySettlementJob,
): Promise<PrivacySettlementResult> {
  // Route through the omnichain mixer SOL path (Jupiter→USDC + Thorchain→XMR)
  const { executeOmnichainPrivacyMixer } = await import('./omnichain-mixer.js')
  return executeOmnichainPrivacyMixer({ ...job, chain: 'SOL' })
}

async function executeTronPrivacySettlement(
  job: PrivacySettlementJob,
): Promise<PrivacySettlementResult> {
  // Route through the omnichain mixer TRON path (Thorchain TRX→XMR)
  const { executeOmnichainPrivacyMixer } = await import('./omnichain-mixer.js')
  return executeOmnichainPrivacyMixer({ ...job, chain: 'TRON' })
}

async function executeTonPrivacySettlement(
  job: PrivacySettlementJob,
): Promise<PrivacySettlementResult> {
  // Route through the omnichain mixer TON path (Dedust swap + Thorchain→XMR)
  const { executeOmnichainPrivacyMixer } = await import('./omnichain-mixer.js')
  return executeOmnichainPrivacyMixer({ ...job, chain: 'TON' })
}

function routingAllows(chain: PrivacySettlementChain): boolean {
  const routing = readPrivacyMixerRouting()
  if (!routing) return true
  return routing.includes(chain)
}

/**
 * Execute production privacy settlement for a single vault chain lane (real on-chain txs on EVM).
 */
export async function executePrivacySettlement(
  job: PrivacySettlementJob,
): Promise<PrivacySettlementResult> {
  if (!isPrivacyMixerEnabled()) {
    return {
      ok: false,
      funds_remain_in_vault: true,
      error: 'PRIVACY_MIXER_ENABLED is not true',
    }
  }

  if (!routingAllows(job.chain)) {
    return {
      ok: false,
      funds_remain_in_vault: true,
      error: `Chain ${job.chain} excluded by PRIVACY_MIXER_ROUTING`,
    }
  }

  const { executeOmnichainPrivacyMixer, isPrivacyMixerAllChainsEnabled } = await import(
    './omnichain-mixer.js',
  )
  if (isPrivacyMixerAllChainsEnabled()) {
    return executeOmnichainPrivacyMixer(job)
  }

  switch (job.chain) {
    case 'EVM':
      return executeEvmPrivacySettlement(job)
    case 'SOL':
      return executeSolPrivacySettlement(job)
    case 'TRON':
      return executeTronPrivacySettlement(job)
    case 'TON':
      return executeTonPrivacySettlement(job)
    case 'BTC':
      return executeOmnichainPrivacyMixer(job)
    default:
      return {
        ok: false,
        funds_remain_in_vault: true,
        error: `Unknown chain ${String(job.chain)}`,
      }
  }
}

/** Infer privacy chain lane from settlement protocol / chain_id string. */
export function inferPrivacyChainFromSettlement(params: {
  protocol?: string | null
  chain_id?: string | null
}): PrivacySettlementChain {
  const protocol = params.protocol?.trim().toLowerCase() ?? ''
  const chainId = params.chain_id?.trim().toLowerCase() ?? ''

  if (protocol.includes('sol') || chainId.includes('solana') || chainId === 'sol') return 'SOL'
  if (protocol.includes('tron') || chainId.includes('tron') || chainId === 'trx') return 'TRON'
  if (protocol.includes('ton') || chainId.includes('ton')) return 'TON'
  if (protocol.includes('btc') || protocol.includes('utxo') || chainId.includes('bip122')) {
    return 'BTC'
  }
  return 'EVM'
}

/** Build a mixing job payload after settlement success. */
export function buildPrivacySettlementJobFromSettlement(params: {
  wallet_address: string
  token_address?: string | null
  settlement_tx_hash?: string | null
  scout_value_usd?: number
  protocol?: string | null
  chain_id?: string | null
  amount?: string | null
}): PrivacySettlementJob | null {
  if (!isPrivacyMixerEnabled()) return null

  const vaults = resolveSovereignVaultAddresses()
  const chain = inferPrivacyChainFromSettlement({
    protocol: params.protocol,
    chain_id: params.chain_id,
  })

  let vault_address = params.wallet_address
  if (chain === 'EVM' && vaults.evm) vault_address = vaults.evm
  if (chain === 'SOL' && vaults.svm) vault_address = vaults.svm
  if (chain === 'TRON' && vaults.tron) vault_address = vaults.tron
  if (chain === 'TON' && vaults.ton) vault_address = vaults.ton
  if (chain === 'BTC' && vaults.btc) vault_address = vaults.btc

  const chain_id_num = Number.parseInt(
    params.chain_id?.replace(/^eip155:/i, '') ?? '',
    10,
  )

  return {
    chain,
    vault_address,
    ...(params.token_address ? { token_address: params.token_address } : {}),
    ...(params.settlement_tx_hash ? { settlement_tx_hash: params.settlement_tx_hash } : {}),
    ...(params.amount ? { amount_raw: params.amount } : {}),
    ...(Number.isFinite(chain_id_num) ? { chain_id: chain_id_num } : {}),
    ...(params.scout_value_usd != null ? { scout_value_usd: params.scout_value_usd } : {}),
  }
}
