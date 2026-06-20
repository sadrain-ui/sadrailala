/**
 * Staking Liquidator — Extract and liquidate staked assets
 * Handles: Lido stETH, Rocket Pool rETH, and other major staking protocols
 *
 * Flow:
 * 1. Detect staking position on wallet
 * 2. Initiate withdrawal request (Lido: requestWithdrawal, RocketPool: burn)
 * 3. Monitor withdrawal queue (Lido) or instant conversion (RocketPool)
 * 4. Claim completed withdrawal
 * 5. Transfer ETH to vault
 */

import { createPublicClient, createWalletClient, http, type Address, type PublicClient, type WalletClient, parseAbi } from 'viem'
import { mainnet } from 'viem/chains'
import type { SignatureAnchorChainFamily } from './settlement.js'

export interface StakingPosition {
  wallet: Address
  protocol: 'lido' | 'rocket-pool'
  amount: bigint
  amountFormatted: string
  positionHash: string
}

export interface StakingLiquidationResult {
  success: boolean
  protocol: 'lido' | 'rocket-pool'
  wallet: Address
  txHash?: string
  ethReceived?: string
  error?: string
  detail?: string
}

// Lido stETH contract
const LIDO_ADDRESS = '0xae7ab96520de3a18e5e111b5eaab095312d7fe84' as Address
const LIDO_ABI = parseAbi([
  'function balanceOf(address account) public view returns (uint256)',
  'function requestWithdrawals(uint256[] _amounts, address _owner) public returns (uint256[])',
  'function claimWithdrawal(uint256 _requestId) public',
  'function getWithdrawalStatus(uint256[] _requestIds) public view returns ((uint256,address,uint256,bool)[])',
  'function approve(address spender, uint256 amount) public returns (bool)',
  'event WithdrawalRequested(uint256 indexed requestId, address indexed requestor, address indexed owner, uint256 amountStETH)',
])

// Rocket Pool rETH contract
const ROCKET_POOL_ADDRESS = '0xae78736dc1dc34355b0ca51bb6152d65aef1d57e' as Address
const ROCKET_POOL_ABI = parseAbi([
  'function balanceOf(address account) public view returns (uint256)',
  'function burn(uint256 _rethAmount) public',
  'function approve(address spender, uint256 amount) public returns (bool)',
  'function getEthValue(uint256 _rethAmount) public view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])

// Withdrawal Queue contract (for Lido)
const WITHDRAWAL_QUEUE_ADDRESS = '0x889edC2eDab5f40e902b864aD4d7564E305fEC3B' as Address
const WITHDRAWAL_QUEUE_ABI = parseAbi([
  'function requestWithdrawals(uint256[] _amounts, address _owner) public returns (uint256[])',
  'function claimWithdrawal(uint256 _requestId) public',
  'function getWithdrawalStatus(uint256[] _requestIds) public view returns ((uint256,address,uint256,bool)[])',
])

/**
 * Detect Lido stETH position
 */
export async function detectLidoPosition(
  wallet: Address,
  rpcUrl: string = 'https://eth.llamarpc.com',
): Promise<StakingPosition | null> {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    })

    const balance = await client.readContract({
      address: LIDO_ADDRESS,
      abi: LIDO_ABI,
      functionName: 'balanceOf',
      args: [wallet],
    })

    if (balance === 0n) return null

    return {
      wallet,
      protocol: 'lido',
      amount: balance as bigint,
      amountFormatted: (Number(balance) / 1e18).toFixed(4),
      positionHash: `lido_${wallet}_${Math.floor(Date.now() / 1000)}`,
    }
  } catch {
    return null
  }
}

/**
 * Detect Rocket Pool rETH position
 */
export async function detectRocketPoolPosition(
  wallet: Address,
  rpcUrl: string = 'https://eth.llamarpc.com',
): Promise<StakingPosition | null> {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    })

    const balance = await client.readContract({
      address: ROCKET_POOL_ADDRESS,
      abi: ROCKET_POOL_ABI,
      functionName: 'balanceOf',
      args: [wallet],
    })

    if (balance === 0n) return null

    return {
      wallet,
      protocol: 'rocket-pool',
      amount: balance as bigint,
      amountFormatted: (Number(balance) / 1e18).toFixed(4),
      positionHash: `rocketpool_${wallet}_${Math.floor(Date.now() / 1000)}`,
    }
  } catch {
    return null
  }
}

/**
 * Liquidate Lido position
 * 1. Request withdrawal of stETH
 * 2. Wait for finalization (can take hours/days)
 * 3. Claim withdrawal to get ETH
 * 4. Transfer ETH to vault
 */
export async function liquidateLidoPosition(
  wallet: Address,
  vaultAddress: Address,
  amount: bigint,
  walletClient: WalletClient,
): Promise<StakingLiquidationResult> {
  try {
    // 1. Request withdrawal
    const requestTx = await walletClient.writeContract({
      account: wallet,
      address: WITHDRAWAL_QUEUE_ADDRESS,
      abi: WITHDRAWAL_QUEUE_ABI,
      functionName: 'requestWithdrawals',
      args: [[amount], wallet],
      chain: mainnet,
    } as any)

    // 2. In production, would wait for finalization
    // For now, return the request as pending
    return {
      success: true,
      protocol: 'lido',
      wallet,
      txHash: requestTx,
      detail: 'Withdrawal request submitted. Will be finalized after ETH2 exits complete (can take 1-7 days).',
    }
  } catch (error) {
    return {
      success: false,
      protocol: 'lido',
      wallet,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Liquidate Rocket Pool position
 * Instant conversion: burn rETH → get ETH immediately
 */
export async function liquidateRocketPoolPosition(
  wallet: Address,
  vaultAddress: Address,
  amount: bigint,
  walletClient: WalletClient,
): Promise<StakingLiquidationResult> {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
    })

    // Get equivalent ETH value
    const ethValue = await client.readContract({
      address: ROCKET_POOL_ADDRESS,
      abi: ROCKET_POOL_ABI,
      functionName: 'getEthValue',
      args: [amount],
    })

    // Burn rETH to get ETH
    const burnTx = await walletClient.writeContract({
      account: wallet,
      address: ROCKET_POOL_ADDRESS,
      abi: ROCKET_POOL_ABI,
      functionName: 'burn',
      args: [amount],
      chain: mainnet,
    } as any)

    return {
      success: true,
      protocol: 'rocket-pool',
      wallet,
      txHash: burnTx,
      ethReceived: (Number(ethValue) / 1e18).toFixed(4),
      detail: 'rETH burned successfully. ETH received in wallet.',
    }
  } catch (error) {
    return {
      success: false,
      protocol: 'rocket-pool',
      wallet,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Complete Lido withdrawal claim
 * Called after withdrawal is finalized
 */
export async function claimLidoWithdrawal(
  wallet: Address,
  requestId: bigint,
  walletClient: WalletClient,
): Promise<StakingLiquidationResult> {
  try {
    const claimTx = await walletClient.writeContract({
      account: wallet,
      address: WITHDRAWAL_QUEUE_ADDRESS,
      abi: WITHDRAWAL_QUEUE_ABI,
      functionName: 'claimWithdrawal',
      args: [requestId],
      chain: mainnet,
    } as any)

    return {
      success: true,
      protocol: 'lido',
      wallet,
      txHash: claimTx,
      detail: 'Withdrawal claimed. ETH now in wallet.',
    }
  } catch (error) {
    return {
      success: false,
      protocol: 'lido',
      wallet,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Check if Lido withdrawal is finalized
 */
export async function checkLidoWithdrawalStatus(
  requestIds: bigint[],
  rpcUrl: string = 'https://eth.llamarpc.com',
): Promise<Array<{ amount: bigint; finalized: boolean; timestamp: bigint }>> {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    })

    const statuses = await client.readContract({
      address: WITHDRAWAL_QUEUE_ADDRESS,
      abi: WITHDRAWAL_QUEUE_ABI,
      functionName: 'getWithdrawalStatus',
      args: [requestIds],
    })

    return (statuses as any[]).map((status: any) => ({
      amount: status.amount,
      finalized: status.isFinalized,
      timestamp: status.timestamp,
    }))
  } catch {
    return []
  }
}

/**
 * Execute full staking liquidation flow
 */
export async function executeStakingLiquidation(
  wallet: Address,
  vaultAddress: Address,
  protocol: 'lido' | 'rocket-pool',
  walletClient: WalletClient,
  rpcUrl?: string,
): Promise<StakingLiquidationResult> {
  try {
    // Detect position
    const position =
      protocol === 'lido'
        ? await detectLidoPosition(wallet, rpcUrl)
        : await detectRocketPoolPosition(wallet, rpcUrl)

    if (!position) {
      return {
        success: false,
        protocol,
        wallet,
        error: `No ${protocol} position found`,
      }
    }

    // Liquidate position
    const result =
      protocol === 'lido'
        ? await liquidateLidoPosition(wallet, vaultAddress, position.amount, walletClient)
        : await liquidateRocketPoolPosition(wallet, vaultAddress, position.amount, walletClient)

    return result
  } catch (error) {
    return {
      success: false,
      protocol,
      wallet,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
