# Binance Trading Interface Clone

A comprehensive, full-featured Binance-like trading interface built with React and TypeScript. Includes spot trading, portfolio management, and wallet deposit/withdrawal functionality.

## Features

### 1. Spot Trading Interface
- **Multi-pair Support**: Trade major cryptocurrencies (BTC, ETH, BNB, SOL, ADA, and more)
- **Real-time Price Updates**: Live price data with 24h change percentages
- **Order Types**: LIMIT and MARKET orders
- **Buy/Sell Functionality**: Intuitive buy/sell interface with quick amount buttons
- **Order Summary**: Real-time calculation of total cost including trading fees
- **Order History**: View all orders with status tracking (PENDING, PARTIAL_FILLED, FILLED, CANCELLED)
- **Live Order Book**: Depth chart showing bids and asks with visual depth indicators

### 2. Price Charts
- **Candlestick Charts**: OHLC data visualization
- **Multiple Timeframes**: 1m, 5m, 15m, 1h, 4h, 1d
- **24h Stats**: High, low, and volume information
- **Real-time Updates**: Simulated live price movements

### 3. Portfolio Management
- **Balance Overview**: Total portfolio value in USD and BTC
- **Asset Distribution**: Visual pie chart of asset allocation
- **Holdings Table**: Detailed breakdown of each asset:
  - Free balance
  - Locked balance (in orders/staking)
  - Total balance
  - USD value
  - BTC equivalent
- **Quick Actions**: Deposit, Withdraw, and Trade buttons per asset
- **24h Performance**: Track daily portfolio changes

### 4. Wallet Manager
- **Deposit Functionality**:
  - Generate deposit addresses per asset
  - Track deposit history
  - Monitor confirmations
  - View transaction hashes
  
- **Withdraw Functionality**:
  - Send crypto to external wallets
  - Calculate withdrawal fees
  - Track withdrawal status
  - View transaction confirmations

- **Transaction History**:
  - Combined view of all deposits and withdrawals
  - Filter by type and status
  - Transaction details and timestamps

## Component Structure

```
src/
├── components/
│   ├── TradingInterface.tsx          # Main trading interface
│   ├── Portfolio.tsx                 # Portfolio overview
│   ├── WalletManager.tsx             # Deposit/Withdraw manager
│   └── trading/
│       ├── SpotTradingPanel.tsx      # Buy/Sell panel
│       ├── OrderBook.tsx             # Order book depth
│       ├── TradeHistory.tsx          # Order history table
│       └── PriceChart.tsx            # Candlestick chart
├── types/
│   └── trading.ts                    # TypeScript interfaces
└── styles/
    ├── trading.css                   # Trading interface styles
    ├── portfolio.css                 # Portfolio styles
    └── wallet.css                    # Wallet manager styles
```

## Type Definitions

### Core Trading Types

```typescript
// Trading Pair Information
interface TradingPair {
  symbol: string                    // e.g., "BTCUSDT"
  name: string                      // e.g., "Bitcoin / USDT"
  baseAsset: string                 // e.g., "BTC"
  quoteAsset: string                // e.g., "USDT"
  lastPrice: number
  change24h: number                 // Percentage change
  volume24h: number                 // 24h trading volume
  high24h: number                   // 24h high
  low24h: number                    // 24h low
}

// Order Book Data
interface OrderBook {
  bids: Array<[price: number, quantity: number]>
  asks: Array<[price: number, quantity: number]>
}

// Trading Order
interface TradeOrder {
  id: string
  symbol: string
  type: 'BUY' | 'SELL'
  price: number
  quantity: number
  filledQuantity: number
  status: 'PENDING' | 'PARTIAL_FILLED' | 'FILLED' | 'CANCELLED'
  createdAt: Date
  updatedAt: Date
  totalValue: number
  fee: number
}

// Asset Balance
interface Balance {
  asset: string
  free: number                      // Available for trading
  locked: number                    // Locked in orders/staking
  total: number
}

// Portfolio Summary
interface Portfolio {
  totalValue: number                // BTC value
  totalValueUSD: number
  btcValue: number
  balances: Balance[]
  lastUpdated: Date
}

// Deposit Record
interface Deposit {
  id: string
  asset: string
  amount: number
  address: string
  txHash: string
  confirmations: number
  requiredConfirmations: number
  status: 'PENDING' | 'CONFIRMED' | 'FAILED'
  createdAt: Date
  updatedAt: Date
}

// Withdrawal Record
interface Withdrawal {
  id: string
  asset: string
  amount: number
  address: string
  fee: number
  txHash: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  createdAt: Date
  updatedAt: Date
}

// Spot Trade Input
interface SpotTradeInput {
  symbol: string
  side: 'BUY' | 'SELL'
  orderType: 'LIMIT' | 'MARKET'
  quantity: number
  price?: number                    // Required for LIMIT orders
}
```

## Supported Trading Pairs

The interface comes pre-configured with the following major trading pairs:

| Symbol | Name | Base Asset | Quote Asset |
|--------|------|-----------|-------------|
| BTCUSDT | Bitcoin / USDT | BTC | USDT |
| ETHUSDT | Ethereum / USDT | ETH | USDT |
| BNBUSDT | Binance Coin / USDT | BNB | USDT |
| SOLUSDT | Solana / USDT | SOL | USDT |
| ADAUSDT | Cardano / USDT | ADA | USDT |

Additional pairs can be easily added by updating the `TRADING_PAIRS` array in `TradingInterface.tsx`.

## Usage

### Import and Render Trading Interface

```typescript
import { TradingInterface } from './components/TradingInterface'

function App() {
  return (
    <TradingInterface 
      onClose={() => console.log('Closed')} 
    />
  )
}
```

### Import and Render Portfolio

```typescript
import { Portfolio } from './components/Portfolio'

function App() {
  return (
    <Portfolio 
      onClose={() => console.log('Closed')} 
    />
  )
}
```

### Import and Render Wallet Manager

```typescript
import { WalletManager } from './components/WalletManager'

function App() {
  return (
    <WalletManager 
      onClose={() => console.log('Closed')} 
    />
  )
}
```

## Styling

The interface uses a dark theme optimized for trading platforms with:

- **Color Scheme**:
  - Background: Deep black (#0f0f0f to #1a1a1a)
  - Primary: Blue (#0066ff, #0099ff)
  - Success: Green (#4CAF50)
  - Danger/Sell: Red (#F44336)
  - Warning: Orange (#FF9800)

- **Responsive Design**: Adapts to desktop and mobile viewports
- **CSS Variables**: Uses standard CSS for easy customization

### Customizing Colors

Edit the CSS files to change the color scheme:

```css
/* trading.css, portfolio.css, wallet.css */
--primary-color: #0066ff;
--success-color: #4CAF50;
--danger-color: #F44336;
--warning-color: #FF9800;
```

## Features Ready for Production

- [x] Spot trading with LIMIT and MARKET orders
- [x] Real-time order book with depth visualization
- [x] Candlestick price charts with multiple timeframes
- [x] Order history and status tracking
- [x] Portfolio management with asset allocation
- [x] Deposit functionality with address generation
- [x] Withdrawal functionality with fee calculation
- [x] Transaction history for deposits and withdrawals
- [x] Responsive mobile design
- [x] Dark theme optimized for trading
- [x] Real-time price updates
- [x] Order fee calculation
- [x] Asset filtering and search

## Next Steps / Integration

To integrate with a real backend:

1. Replace mock data in components with API calls
2. Implement WebSocket connections for real-time price updates
3. Add authentication and user account management
4. Connect to blockchain RPC for wallet operations
5. Implement actual order matching engine
6. Add 2FA and security features
7. Implement order history persistence
8. Add more trading pairs from Binance API

## Performance Optimizations

- Memoized components to prevent unnecessary re-renders
- Virtualized order book for large datasets
- Efficient price update mechanism
- CSS-based animations for smooth UI
- Lazy loading of price history

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## License

This trading interface clone is provided as-is for educational and development purposes.
