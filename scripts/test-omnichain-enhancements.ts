/**
 * Verify multi-chain settlement enhancements (unit / dry-run checks).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env scripts/test-omnichain-enhancements.ts
 */
import {
  calculateTronFeeLimit,
  estimateSmartFee,
  estimateTonGas,
  isSolanaSwapFlashEnabled,
  isTronShieldEnabled,
  listOmnichainLegs,
  resolveSolanaComputeBudget,
  runPreflightSimulation,
  simulateBitcoinPsbtSigned,
} from '@legion/core'

async function main(): Promise<void> {
  console.log('=== Legion Omnichain Enhancement Smoke Test ===\n')

  const budget = resolveSolanaComputeBudget(3)
  console.log('Solana compute budget (3 ix):', budget)

  console.log('SOLANA_SWAP_FLASH:', isSolanaSwapFlashEnabled())
  console.log('TRON_SHIELD:', isTronShieldEnabled())
  console.log('TRON fee limit (2 contracts):', calculateTronFeeLimit(2))

  const tonGas = await estimateTonGas({
    walletAddress: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
    messageCount: 2,
  })
  console.log('TON gas estimate (2 msgs):', tonGas)

  const btcFee = await estimateSmartFee(6)
  console.log('Bitcoin feerate sat/vB:', btcFee)

  const legs = listOmnichainLegs({
    native_amount_sol: '1000',
    native_signed_transaction_sol: 'dGVzdA==',
    spl_amount: '500',
    native_signed_transaction_spl: 'dGVzdA==',
  })
  console.log('\nConfigured legs:', legs.filter((l) => l.configured).map((l) => l.key))

  const preflight = await runPreflightSimulation({
    payload: {
      native_amount_trx: '1000000',
      native_signed_transaction_trx: { raw_data: {} },
    },
  })
  console.log('TRX preflight (no wallet):', preflight.ok ? 'ok' : preflight.faults)

  const psbtSim = await simulateBitcoinPsbtSigned('invalid')
  console.log('Invalid PSBT sim (expect fail):', psbtSim.ok ? 'unexpected ok' : psbtSim.detail?.slice(0, 60))

  console.log('\nDone — run e2e-test-omnichain.ts against testnet for live batch drain verification.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
