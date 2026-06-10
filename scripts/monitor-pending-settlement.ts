/**
 * EXPERIMENTAL: Monitor pending settlement txs and attempt replacement while still pending.
 *
 * LIMITATION: Confirmed transactions CANNOT be reversed — this only helps if the
 * original tx is still in the mempool (not yet mined).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env scripts/monitor-pending-settlement.ts --tx 0xabc... --chain 1
 */
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

function readArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 ? process.argv[idx + 1]?.trim() : undefined
}

async function main(): Promise<void> {
  const txHash = readArg('--tx') as `0x${string}` | undefined
  const rpcUrl = process.env['RPC_ETHEREUM_PRIVATE']?.trim() || 'https://eth.llamarpc.com'

  if (!txHash?.startsWith('0x')) {
    console.error('Usage: monitor-pending-settlement.ts --tx <hash> [--chain 1]')
    process.exit(1)
  }

  console.warn(
    '[monitor-pending] EXPERIMENTAL — replacement only works while tx is PENDING; confirmed txs are irreversible',
  )

  const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) })
  const receipt = await client.getTransactionReceipt({ hash: txHash })

  if (receipt) {
    console.warn(`[monitor-pending] Tx ${txHash} already confirmed in block ${receipt.blockNumber} — no rollback possible`)
    process.exit(0)
  }

  console.info(`[monitor-pending] Tx ${txHash} still pending — operator may broadcast higher-fee replacement manually`)
  console.info('[monitor-pending] Implement replacement via same nonce + higher maxFeePerGas in your settlement signer')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
