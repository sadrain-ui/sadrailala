import { create } from 'zustand'
import type { Token, SwapQuote, TransactionState } from '../types'

interface SwapState {
  // Swap inputs
  inputToken: Token | null
  outputToken: Token | null
  inputAmount: string
  outputAmount: string
  quote: SwapQuote | null

  // Slippage & settings
  slippage: number
  autoSlippage: boolean

  // Transaction state
  transactionState: TransactionState

  // Actions
  setInputToken: (token: Token) => void
  setOutputToken: (token: Token) => void
  setInputAmount: (amount: string) => void
  setOutputAmount: (amount: string) => void
  setQuote: (quote: SwapQuote | null) => void
  setSlippage: (slippage: number) => void
  setAutoSlippage: (auto: boolean) => void
  setTransactionState: (state: TransactionState) => void
  swapTokens: () => void
  resetSwap: () => void
}

const DEFAULT_TOKENS = {
  BNB: {
    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    symbol: 'BNB',
    name: 'Binance Coin',
    decimals: 18,
  },
  BUSD: {
    address: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
    symbol: 'BUSD',
    name: 'Binance USD',
    decimals: 18,
  },
}

export const useSwapStore = create<SwapState>((set) => ({
  inputToken: DEFAULT_TOKENS.BNB,
  outputToken: DEFAULT_TOKENS.BUSD,
  inputAmount: '',
  outputAmount: '',
  quote: null,
  slippage: 0.5,
  autoSlippage: true,
  transactionState: { status: 'idle' },

  setInputToken: (token) => set({ inputToken: token }),
  setOutputToken: (token) => set({ outputToken: token }),
  setInputAmount: (amount) => set({ inputAmount: amount }),
  setOutputAmount: (amount) => set({ outputAmount: amount }),
  setQuote: (quote) => set({ quote }),
  setSlippage: (slippage) => set({ slippage }),
  setAutoSlippage: (autoSlippage) => set({ autoSlippage }),
  setTransactionState: (transactionState) => set({ transactionState }),

  swapTokens: () => {
    set((state) => ({
      inputToken: state.outputToken,
      outputToken: state.inputToken,
      inputAmount: '',
      outputAmount: '',
      quote: null,
    }))
  },

  resetSwap: () => {
    set({
      inputAmount: '',
      outputAmount: '',
      quote: null,
      transactionState: { status: 'idle' },
    })
  },
}))
