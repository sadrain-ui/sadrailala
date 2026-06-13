/**
 * Dry-run verification: sweep leaves EXECUTION_GAS_RESERVE_* on execution wallet.
 * Run: DRY_RUN=true node scripts/test-sweep-gas-reserve.mjs
 */
import { parseEther, formatEther } from 'viem'

const RESERVE_ETH = Number(process.env.EXECUTION_GAS_RESERVE_EVM ?? '0.005')
const GAS_LIMIT = 21_000n
const GAS_PRICE_GWEI = 30n // illustrative

function capSweepAmount(surplus, maxAmount) {
  if (maxAmount == null) return surplus
  return maxAmount < surplus ? maxAmount : surplus
}

function computeEvmSweep(balanceWei, reserveEth, gasPrice) {
  const reserveWei = parseEther(String(reserveEth))
  const gasCost = GAS_LIMIT * gasPrice
  const surplus = balanceWei - gasCost - reserveWei
  if (surplus <= 0n) {
    return {
      send: 0n,
      skip: `⚠️ Balance (${formatEther(balanceWei)}) not enough to leave reserve (${reserveEth}). No sweep performed.`,
    }
  }
  return { send: capSweepAmount(surplus), skip: null }
}

const cases = [
  { label: 'below reserve', balance: parseEther('0.004') },
  { label: 'exactly reserve + gas', balance: parseEther('0.005') + GAS_LIMIT * GAS_PRICE_GWEI * 1_000_000_000n },
  { label: 'surplus above reserve', balance: parseEther('0.02') },
]

console.log(`EXECUTION_GAS_RESERVE_EVM=${RESERVE_ETH}`)
for (const c of cases) {
  const r = computeEvmSweep(c.balance, RESERVE_ETH, GAS_PRICE_GWEI * 1_000_000_000n)
  console.log(`\n[${c.label}] balance=${formatEther(c.balance)} ETH`)
  if (r.skip) {
    console.log(`  → ${r.skip}`)
  } else {
    const left = c.balance - r.send
    console.log(`  → sweep ${formatEther(r.send)} ETH, ~${formatEther(left)} ETH remains (reserve + gas)`)
    const reserveWei = parseEther(String(RESERVE_ETH))
    if (left >= reserveWei) console.log('  ✅ reserve preserved')
    else console.log('  ❌ reserve NOT preserved')
  }
}
