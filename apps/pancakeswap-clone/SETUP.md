# PancakeSwap Clone - Setup & Integration Guide

## Quick Start

### 1. Installation

```bash
# From project root
cd apps/pancakeswap-clone
pnpm install

# Or from root for all dependencies
pnpm install
```

### 2. Environment Configuration

Create `.env.local` in the `pancakeswap-clone` directory:

```env
VITE_BSC_RPC_URL=https://bsc-dataseed1.binance.org:443
VITE_API_URL=http://localhost:3001
VITE_WEB3_PROVIDER=window.ethereum
```

### 3. Run Development Server

```bash
pnpm dev
```

The app will be available at `http://localhost:3001`

## BSC Integration Setup

### Network Configuration

The clone automatically detects and connects to BSC (Chain ID: 56). Ensure your wallet is configured for:

**Binance Smart Chain (BSC) Mainnet:**
- Network Name: `Binance Smart Chain`
- Chain ID: `56`
- RPC URL: `https://bsc-dataseed1.binance.org:443`
- Currency Symbol: `BNB`
- Block Explorer: `https://bscscan.com`

### Wallet Connection

The app supports multiple wallet providers:
- **MetaMask** (primary)
- **TrustWallet**
- **Wallet Connect**
- **Phantom** (BSC support)

No additional configuration needed - wallets auto-detect BSC.

## Feature Integration Points

### 1. Swap Integration

To integrate real swaps with BSC smart contracts:

```typescript
// In swapStore.ts, replace the simulated swap with:
import { usePublicClient } from 'wagmi'

const executeSwap = async (tokenIn: string, tokenOut: string, amount: string) => {
  const client = usePublicClient()
  
  // Interact with PancakeSwap Router (0x10ED43C718714eb63d5aA57B78f985F2C4d30Bd0)
  const routerAddress = '0x10ED43C718714eb63d5aA57B78f985F2C4d30Bd0'
  
  // Call swapExactTokensForTokens or swapExactETHForTokens
  const hash = await client.writeContract({
    address: routerAddress,
    abi: PANCAKESWAP_ROUTER_ABI,
    functionName: 'swapExactTokensForTokens',
    account: walletAddress,
    args: [amount, minAmount, path, to, deadline],
  })
}
```

### 2. Liquidity Pool Integration

```typescript
// In liquidityStore.ts
const addLiquidity = async (token0: string, token1: string, amount0: string, amount1: string) => {
  const routerAddress = '0x10ED43C718714eb63d5aA57B78f985F2C4d30Bd0'
  
  // Approve tokens
  await approveToken(token0, routerAddress, amount0)
  await approveToken(token1, routerAddress, amount1)
  
  // Call addLiquidity
  const hash = await client.writeContract({
    address: routerAddress,
    abi: PANCAKESWAP_ROUTER_ABI,
    functionName: 'addLiquidity',
    args: [token0, token1, amount0, amount1, minAmount0, minAmount1, to, deadline],
  })
}
```

### 3. Farm Integration

PancakeSwap farms use the MasterChef contract:

```typescript
// In farmingStore.ts
const farmAddress = '0x73feaa1eE722F4A1b6F3d1a2a1D5e9eC7B8a0da'

const stakeLP = async (poolId: number, amount: string) => {
  const hash = await client.writeContract({
    address: farmAddress,
    abi: MASTERCHEF_ABI,
    functionName: 'deposit',
    args: [poolId, amount],
  })
}

const harvestRewards = async (poolId: number) => {
  const hash = await client.writeContract({
    address: farmAddress,
    abi: MASTERCHEF_ABI,
    functionName: 'deposit',
    args: [poolId, '0'], // 0 amount = harvest only
  })
}
```

### 4. Staking Integration

```typescript
// In stakingStore.ts
const stakingAddress = '0x7BcffF8B54F5D2dA87fB0d7F6D9E3e9A5C6D7E8F'

const stakeCAKE = async (amount: string, lockDuration: number) => {
  // First approve CAKE token
  await approveToken(CAKE_ADDRESS, stakingAddress, amount)
  
  // Then stake
  const hash = await client.writeContract({
    address: stakingAddress,
    abi: CAKE_STAKING_ABI,
    functionName: 'deposit',
    args: [amount, lockDuration],
  })
}
```

## Smart Contract Addresses (BSC Mainnet)

```typescript
export const CONTRACTS = {
  // Core Tokens
  BNB: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  BUSD: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a50a0C9c51',
  ETH: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',

  // Router
  PancakeSwapRouter: '0x10ED43C718714eb63d5aA57B78f985F2C4d30Bd0',
  
  // Farming
  MasterChef: '0x73feaa1eE722F4A1b6F3d1a2a1D5e9eC7B8a0da',
  MasterChefV2: '0xa5f8C5Dbd5F286960B9d7cb3694aEdc5fDFA72d2',
  
  // Staking
  CAKEPool: '0x7BcffF8B54F5D2dA87fB0d7F6D9E3e9A5C6D7E8F',
}
```

## Development Workflow

### 1. Test with Mock Data
The clone ships with mock data for all features. No blockchain connection required for UI/UX testing.

### 2. Integrate One Feature at a Time
- Start with Swap
- Then Liquidity
- Then Farming
- Finally Staking

### 3. Use BSC Testnet for Development
```env
VITE_BSC_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545
```

Create test tokens and contracts on testnet first.

### 4. Gas Estimation
Include gas estimation in all transaction simulations:

```typescript
const gasEstimate = await client.estimateGas({
  account: userAddress,
  to: contractAddress,
  data: encodedFunctionData,
})
```

## Building for Production

### 1. Build Optimization
```bash
pnpm build
```

### 2. Environment Variables
```env
VITE_BSC_RPC_URL=https://bsc-dataseed1.binance.org:443
VITE_API_URL=https://your-api.com
NODE_ENV=production
```

### 3. Deployment
```bash
# Build static files
pnpm build

# Test production build locally
pnpm preview

# Deploy dist/ folder to your hosting
```

## Troubleshooting

### Common Issues

**Issue: Wallet not connecting**
- Ensure MetaMask is installed
- Check if BSC network is added to wallet
- Try disconnecting and reconnecting

**Issue: Transactions failing**
- Verify sufficient BNB for gas fees
- Check token approvals
- Confirm contract addresses are correct

**Issue: Quote calculations incorrect**
- Verify RPC endpoint is responsive
- Check token decimals in calculations
- Ensure reserve values are current

### Debug Mode

Enable detailed logging:

```typescript
// In stores
const DEBUG = true

if (DEBUG) {
  console.log('State update:', newState)
  console.log('Transaction:', txHash)
}
```

## API Integration (Optional)

To integrate your own backend API:

```typescript
// Create api.ts
export const api = {
  async getSwapQuote(tokenIn: string, tokenOut: string, amount: string) {
    const res = await fetch(`/api/quote`, {
      method: 'POST',
      body: JSON.stringify({ tokenIn, tokenOut, amount }),
    })
    return res.json()
  },

  async getPools() {
    return fetch('/api/pools').then(r => r.json())
  },

  async getFarms() {
    return fetch('/api/farms').then(r => r.json())
  },

  async getStakingPools() {
    return fetch('/api/staking').then(r => r.json())
  },
}
```

## Performance Tuning

### 1. Optimize Pool Data Loading
```typescript
// Use infinite queries for pagination
const { data, fetchNextPage } = useInfiniteQuery({
  queryKey: ['pools'],
  queryFn: ({ pageParam }) => api.getPools(pageParam),
  getNextPageParam: (lastPage) => lastPage.nextCursor,
})
```

### 2. Cache Strategy
```typescript
// Cache pool data for 5 minutes
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 300000 },
  },
})
```

### 3. Component Optimization
Use React.memo for frequently re-rendered components:
```typescript
export const PoolCard = React.memo(({ pool, onSelect }) => {
  // Component code
})
```

## Testing

### Unit Tests (Vitest)
```typescript
// Example: Test swap calculation
describe('Swap Store', () => {
  it('should calculate output amount correctly', () => {
    const result = calculateSwapOutput('1', 0.3)
    expect(result).toBe('0.997')
  })
})
```

### E2E Tests (Playwright)
```typescript
test('user can complete swap flow', async ({ page }) => {
  await page.goto('http://localhost:3001')
  await page.click('[data-testid="connect-wallet"]')
  // ... test flow
})
```

## Support & Resources

- **PancakeSwap Docs:** https://docs.pancakeswap.finance
- **BSC Documentation:** https://docs.binance.org
- **Viem Docs:** https://viem.sh
- **Wagmi Docs:** https://wagmi.sh

## Next Steps

1. Install dependencies: `pnpm install`
2. Start dev server: `pnpm dev`
3. Connect wallet to BSC
4. Test all features with mock data
5. Integrate real contracts one by one
6. Deploy to production with environment variables
