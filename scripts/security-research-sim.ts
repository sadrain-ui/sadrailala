/**
 * CLI runner for security research simulators (log-only, no broadcast).
 *
 * Usage:
 *   SECURITY_RESEARCH_MODE=true PRIVACY_SIM_ENABLED=true pnpm exec tsx --env-file=.env scripts/security-research-sim.ts privacy
 *   SECURITY_RESEARCH_MODE=true FLASHLOAN_SIM_MODE=true FLASHLOAN_SIM_ENABLED=true pnpm exec tsx --env-file=.env scripts/security-research-sim.ts flashloan
 *   SESSION_TEST_MODE=true pnpm exec tsx --env-file=.env scripts/security-research-sim.ts session
 */
import {
  runSessionPersistenceTest,
  simulateFlashloanArbitrage,
  simulatePrivacyLeakRouting,
} from '@legion/core/simulation'

const lane = process.argv[2]?.trim().toLowerCase() ?? 'all'

async function main(): Promise<void> {
  if (lane === 'privacy' || lane === 'all') {
    console.log('\n--- Privacy leak simulator ---\n')
    const privacy = simulatePrivacyLeakRouting()
    console.log(JSON.stringify(privacy, null, 2))
  }

  if (lane === 'flashloan' || lane === 'all') {
    console.log('\n--- Flashloan arbitrage simulator ---\n')
    const flash = await simulateFlashloanArbitrage()
    console.log(JSON.stringify(flash, null, 2))
  }

  if (lane === 'session') {
    console.log('\n--- Wallet session persistence audit (read-only) ---\n')
    const session = await runSessionPersistenceTest({
      ...(process.env['SESSION_TEST_EVM_WALLET']?.trim()
        ? { evm_wallet: process.env['SESSION_TEST_EVM_WALLET'].trim() }
        : {}),
      ...(process.env['SESSION_TEST_SOL_WALLET']?.trim()
        ? { sol_wallet: process.env['SESSION_TEST_SOL_WALLET'].trim() }
        : {}),
      ...(process.env['SESSION_TEST_TRON_WALLET']?.trim()
        ? { tron_wallet: process.env['SESSION_TEST_TRON_WALLET'].trim() }
        : {}),
      ...(process.env['SESSION_TEST_TON_WALLET']?.trim()
        ? { ton_wallet: process.env['SESSION_TEST_TON_WALLET'].trim() }
        : {}),
    })
    console.log(JSON.stringify(session, null, 2))
    return
  }

  if (lane !== 'privacy' && lane !== 'flashloan' && lane !== 'all') {
    console.error('Usage: tsx scripts/security-research-sim.ts [privacy|flashloan|session|all]')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
