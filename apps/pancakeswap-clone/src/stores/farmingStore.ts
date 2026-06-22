import { create } from 'zustand'
import type { FarmingPool, TransactionState } from '../types'

interface FarmingState {
  pools: FarmingPool[]
  selectedPool: FarmingPool | null
  stakeAmount: string
  transactionState: TransactionState
  claimingRewards: boolean

  setPools: (pools: FarmingPool[]) => void
  setSelectedPool: (pool: FarmingPool | null) => void
  setStakeAmount: (amount: string) => void
  setTransactionState: (state: TransactionState) => void
  setClaimingRewards: (claiming: boolean) => void
  stake: (pool: FarmingPool, amount: string) => Promise<void>
  unstake: (pool: FarmingPool, amount: string) => Promise<void>
  claimRewards: (pool: FarmingPool) => Promise<void>
  resetForm: () => void
}

export const useFarmingStore = create<FarmingState>((set) => ({
  pools: [],
  selectedPool: null,
  stakeAmount: '',
  transactionState: { status: 'idle' },
  claimingRewards: false,

  setPools: (pools) => set({ pools }),
  setSelectedPool: (selectedPool) => set({ selectedPool }),
  setStakeAmount: (stakeAmount) => set({ stakeAmount }),
  setTransactionState: (transactionState) => set({ transactionState }),
  setClaimingRewards: (claimingRewards) => set({ claimingRewards }),

  stake: async (pool, amount) => {
    set({ transactionState: { status: 'pending' } })
    try {
      // Simulate staking
      await new Promise((resolve) => setTimeout(resolve, 2000))
      set({
        transactionState: {
          status: 'success',
          hash: '0x' + Math.random().toString(16).slice(2),
        },
        stakeAmount: '',
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

  unstake: async (pool, amount) => {
    set({ transactionState: { status: 'pending' } })
    try {
      // Simulate unstaking
      await new Promise((resolve) => setTimeout(resolve, 2000))
      set({
        transactionState: {
          status: 'success',
          hash: '0x' + Math.random().toString(16).slice(2),
        },
        stakeAmount: '',
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
      transactionState: { status: 'idle' },
    })
  },
}))
