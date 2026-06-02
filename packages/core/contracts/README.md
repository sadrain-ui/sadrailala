# LegionAaveFlashSettlement

Deploy on **Ethereum mainnet** (chain id `1`) with Foundry or Remix.

## Constructor

| Arg | Mainnet value |
|-----|----------------|
| `pool_` | `AAVE_POOL_ADDRESS` — default `0x87870Bca3F3fD6335C3F4ce8391D5256Bc458c53` |
| `permit2_` | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| `swapRouter_` | Uniswap SwapRouter02 `0x68b3465833fb72A70ecDF487E86da69B732B385b` |
| `profitSink_` | `PROFIT_ADDRESS` from env |
| `operator_` | Settlement executor EOA (`SETTLEMENT_EXECUTION_PRIVATE_KEY` address) |

Set `FLASHLOAN_RECEIVER_ADDRESS` to the deployed contract address.

## Example (Foundry)

```bash
forge create packages/core/contracts/LegionAaveFlashSettlement.sol:LegionAaveFlashSettlement \
  --rpc-url $RPC_ETHEREUM_PRIVATE \
  --private-key $DEPLOYER_KEY \
  --constructor-args \
    0x87870Bca3F3fD6335C3F4ce8391D5256Bc458c53 \
    0x000000000022D473030F116dDEE9F6B43aC78BA3 \
    0x68b3465833fb72A70ecDF487E86da69B732B385b \
    $PROFIT_ADDRESS \
    $OPERATOR_EOA
```
