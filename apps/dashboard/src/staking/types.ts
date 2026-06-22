export interface StakingState {
  ethBalance: number;
  stakedAmount: number;
  stethBalance: number;
  pendingWithdrawal: number;
  apy: number;
  totalValueLocked: number;
  rewardsEarned: number;
  nextCheckpoint: Date;
  isLoading: boolean;
  error: string | null;
}

export interface WithdrawalRequest {
  id: string;
  amount: number;
  requestedAt: Date;
  status: 'pending' | 'approved' | 'claimed';
  claimableAt?: Date;
}

export interface StakingMetrics {
  totalStaked: number;
  totalRewards: number;
  dailyRewards: number;
  estimatedMonthlyRewards: number;
  estimatedYearlyRewards: number;
}

export interface StakingTransaction {
  id: string;
  type: 'stake' | 'unstake' | 'claim_rewards' | 'withdraw';
  amount: number;
  timestamp: Date;
  status: 'pending' | 'confirmed' | 'failed';
  txHash?: string;
}
