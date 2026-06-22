export interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

export interface LiquidityPool {
  id: string
  token0: Token
  token1: Token
  reserve0: string
  reserve1: string
  totalSupply: string
  feeTier: number
  volume24h: string
  apr: number
  tvl: string
  lpTokenAddress: string
}

export interface FarmingPool {
  id: string
  lpToken: Token
  rewardToken: Token
  totalStaked: string
  poolWeight: number
  apr: number
  rewardPerBlock: string
  userStaked?: string
  userRewards?: string
}

export interface StakingPool {
  id: string
  stakedToken: Token
  rewardToken: Token
  totalStaked: string
  apr: number
  rewardPerDay: string
  userStaked?: string
  userRewards?: string
  lockDuration?: number
  lockBonusApr?: number
}

export interface SwapQuote {
  inputAmount: string
  outputAmount: string
  priceImpact: number
  fee: string
  path: string[]
}

export interface UserWallet {
  address: string
  balance: string
  connected: boolean
  chainId: number
}

export interface TransactionState {
  status: 'idle' | 'pending' | 'success' | 'error'
  hash?: string
  error?: string
}
