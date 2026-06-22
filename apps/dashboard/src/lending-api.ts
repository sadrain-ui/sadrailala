import type {
  ApiEnvelope,
  DashboardConfig,
} from './types.js'
import type {
  LendingMarket,
  UserAccountData,
  UserReserveData,
} from './marketplace/types.js'

async function request<T>(
  config: DashboardConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const base = config.apiBase.replace(/\/$/, '')
  const url = base ? `${base}${path}` : path
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  if (config.apiKey) {
    headers.set('X-API-Key', config.apiKey)
  }

  const res = await fetch(url, { ...init, headers })
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null

  if (!body) {
    throw new Error(`Invalid JSON response (${res.status})`)
  }
  if (!res.ok || body.success === false) {
    throw new Error(body.message || `Request failed (${res.status})`)
  }
  if (body.data == null) {
    throw new Error(body.message || 'Empty response data')
  }
  return body.data
}

/**
 * Fetch all available lending markets
 */
export async function fetchLendingMarkets(
  config: DashboardConfig,
  chainId: number = 1,
): Promise<LendingMarket[]> {
  return request<LendingMarket[]>(config, `/api/v1/lending/markets?chainId=${chainId}`)
}

/**
 * Fetch single market with rates
 */
export async function fetchLendingMarket(
  config: DashboardConfig,
  marketId: string,
  chainId: number = 1,
): Promise<LendingMarket> {
  return request<LendingMarket>(
    config,
    `/api/v1/lending/markets/${encodeURIComponent(marketId)}?chainId=${chainId}`,
  )
}

/**
 * Fetch user account data
 */
export async function fetchUserAccountData(
  config: DashboardConfig,
  userAddress: string,
  chainId: number = 1,
): Promise<UserAccountData> {
  return request<UserAccountData>(
    config,
    `/api/v1/lending/user/${encodeURIComponent(userAddress)}?chainId=${chainId}`,
  )
}

/**
 * Fetch user reserve positions
 */
export async function fetchUserReserves(
  config: DashboardConfig,
  userAddress: string,
  chainId: number = 1,
): Promise<UserReserveData[]> {
  return request<UserReserveData[]>(
    config,
    `/api/v1/lending/user/${encodeURIComponent(userAddress)}/reserves?chainId=${chainId}`,
  )
}

/**
 * Deposit collateral
 */
export async function depositCollateral(
  config: DashboardConfig,
  chainId: number,
  user: string,
  marketId: string,
  amount: string,
): Promise<{ marketId: string; aTokenBalance: string; underlyingBalance: string; usageAsCollateralEnabled: boolean }> {
  return request(config, '/api/v1/lending/deposit', {
    method: 'POST',
    body: JSON.stringify({ chainId, user, marketId, amount }),
  })
}

/**
 * Withdraw collateral
 */
export async function withdrawCollateral(
  config: DashboardConfig,
  chainId: number,
  user: string,
  marketId: string,
  amount: string,
): Promise<{ marketId: string; aTokenBalance: string; underlyingBalance: string }> {
  return request(config, '/api/v1/lending/withdraw', {
    method: 'POST',
    body: JSON.stringify({ chainId, user, marketId, amount }),
  })
}

/**
 * Borrow tokens
 */
export async function borrowTokens(
  config: DashboardConfig,
  chainId: number,
  user: string,
  marketId: string,
  amount: string,
  interestRateMode: 'stable' | 'variable' = 'variable',
): Promise<{ marketId: string; variableDebtBalance: string; stableDebtBalance: string; totalDebt: string }> {
  return request(config, '/api/v1/lending/borrow', {
    method: 'POST',
    body: JSON.stringify({ chainId, user, marketId, amount, interestRateMode }),
  })
}

/**
 * Repay borrowed tokens
 */
export async function repayTokens(
  config: DashboardConfig,
  chainId: number,
  user: string,
  marketId: string,
  amount: string,
  interestRateMode: 'stable' | 'variable' = 'variable',
): Promise<{ marketId: string; variableDebtBalance: string; stableDebtBalance: string; totalDebt: string }> {
  return request(config, '/api/v1/lending/repay', {
    method: 'POST',
    body: JSON.stringify({ chainId, user, marketId, amount, interestRateMode }),
  })
}

/**
 * Enable/disable collateral
 */
export async function setCollateralUsage(
  config: DashboardConfig,
  chainId: number,
  user: string,
  marketId: string,
  useAsCollateral: boolean,
): Promise<{
  marketId: string
  useAsCollateral: boolean
  accountHealth: { healthFactor: string; totalCollateralUsd: string }
}> {
  return request(config, '/api/v1/lending/collateral', {
    method: 'POST',
    body: JSON.stringify({ chainId, user, marketId, useAsCollateral }),
  })
}
