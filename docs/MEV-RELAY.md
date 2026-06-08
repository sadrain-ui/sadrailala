# MEV Relay Module (`@legion/core/mev-relay`)

Private transaction submission for settlement with automatic public-RPC fallback.

## Overview

| Chain family | Private lane | Fallback |
|--------------|--------------|----------|
| EVM | `eth_sendPrivateTransaction` via Protect / MEV relay RPC | `eth_sendRawTransaction` on standard RPC |
| Solana | Jito `sendBundle` | `sendRawTransaction` on institutional Solana RPC |

## Environment

```bash
# Master switch
MEV_PROTECT=true

# EVM — primary private-tx RPC (recommended: Flashbots Protect)
MEV_RELAY_URL=https://rpc.flashbots.net

# Legacy relay URL — when set to https://relay.flashbots.net, private txs route via Protect RPC
FLASHBOTS_RELAY_URL=https://relay.flashbots.net
FLASHBOTS_PROTECT_RPC_URL=https://rpc.flashbots.net

# maxBlock window for eth_sendPrivateTransaction (default 25)
MEV_MAX_BLOCK_AHEAD=25

# Solana — Jito block engine (defaults to mainnet.block-engine.jito.wtf)
MEV_JITO_URL=
JITO_BLOCK_ENGINE_URL=
JITO_SETTLEMENT_LANE_URL=
```

## API

```typescript
import {
  submitPrivateTransaction,
  submitPrivateSolanaTransaction,
  SOLANA_MEV_CHAIN_ID,
  isMevProtectEnabled,
} from '@legion/core/mev-relay'

// EVM signed raw tx
const txHash = await submitPrivateTransaction('0x02f8…', 1)

// Solana — pass chainId 101 or use helper directly
const sig = await submitPrivateTransaction(base64Wire, SOLANA_MEV_CHAIN_ID)
// or
const sig2 = await submitPrivateSolanaTransaction(rawBytes)
```

## Settlement integration

- **EVM** (`broadcastEVM` in `settlement-execution-bridge.ts`): when `MEV_PROTECT=true`, signed user txs use `submitPrivateTransaction` before public mempool.
- **Solana** (`broadcastSVM`): when `MEV_PROTECT=true`, signed wire uses Jito `sendBundle` via `submitPrivateSolanaTransaction`.
- **Permit2 / single-tx Flashbots delivery** (`flashbots-relay.ts`): single-tx arrays route through `submitPrivateTransaction` when `MEV_PROTECT=true`.
- **Multi-tx bundles**: still use `FLASHBOTS_ENABLED` + `eth_sendBundle` when more than one signed EVM tx is delivered.

## Priority order (EVM)

1. `MEV_PROTECT=true` → `eth_sendPrivateTransaction` (+ fallback)
2. `FLASHBOTS_ENABLED=true` → bundle simulation + `eth_sendBundle`
3. Public `sendRawTransaction`

## Notes

- `relay.flashbots.net` is the **bundle** API; `eth_sendPrivateTransaction` is sent to the **Protect** RPC (`rpc.flashbots.net`) unless `MEV_RELAY_URL` overrides.
- Solana Jito returns a bundle id when the tx signature cannot be parsed from wire; confirmation polling uses the returned identifier.
