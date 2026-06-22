import { useMemo } from 'react'
import { createPublicClient, http } from 'viem'
import { bsc } from 'viem/chains'

const BSC_RPC_URL = process.env.REACT_APP_BSC_RPC_URL || 'https://bsc-dataseed1.binance.org:443'

export function useBSCProvider() {
  return useMemo(() => {
    return createPublicClient({
      chain: bsc,
      transport: http(BSC_RPC_URL),
    })
  }, [])
}

export function useBSCChainId() {
  return bsc.id
}
