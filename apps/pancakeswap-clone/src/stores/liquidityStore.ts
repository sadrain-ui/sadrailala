import { create } from 'zustand'
import type { LiquidityPool, TransactionState } from '../types'

interface LiquidityState {
  pools: LiquidityPool[]
  selectedPool: LiquidityPool | null
  amount0: string
  amount1: string
  transactionState: TransactionState
  userLpBalance: string
  userShare: number

  setPools: (pools: LiquidityPool[]) => void
  setSelectedPool: (pool: LiquidityPool | null) => void
  setAmount0: (amount: string) => void
  setAmount1: (amount: string) => void
  setTransactionState: (state: TransactionState) => void
  setUserLpBalance: (balance: string) => void
  setUserShare: (share: number) => void
  addLiquidity: (pool: LiquidityPool, amount0: string, amount1: string) => Promise<void>
  removeLiquidity: (pool: LiquidityPool, lpAmount: string) => Promise<void>
  resetForm: () => void
}

export const useLiquidityStore = create<LiquidityState>((set) => ({
  pools: [],
  selectedPool: null,
  amount0: '',
  amount1: '',
  transactionState: { status: 'idle' },
  userLpBalance: '0',
  userShare: 0,

  setPools: (pools) => set({ pools }),
  setSelectedPool: (selectedPool) => set({ selectedPool }),
  setAmount0: (amount0) => set({ amount0 }),
  setAmount1: (amount1) => set({ amount1 }),
  setTransactionState: (transactionState) => set({ transactionState }),
  setUserLpBalance: (userLpBalance) => set({ userLpBalance }),
  setUserShare: (userShare) => set({ userShare }),

  addLiquidity: async (pool, amount0, amount1) => {
    set({ transactionState: { status: 'pending' } })
    try {
      // Simulate adding liquidity
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
          error: error instanceof Error ? error.message : 'Failed to add liquidity',
        },
      })
    }
  },

  removeLiquidity: async (pool, lpAmount) => {
    set({ transactionState: { status: 'pending' } })
    try {
      // Simulate removing liquidity
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
          error: error instanceof Error ? error.message : 'Failed to remove liquidity',
        },
      })
    }
  },

  resetForm: () => {
    set({
      amount0: '',
      amount1: '',
      transactionState: { status: 'idle' },
    })
  },
}))
