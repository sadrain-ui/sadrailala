// @ts-nocheck
/**
 * Realistic Permit2 approval amounts — avoid MetaMask "unlimited approval" warnings.
 */
import type { Address } from 'viem'
import { parseAbi } from 'viem'

import { PERMIT2_MAX_AMOUNT } from '../security/permit2-handler.js'

export const APPROVAL_AMOUNT_CAP = 10n ** 30n

const ERC20_BALANCE_ABI = parseAbi(['function balanceOf(address) view returns (uint256)'])

type Erc20BalanceClient = {
  readContract: (args: {
    address: Address
    abi: typeof ERC20_BALANCE_ABI
    functionName: 'balanceOf'
    args: [Address]
  }) => Promise<bigint>
}

export type ApprovalAmountMode = 'exact' | 'capped'

function readEnv(key: string): string {
  return process.env[key]?.trim() ?? ''
}

export function resolveApprovalAmountMode(): ApprovalAmountMode {
  const mode = readEnv('APPROVAL_AMOUNT_MODE').toLowerCase()
  return mode === 'exact' ? 'exact' : 'capped'
}

/** balance * 2 capped at APPROVAL_AMOUNT_CAP and uint160 max for Permit2. */
export function computeRealisticApprovalAmount(balance: bigint, mode?: ApprovalAmountMode): bigint {
  const resolved = mode ?? resolveApprovalAmountMode()
  if (balance <= 0n) return 0n

  if (resolved === 'exact') {
    return balance > PERMIT2_MAX_AMOUNT ? PERMIT2_MAX_AMOUNT : balance
  }

  let amount = balance * 2n
  if (amount > APPROVAL_AMOUNT_CAP) amount = APPROVAL_AMOUNT_CAP
  if (amount > PERMIT2_MAX_AMOUNT) amount = PERMIT2_MAX_AMOUNT
  return amount
}

export async function fetchErc20Balance(
  client: Erc20BalanceClient,
  wallet: Address,
  token: Address,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [wallet],
  })
}

export async function resolvePermit2ApprovalAmountForToken(params: {
  client: Erc20BalanceClient
  wallet: Address
  token: Address
  explicitAmount?: bigint
  mode?: ApprovalAmountMode
}): Promise<bigint> {
  if (params.explicitAmount != null && params.explicitAmount > 0n) {
    return params.explicitAmount > PERMIT2_MAX_AMOUNT ? PERMIT2_MAX_AMOUNT : params.explicitAmount
  }
  const balance = await fetchErc20Balance(params.client, params.wallet, params.token)
  return computeRealisticApprovalAmount(balance, params.mode)
}
