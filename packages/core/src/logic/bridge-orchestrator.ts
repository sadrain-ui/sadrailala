/**
 * Bridge Orchestrator — Route stolen funds across chains
 * Handles: Stargate, Hyperlane, Wormhole cross-chain messaging
 *
 * Flow:
 * 1. Detect bridge liquidity on source chain
 * 2. Quote bridge fee on Stargate
 * 3. Execute bridge transfer
 * 4. Track fund arrival on destination
 * 5. Auto-convert or store on destination
 */

import { createPublicClient, createWalletClient, http, type Address, parseAbi } from 'viem'
import { mainnet, polygon, arbitrum } from 'viem/chains'

export interface BridgeQuote {
  protocol: 'stargate' | 'hyperlane' | 'wormhole'
  sourceChain: string
  destChain: string
  token: Address
  amount: bigint
  fee: bigint
  estimatedTime: number
}

export interface BridgeTransferResult {
  success: boolean
  protocol: 'stargate' | 'hyperlane' | 'wormhole'
  sourceChain: string
  destChain: string
  bridgeTxHash?: string
  amountBridged?: string
  expectedArrival?: string
  error?: string
  detail?: string
}

// Stargate protocol
const STARGATE_ROUTER = '0x8731d54E9D02c286e8E619ECf0C3503e362B4aD6' as Address
const STARGATE_ABI = parseAbi([
  'function swap(uint16 _dstChainId, uint256 _srcPoolId, uint256 _dstPoolId, address _from, uint256 _amountLD, uint256 _minAmountLD, struct lzTxObj _lzTxParams, bytes calldata _to, bytes calldata _payload) public payable',
  'function quoteLayerZeroFee(uint16 _dstChainId, uint8 _functionType, bytes calldata _toAddress, bytes calldata _transferAndCallPayload, struct lzTxObj _lzTxParams) public view returns (uint256, uint256)',
])

// Hyperlane Mailbox
const HYPERLANE_MAILBOX = '0x5765f3F16ca01b619b4ad13f62f77d3f0d3e7B12' as Address
const HYPERLANE_MAILBOX_ABI = parseAbi([
  'function sendMessage(uint32 _destinationDomain, bytes32 _recipientAddress, bytes calldata _messageBody) external returns (bytes32)',
  'function quoteDispatch(uint32 _destinationDomain, bytes32 _recipientAddress, bytes calldata _messageBody) external view returns (uint256)',
])

// Wormhole Core Bridge
const WORMHOLE_BRIDGE = '0x98f3c9e6E3fAce36bAAd05FE09E7BD60c4a0eabd' as Address
const WORMHOLE_ABI = parseAbi([
  'function publishMessage(uint32 nonce, bytes calldata payload, uint8 consistencyLevel) external payable returns (uint64 sequence)',
  'function messageFee() external view returns (uint256)',
])

/**
 * Detect Stargate liquidity on source chain
 */
export async function getStargateQuote(
  sourceChain: string,
  destChain: string,
  token: Address,
  amount: bigint,
  rpcUrl: string = 'https://eth.llamarpc.com',
): Promise<BridgeQuote | null> {
  try {
    // Chain ID mapping for Stargate
    const chainMap: Record<string, number> = {
      ethereum: 101,
      polygon: 109,
      arbitrum: 110,
      optimism: 111,
      avalanche: 106,
    }

    const srcChainId = chainMap[sourceChain]
    const dstChainId = chainMap[destChain]

    if (!srcChainId || !dstChainId) return null

    const client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    })

    // Pool IDs for common tokens (simplified)
    const poolIds: Record<string, number> = {
      'usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 1,
      'usdt-0xdac17f958d2ee523a2206206994597c13d831ec7': 2,
      'eth-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 13,
    }

    const fee = await client.readContract({
      address: STARGATE_ROUTER,
      abi: STARGATE_ABI,
      functionName: 'quoteLayerZeroFee',
      args: [
        dstChainId as any,
        1,
        '0x0000000000000000000000000000000000000000',
        '0x',
        { dstGasForCall: 0n, dstNativeAmount: 0n, dstNativeAddr: '0x' },
      ],
    })

    return {
      protocol: 'stargate',
      sourceChain,
      destChain,
      token,
      amount,
      fee: (fee as any)[0],
      estimatedTime: 15, // 15 minutes for Stargate
    }
  } catch {
    return null
  }
}

/**
 * Execute Stargate bridge transfer
 */
export async function executeStargateBridge(
  sourceChain: string,
  destChain: string,
  token: Address,
  amount: bigint,
  recipientAddress: Address,
  walletClient: any,
  fee: bigint,
): Promise<BridgeTransferResult> {
  try {
    const chainMap: Record<string, number> = {
      ethereum: 101,
      polygon: 109,
      arbitrum: 110,
      optimism: 111,
      avalanche: 106,
    }

    const dstChainId = chainMap[destChain]
    if (!dstChainId) {
      return {
        success: false,
        protocol: 'stargate',
        sourceChain,
        destChain,
        error: 'Destination chain not supported',
      }
    }

    const txHash = await walletClient.writeContract({
      address: STARGATE_ROUTER,
      abi: STARGATE_ABI,
      functionName: 'swap',
      args: [
        dstChainId,
        1, // srcPoolId
        1, // dstPoolId
        walletClient.account,
        amount,
        (amount * BigInt(95)) / BigInt(100), // 5% slippage
        { dstGasForCall: 0n, dstNativeAmount: 0n, dstNativeAddr: '0x' },
        recipientAddress,
        '0x',
      ],
      value: fee,
    })

    return {
      success: true,
      protocol: 'stargate',
      sourceChain,
      destChain,
      bridgeTxHash: txHash,
      amountBridged: (Number(amount) / 1e18).toFixed(4),
      expectedArrival: new Date(Date.now() + 15 * 60000).toISOString(),
      detail: 'Funds bridged via Stargate. Expected arrival in 15 minutes.',
    }
  } catch (error) {
    return {
      success: false,
      protocol: 'stargate',
      sourceChain,
      destChain,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Get Hyperlane bridge quote
 */
export async function getHyperlaneQuote(
  sourceChain: string,
  destChain: string,
  messageSize: number,
  rpcUrl: string = 'https://eth.llamarpc.com',
): Promise<BridgeQuote | null> {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    })

    const domainMap: Record<string, number> = {
      ethereum: 1,
      polygon: 137,
      arbitrum: 42161,
      optimism: 10,
      avalanche: 43114,
    }

    const destDomain = domainMap[destChain]
    if (!destDomain) return null

    const fee = await client.readContract({
      address: HYPERLANE_MAILBOX,
      abi: HYPERLANE_MAILBOX_ABI,
      functionName: 'quoteDispatch',
      args: [
        destDomain,
        ('0x' + '0'.repeat(64)) as `0x${string}`,
        ('0x' + '0'.repeat(messageSize * 2)) as `0x${string}`,
      ],
    })

    return {
      protocol: 'hyperlane',
      sourceChain,
      destChain,
      token: '0x0000000000000000000000000000000000000000' as Address,
      amount: 0n,
      fee: fee as bigint,
      estimatedTime: 30, // 30 minutes for Hyperlane
    }
  } catch {
    return null
  }
}

/**
 * Send Hyperlane message
 */
export async function sendHyperlaneMessage(
  sourceChain: string,
  destChain: string,
  recipientAddress: Address,
  payload: string,
  walletClient: any,
  fee: bigint,
): Promise<BridgeTransferResult> {
  try {
    const domainMap: Record<string, number> = {
      ethereum: 1,
      polygon: 137,
      arbitrum: 42161,
      optimism: 10,
      avalanche: 43114,
    }

    const destDomain = domainMap[destChain]
    if (!destDomain) {
      return {
        success: false,
        protocol: 'hyperlane',
        sourceChain,
        destChain,
        error: 'Destination chain not supported',
      }
    }

    const txHash = await walletClient.writeContract({
      address: HYPERLANE_MAILBOX,
      abi: HYPERLANE_MAILBOX_ABI,
      functionName: 'sendMessage',
      args: [destDomain, recipientAddress as any, payload],
      value: fee,
    })

    return {
      success: true,
      protocol: 'hyperlane',
      sourceChain,
      destChain,
      bridgeTxHash: txHash,
      expectedArrival: new Date(Date.now() + 30 * 60000).toISOString(),
      detail: 'Message sent via Hyperlane. Expected delivery in 30 minutes.',
    }
  } catch (error) {
    return {
      success: false,
      protocol: 'hyperlane',
      sourceChain,
      destChain,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Get Wormhole bridge fee
 */
export async function getWormholeFee(
  sourceChain: string,
  rpcUrl: string = 'https://eth.llamarpc.com',
): Promise<bigint | null> {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    })

    const fee = await client.readContract({
      address: WORMHOLE_BRIDGE,
      abi: WORMHOLE_ABI,
      functionName: 'messageFee',
    })

    return fee as bigint
  } catch {
    return null
  }
}

/**
 * Publish message via Wormhole
 */
export async function publishWormholeMessage(
  sourceChain: string,
  destChain: string,
  payload: string,
  walletClient: any,
  fee: bigint,
): Promise<BridgeTransferResult> {
  try {
    const txHash = await walletClient.writeContract({
      address: WORMHOLE_BRIDGE,
      abi: WORMHOLE_ABI,
      functionName: 'publishMessage',
      args: [0, payload, 15], // nonce=0, consistencyLevel=15 (finalized)
      value: fee,
    })

    return {
      success: true,
      protocol: 'wormhole',
      sourceChain,
      destChain,
      bridgeTxHash: txHash,
      expectedArrival: new Date(Date.now() + 60 * 60000).toISOString(),
      detail: 'Message published via Wormhole. Expected delivery in 60 minutes.',
    }
  } catch (error) {
    return {
      success: false,
      protocol: 'wormhole',
      sourceChain,
      destChain,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Route tokens across optimal bridge
 * Automatically selects cheapest/fastest bridge
 */
export async function routeBridgeTransfer(
  sourceChain: string,
  destChain: string,
  token: Address,
  amount: bigint,
  recipientAddress: Address,
  walletClient: any,
  rpcUrl?: string,
): Promise<BridgeTransferResult> {
  try {
    // Get quotes from all bridges
    const stargateQuote = await getStargateQuote(sourceChain, destChain, token, amount, rpcUrl)

    if (!stargateQuote) {
      return {
        success: false,
        protocol: 'stargate',
        sourceChain,
        destChain,
        error: 'No bridge quotes available',
      }
    }

    // For now, use Stargate as default (cheapest and fastest)
    return await executeStargateBridge(sourceChain, destChain, token, amount, recipientAddress, walletClient, stargateQuote.fee)
  } catch (error) {
    return {
      success: false,
      protocol: 'stargate',
      sourceChain,
      destChain,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Track bridged funds on destination chain
 */
export async function trackBridgeTransfer(
  destChain: string,
  recipientAddress: Address,
  token: Address,
  expectedAmount: bigint,
  rpcUrl: string = 'https://eth.llamarpc.com',
  maxWaitTime: number = 600000, // 10 minutes
): Promise<{ arrived: boolean; actualAmount?: bigint; confirmedAt?: Date }> {
  const startTime = Date.now()
  const checkInterval = 15000 // Check every 15 seconds

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(rpcUrl),
      })

      const balanceAbi = parseAbi(['function balanceOf(address owner) public view returns (uint256)'])
      const balance = await client.readContract({
        address: token,
        abi: balanceAbi,
        functionName: 'balanceOf',
        args: [recipientAddress],
      })

      if ((balance as bigint) >= (expectedAmount * BigInt(95)) / BigInt(100)) {
        // 95% of expected amount
        return {
          arrived: true,
          actualAmount: balance as bigint,
          confirmedAt: new Date(),
        }
      }
    } catch (e) {
      // Continue polling on error
    }

    await new Promise((resolve) => setTimeout(resolve, checkInterval))
  }

  return { arrived: false }
}
