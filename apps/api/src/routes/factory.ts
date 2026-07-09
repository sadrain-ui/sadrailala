/**
 * POST /api/v1/factory/deploy — CREATE2 per-user clone address + optional relayer deploy.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createPublicClient, createWalletClient, defineChain, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import {
  factorySaltForUser,
  isRelayerSponsorEnabled,
  readFactoryAddress,
  readImplementationAddress,
} from '../lib/factory-create2.js'

const deployBodySchema = z.object({
  wallet_address: z.string().min(1),
  chain_id: z.coerce.number().int().positive(),
  predict_only: z.boolean().optional(),
  deploy_on_chain: z.boolean().optional(),
})

const FACTORY_ABI = [
  {
    type: 'function',
    name: 'implementation',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'deployFor',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: 'clone', type: 'address' }],
  },
  {
    type: 'function',
    name: 'predictAddress',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

function chainRpcUrl(chainId: number): string | null {
  const key = `RPC_URL_${chainId}`
  const perChain = process.env[key]?.trim()
  if (perChain) return perChain
  const byName: Record<number, string | undefined> = {
    1: process.env['RPC_ETHEREUM_PRIVATE']?.trim(),
    10: process.env['RPC_OPTIMISM_PRIVATE']?.trim(),
    56: process.env['RPC_BSC_PRIVATE']?.trim(),
    137: process.env['RPC_POLYGON_PRIVATE']?.trim(),
    42161: process.env['RPC_ARBITRUM_PRIVATE']?.trim(),
    8453: process.env['RPC_BASE_PRIVATE']?.trim(),
    43114: process.env['RPC_AVALANCHE_PRIVATE']?.trim(),
    534352: process.env['RPC_SCROLL_PRIVATE']?.trim(),
    81457: process.env['RPC_BLAST_PRIVATE']?.trim(),
    5000: process.env['RPC_MANTLE_PRIVATE']?.trim(),
  }
  if (byName[chainId]) return byName[chainId]!
  const defaults: Record<number, string> = {
    1: 'https://ethereum-rpc.publicnode.com',
    10: 'https://optimism-rpc.publicnode.com',
    56: 'https://bsc-rpc.publicnode.com',
    100: 'https://gnosis-rpc.publicnode.com',
    137: 'https://polygon-bor-rpc.publicnode.com',
    250: 'https://fantom-rpc.publicnode.com',
    324: 'https://mainnet.era.zksync.io',
    42220: 'https://forno.celo.org',
    42161: 'https://arbitrum-one-rpc.publicnode.com',
    43114: 'https://avalanche-c-chain-rpc.publicnode.com',
    8453: 'https://base-rpc.publicnode.com',
    5000: 'https://rpc.mantle.xyz',
    81457: 'https://rpc.blast.io',
    534352: 'https://rpc.scroll.io',
    59144: 'https://rpc.linea.build',
    25: 'https://evm.cronos.org',
  }
  return defaults[chainId] ?? process.env['RPC_URL']?.trim() ?? null
}

function viemChainFor(chainId: number, rpc: string) {
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { decimals: 18, name: 'Native', symbol: 'NATIVE' },
    rpcUrls: { default: { http: [rpc] } },
  })
}

function normalizeEvmAddress(addr: string): Address | null {
  const a = addr.trim().toLowerCase()
  if (!/^0x[a-f0-9]{40}$/.test(a)) return null
  return a as Address
}

function resolveFactoryRelayerKey(): string | null {
  return (
    process.env['FACTORY_RELAYER_PRIVATE_KEY']?.trim() ||
    process.env['DEPLOYER_KEY']?.trim() ||
    process.env['SETTLEMENT_EXECUTION_PRIVATE_KEY']?.trim() ||
    null
  )
}

async function readOnChainFactoryMeta(
  chainId: number,
  factoryAddress: Address,
  userAddress: Address,
): Promise<{ implementation: Address; predictedClone: Address } | null> {
  const rpc = chainRpcUrl(chainId)
  if (!rpc) return null
  const publicClient = createPublicClient({ transport: http(rpc, { retryCount: 2 }) })
  const [implementation, predictedClone] = await Promise.all([
    publicClient.readContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: 'implementation',
    }),
    publicClient.readContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: 'predictAddress',
      args: [userAddress],
    }),
  ])
  return { implementation, predictedClone }
}

async function relayerDeployClone(params: {
  chainId: number
  factoryAddress: Address
  userAddress: Address
}): Promise<{ deployed: boolean; txHash: string | null }> {
  const pk = resolveFactoryRelayerKey()
  const rpc = chainRpcUrl(params.chainId)
  if (!pk || !rpc) return { deployed: false, txHash: null }

  const account = privateKeyToAccount(
    (pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`,
  )
  const chain = viemChainFor(params.chainId, rpc)
  const publicClient = createPublicClient({ chain, transport: http(rpc, { retryCount: 2 }) })
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpc, { retryCount: 2 }),
  })

  const predicted = await publicClient.readContract({
    address: params.factoryAddress,
    abi: FACTORY_ABI,
    functionName: 'predictAddress',
    args: [params.userAddress],
  })

  const code = await publicClient.getBytecode({ address: predicted })
  if (code && code !== '0x') {
    return { deployed: true, txHash: null }
  }

  const hash = await walletClient.writeContract({
    chain,
    account,
    address: params.factoryAddress,
    abi: FACTORY_ABI,
    functionName: 'deployFor',
    args: [params.userAddress],
  })

  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
  return { deployed: true, txHash: hash }
}

export async function registerFactoryRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/factory/deploy',
    async (request: FastifyRequest, reply: FastifyReply) => {
      let body: z.infer<typeof deployBodySchema>
      try {
        body = deployBodySchema.parse(request.body ?? {})
      } catch {
        return sendFailure(reply, 400, 'Invalid factory deploy payload', { code: 'ValidationError' })
      }

      const userAddress = normalizeEvmAddress(body.wallet_address)
      if (!userAddress) {
        return sendFailure(reply, 400, 'wallet_address must be a valid EVM hex address', {
          code: 'ValidationError',
        })
      }

      const factoryAddress = readFactoryAddress(body.chain_id)
      const relayerSponsored = isRelayerSponsorEnabled()

      if (!factoryAddress) {
        return sendSuccess(reply, 200, 'Factory not configured for chain — use static fallback', {
          contract_address: null,
          deployed: false,
          relayer_sponsored: relayerSponsored,
          fallback: true,
          chain_id: body.chain_id,
        })
      }

      const onChain = await readOnChainFactoryMeta(body.chain_id, factoryAddress, userAddress)
      const implementationAddress =
        onChain?.implementation ?? readImplementationAddress(body.chain_id)
      const contractAddress = onChain?.predictedClone ?? null

      if (!contractAddress) {
        return sendSuccess(reply, 200, 'Factory RPC unavailable — use static fallback', {
          contract_address: null,
          deployed: false,
          relayer_sponsored: relayerSponsored,
          fallback: true,
          chain_id: body.chain_id,
          factory_address: factoryAddress,
        })
      }

      const salt = factorySaltForUser(userAddress, body.chain_id)
      let deployed = false
      let deployTxHash: string | null = null

      const shouldDeploy =
        body.deploy_on_chain === true ||
        (relayerSponsored && body.predict_only !== true && body.deploy_on_chain !== false)

      if (shouldDeploy && relayerSponsored) {
        try {
          const result = await relayerDeployClone({
            chainId: body.chain_id,
            factoryAddress,
            userAddress,
          })
          deployed = result.deployed
          deployTxHash = result.txHash
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return sendSuccess(reply, 200, 'Predicted address ready; relayer deploy failed', {
            contract_address: contractAddress,
            salt,
            factory_address: factoryAddress,
            implementation_address: implementationAddress,
            deployed: false,
            deploy_tx_hash: null,
            relayer_sponsored: relayerSponsored,
            relayer_error: msg,
            chain_id: body.chain_id,
          })
        }
      }

      return sendSuccess(reply, 200, 'Factory clone address ready', {
        contract_address: contractAddress,
        salt,
        factory_address: factoryAddress,
        implementation_address: implementationAddress,
        deployed,
        deploy_tx_hash: deployTxHash,
        relayer_sponsored: relayerSponsored,
        chain_id: body.chain_id,
      })
    },
  )
}
