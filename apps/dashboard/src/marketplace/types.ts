/**
 * OpenSea NFT Marketplace Clone - Type Definitions
 */

export type WalletType = 'metamask' | 'walletconnect' | 'trezor'

export interface WalletConnection {
  address: string
  chainId: number
  walletType: WalletType
  isConnected: boolean
  balance?: string
}

export interface NFTCollection {
  id: string
  address: string
  name: string
  symbol?: string
  imageUrl?: string
  floorPrice?: string
  totalVolume?: string
  itemCount?: number
  ownerCount?: number
}

export interface NFTAsset {
  id: string
  contract: string
  tokenId: string
  name: string
  description?: string
  imageUrl?: string
  standard: 'erc721' | 'erc1155'
  owner?: string
  rarity?: string
  attributes?: NFTAttribute[]
}

export interface NFTAttribute {
  trait: string
  value: string
  rarity?: number
}

export interface NFTListing {
  id: string
  asset: NFTAsset
  seller: string
  price: string
  priceUSD?: string
  currency: string
  orderHash?: string
  seaportOrder?: SeaportOrderData
  expiresAt?: number
  status: 'active' | 'cancelled' | 'sold'
  createdAt: number
  updatedAt: number
}

export interface NFTOffer {
  id: string
  asset: NFTAsset
  offerer: string
  amount: string
  amountUSD?: string
  currency: string
  expiresAt?: number
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled'
  createdAt: number
}

export interface SeaportOrderData {
  parameters: {
    offerer: string
    zone: string
    offer: Array<{
      itemType: number
      token: string
      identifierOrCriteria: string
      startAmount: string
      endAmount: string
    }>
    consideration: Array<{
      itemType: number
      token: string
      identifierOrCriteria: string
      startAmount: string
      endAmount: string
      recipient: string
    }>
    orderType: number
    startTime: number
    endTime: number
    zoneHash: string
    salt: string
    conduitKey: string
    counter: number
  }
  signature?: string
}

export interface Transaction {
  hash: string
  from: string
  to?: string
  value?: string
  status: 'pending' | 'confirmed' | 'failed'
  type: 'listing_created' | 'offer_placed' | 'order_fulfilled' | 'approval'
  timestamp: number
}

export interface MarketplaceStats {
  totalVolume: string
  totalSales: number
  activeListings: number
  activeOffers: number
  floorPrice?: string
  topCollection?: NFTCollection
}

// Lending Protocol Types
export interface LendingMarket {
  id: string
  name: string
  symbol: string
  decimals: number
  underlyingAddress: string
  aTokenAddress: string
  collateralFactor: string
  liquidationThreshold: string
  liquidationBonus: string
  ltv: number
  isActive: boolean
  borrowingEnabled: boolean
  totalSupply: string
  totalBorrows: string
  utilizationRate: string
  rates?: {
    liquidityRate: string
    variableBorrowRate: string
    stableBorrowRate: string
  }
}

export interface UserAccountData {
  user: string
  totalCollateralUsd: string
  totalBorrowsUsd: string
  availableBorrowsUsd: string
  currentLiquidationThreshold: string
  ltv: string
  healthFactor: string
  isInIsolationMode: boolean
}

export interface UserReserveData {
  marketId: string
  underlyingBalance: string
  aTokenBalance: string
  variableDebtBalance: string
  stableDebtBalance: string
  totalDebt: string
  usageAsCollateralEnabled: boolean
  stableBorrowRate: string
}

export interface LendingTransaction {
  type: 'deposit' | 'withdraw' | 'borrow' | 'repay'
  marketId: string
  amount: string
  user: string
  timestamp: number
  txHash?: string
  status: 'pending' | 'confirmed' | 'failed'
}
