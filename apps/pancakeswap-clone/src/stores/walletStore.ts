import { create } from 'zustand'
import type { UserWallet } from '../types'

interface WalletState {
  wallet: UserWallet | null
  tokenBalances: Record<string, string>
  loading: boolean
  error: string | null

  setWallet: (wallet: UserWallet | null) => void
  setTokenBalances: (balances: Record<string, string>) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  connectWallet: (address: string) => Promise<void>
  disconnectWallet: () => void
  updateBalance: (tokenAddress: string, balance: string) => void
}

export const useWalletStore = create<WalletState>((set) => ({
  wallet: null,
  tokenBalances: {},
  loading: false,
  error: null,

  setWallet: (wallet) => set({ wallet }),
  setTokenBalances: (tokenBalances) => set({ tokenBalances }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  connectWallet: async (address) => {
    set({ loading: true, error: null })
    try {
      // Simulate wallet connection
      set({
        wallet: {
          address,
          balance: '0',
          connected: true,
          chainId: 56, // BSC
        },
      })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to connect wallet',
      })
    } finally {
      set({ loading: false })
    }
  },

  disconnectWallet: () => {
    set({ wallet: null, tokenBalances: {} })
  },

  updateBalance: (tokenAddress, balance) => {
    set((state) => ({
      tokenBalances: {
        ...state.tokenBalances,
        [tokenAddress]: balance,
      },
    }))
  },
}))
