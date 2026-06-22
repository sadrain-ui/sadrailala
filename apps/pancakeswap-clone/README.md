# PancakeSwap Clone - BSC DEX Interface

A perfect replica of the PancakeSwap interface for Binance Smart Chain (BSC) with complete swap, liquidity pool, farming, and staking functionality.

## Features

### 1. Swap Module
- Token pair selection (Input/Output tokens)
- Real-time quote calculation
- Price impact and slippage tolerance settings
- Transaction status tracking
- Perfect UI replication of PancakeSwap swap interface

**Key Components:**
- `Swap.tsx` - Main swap component
- `swapStore.ts` - Zustand store for swap state management
- Dynamic swap reversal and token selection

### 2. Liquidity Pool Module
- Browse and filter liquidity pools
- Add liquidity with proportional token amounts
- Remove liquidity from existing positions
- Real-time APR calculations
- User stake tracking and pool metrics
- TVL and 24h volume display

**Key Components:**
- `Liquidity.tsx` - Liquidity management component
- `liquidityStore.ts` - State management for liquidity operations
- Pool cards with comprehensive statistics

### 3. Farming Module
- Multiple farming pools with various LP tokens
- Stake LP tokens to earn CAKE rewards
- APR and reward calculations
- Unstake functionality with transaction management
- Pending rewards display and claim mechanism
- Pool weight and reward per block information

**Key Components:**
- `Farming.tsx` - Farm staking interface
- `farmingStore.ts` - Farming state management
- Real-time reward calculations

### 4. Staking Module
- CAKE token staking with flexible locking options
- Lock duration bonuses (e.g., 90-day lock = +25% APR)
- Estimated daily rewards calculation
- Manage active stakes with unstake functionality
- Pending rewards tracking and claiming
- Complete stake lifecycle management

**Key Components:**
- `Staking.tsx` - Staking interface
- `stakingStore.ts` - Staking state management
- Lock bonus calculations

## Architecture

### State Management
Uses **Zustand** for efficient, lightweight state management:
- `swapStore.ts` - Swap transactions and quotes
- `walletStore.ts` - Wallet connection and balances
- `liquidityStore.ts` - LP positions and operations
- `farmingStore.ts` - Farm stakes and rewards
- `stakingStore.ts` - CAKE staking positions

### Blockchain Integration
- **Viem** for Ethereum/BSC interactions
- **Wagmi** for wallet connection (MetaMask, TrustWallet, etc.)
- BSC RPC endpoint configuration
- Contract interaction abstractions

### UI/UX
- Dark theme with PancakeSwap brand colors
- Responsive design (mobile, tablet, desktop)
- Real-time state updates
- Smooth transitions and interactions
- Loading states and error handling

## Directory Structure

```
pancakeswap-clone/
├── src/
│   ├── components/
│   │   ├── Swap.tsx
│   │   ├── Liquidity.tsx
│   │   ├── Farming.tsx
│   │   ├── Staking.tsx
│   │   └── WalletConnect.tsx
│   ├── stores/
│   │   ├── swapStore.ts
│   │   ├── walletStore.ts
│   │   ├── liquidityStore.ts
│   │   ├── farmingStore.ts
│   │   └── stakingStore.ts
│   ├── hooks/
│   │   └── useBSCProvider.ts
│   ├── styles/
│   │   ├── index.css
│   │   ├── App.css
│   │   ├── Swap.css
│   │   ├── Liquidity.css
│   │   ├── Farming.css
│   │   ├── Staking.css
│   │   └── WalletConnect.css
│   ├── types.ts
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

## Getting Started

### Installation

```bash
cd apps/pancakeswap-clone
pnpm install
```

### Development

```bash
pnpm dev
```

The app runs on `http://localhost:3001`

### Build

```bash
pnpm build
```

### Type Checking

```bash
pnpm typecheck
```

## BSC Integration Details

### Network Configuration
- **Chain ID:** 56 (BSC Mainnet)
- **RPC URL:** https://bsc-dataseed1.binance.org:443
- **Network Name:** Binance Smart Chain

### Connected Tokens (Mock Data)
- **BNB** - Native BSC token
- **BUSD** - Binance USD stablecoin
- **USDT** - Tether USD
- **ETH** - Ethereum bridge token
- **CAKE** - PancakeSwap governance token

### Smart Contract Integration Points
The clone is ready to integrate with:
- UniswapV2 Router (PancakeSwap fork)
- ERC20 Token contracts
- Farming/Staking contracts
- LP Token contracts

## Key Features

### 1. Swap Interface
- Select input/output tokens
- Enter swap amounts
- View price impact and fees
- Slippage tolerance settings (0.1% - 5%)
- Execute swap transactions
- Transaction history

### 2. Liquidity Management
- Pool discovery and filtering
- Add liquidity with balanced amounts
- Remove liquidity with LP token burns
- User share percentage tracking
- APR and TVL metrics
- 24h volume tracking

### 3. Farm Staking
- Multiple pools with different rewards
- Pool weight and APR display
- Stake LP tokens to earn CAKE
- Unstake with full amount flexibility
- Claim pending rewards
- Real-time reward calculations

### 4. Token Staking
- Single-sided CAKE staking
- Flexible and locked options
- Lock bonus calculations
- Daily reward estimates
- Stake management interface
- Reward claiming

## Transaction Flow

### Swap Process
1. Connect wallet
2. Select token pair
3. Enter amount
4. Review quote and price impact
5. Confirm swap
6. Sign transaction
7. Track transaction status

### Liquidity Process
1. Select pool
2. Enter amounts for both tokens
3. Review pool metrics and APR
4. Approve tokens (if needed)
5. Add liquidity
6. Receive LP tokens

### Farming Process
1. Select farm pool
2. Enter LP token amount to stake
3. Approve LP tokens
4. Stake tokens
5. Monitor rewards
6. Claim or unstake as needed

### Staking Process
1. Select staking pool
2. Choose lock duration (optional)
3. Enter CAKE amount
4. Approve CAKE tokens
5. Stake with bonus calculation
6. Monitor rewards and manage position

## Error Handling

- Network connection errors
- Insufficient balance validation
- Transaction failure recovery
- Input validation
- User feedback via error messages

## Performance Optimizations

- Zustand for minimal re-renders
- Memoized components where needed
- Lazy loading of pool data
- Efficient state updates
- CSS-in-JS minimal overhead

## Security Considerations

- No private keys stored
- Wallet connection via standard protocols
- Contract interaction validation
- Transaction confirmation before execution
- Slippage protection

## Future Enhancements

- Real blockchain integration
- Historical transaction tracking
- Advanced charting and analytics
- Pool creation interface
- Multi-hop swap routes
- Bridge integration
- Advanced farm strategies
- Governance voting

## Dependencies

- **React 18** - UI framework
- **Viem** - Ethereum/BSC client
- **Wagmi** - Wallet hooks
- **Zustand** - State management
- **Vite** - Build tool
- **TypeScript** - Type safety

## Development Notes

### Adding New Features
1. Create component in `src/components/`
2. Add Zustand store in `src/stores/` if needed
3. Create styles in `src/styles/`
4. Update types in `src/types.ts`
5. Import in `App.tsx`

### Styling Approach
- CSS Modules with design tokens
- Dark theme with accent colors
- Mobile-first responsive design
- Consistent spacing and typography

### Testing Recommendations
- Unit tests for store logic
- Component integration tests
- E2E tests for main flows
- Gas estimation validation

## License

MIT License - Part of Legion Engine

## Support

For issues and feature requests, refer to the main Legion Engine repository.
