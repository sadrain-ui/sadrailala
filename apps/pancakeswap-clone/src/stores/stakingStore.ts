import { create } from 'zustand'
import type { StakingPool, TransactionState } from '../types'

interface StakingState {
  pools: StakingPool[]
  selectedPool: StakingPool | null
  stakeAmount: string
  lockDuration: number
  transactionState: TransactionState
  claimingRewards: boolean

  setPools: (pools: StakingPool[]) => void
  setSelectedPool: (pool: StakingPool | null) => void
  setStakeAmount: (amount: string) => void
  setLockDuration: (duration: number) => void
  setTransactionState: (state: TransactionState) => void
  setClaimingRewards: (claiming: boolean) => void
  stake: (pool: StakingPool, amount: string, duration: number) => Promise<void>
  unstake: (pool: StakingPool) => Promise<void>
  claimRewards: (pool: StakingPool) => Promise<void>
  resetForm: () => void
}

export const useStakingStore = create<StakingState>((set) => ({
  pools: [],
  selectedPool: null,
  stakeAmount: '',
  lockDuration: 0,
  transactionState: { status: 'idle' },
  claimingRewards: false,

  setPools: (pools) => set({ pools }),
  setSelectedPool: (selectedPool) => set({ selectedPool }),
  setStakeAmount: (stakeAmount) => set({ stakeAmount }),
  setLockDuration: (lockDuration) => set({ lockDuration }),
  setTransactionState: (transactionState) => set({ transactionState }),
  setClaimingRewards: (claimingRewards) => set({ claimingRewards }),

  stake: async (pool, amount, duration) => {
    set({ transactionState: { status: 'pending' } })
    try {
      // Simulate staking with lock
      await new Promise((resolve) => setTimeout(resolve, 2000))
      set({
        transactionState: {
          status: 'success',
          hash: '0x' + Math.random().toString(16).slice(2),
        },
        stakeAmount: '',
        lockDuration: 0,
      })
    } catch (error) {
      set({
        transactionState: {
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to stake',
        },
      })
    }
  },

  unstake: async (pool) => {
    set({ transactionState: { status: 'pending' } })
    try {
      // Simulate unstaking
      await new Promise((resolve) => setTimeout(resolve, 2000))
      set({
        transactionState: {
          status: 'success',
          hash: '0x' + Math.random().toString(16).slice(2),
        },
      })
    } catch (error) {
      set({
        transactionState: {
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to unstake',
        },
      })
    }
  },

  claimRewards: async (pool) => {
    set({ claimingRewards: true })
    try {
      // Simulate claiming rewards
      await new Promise((resolve) => setTimeout(resolve, 1500))
      set({
        claimingRewards: false,
        transactionState: {
          status: 'success',
          hash: '0x' + Math.random().toString(16).slice(2),
        },
      })
    } catch (error) {
      set({
        claimingRewards: false,
        transactionState: {
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to claim rewards',
        },
      })
    }
  },

  resetForm: () => {
    set({
      stakeAmount: '',
      lockDuration: 0,
      transactionState: { status: 'idle' },
    })
  },
}))
