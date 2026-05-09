/**
 * @file test-adapters.ts
 * @module @legion/core
 * @sentinel Forge (adapter verification)
 *
 * Smoke-test for the Phase 1.3 Headless Adapter System.
 * Verifies that identifyFamily() correctly classifies addresses from all
 * three supported chain families (EVM, SVM, UTXO) and that GatekeeperError
 * is thrown for malformed input.
 *
 * Run with:
 *   pnpm --filter @legion/core exec tsx src/test-adapters.ts
 */

import { identifyFamily, GatekeeperError } from './adapters/address-resolver'

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const FIXTURES = [
  // EVM — well-known addresses (EIP-55 checksummed)
  {
    address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // Vitalik ENS resolved
    expected: 'EVM',
    label: 'Vitalik.eth (EVM, EIP-55 checksum)',
  },
  {
    address: '0x000000000022D473030F116dDEE9F6B43aC78BA3', // Permit2 contract
    expected: 'EVM',
    label: 'Permit2 contract (EVM, mixed case)',
  },
  {
    address: '0xabcdef1234567890abcdef1234567890abcdef12', // lowercase hex
    expected: 'EVM',
    label: 'EVM address (all lowercase)',
  },

  // SVM — Solana base58 public keys
  {
    address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', // arbitrary pubkey
    expected: 'SVM',
    label: 'Solana mainnet address (base58, 44 chars)',
  },
  {
    address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program ID
    expected: 'SVM',
    label: 'SPL Token Program ID (SVM, base58)',
  },

  // UTXO — Bitcoin address formats
  {
    address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf3A', // genesis coinbase P2PKH
    expected: 'UTXO',
    label: 'Bitcoin genesis address (UTXO, P2PKH)',
  },
  {
    address: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', // P2SH example
    expected: 'UTXO',
    label: 'Bitcoin P2SH address (UTXO)',
  },
  {
    address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', // Bech32 P2WPKH
    expected: 'UTXO',
    label: 'Bitcoin Bech32 address (UTXO, P2WPKH)',
  },
]

const INVALID_FIXTURES = [
  { address: '', label: 'empty string' },
  { address: '0x123', label: 'truncated EVM address' },
  { address: 'not-an-address', label: 'random string' },
  { address: '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', label: 'EVM with invalid hex chars' },
]

// ─── Runner ───────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

console.log('\n╔══════════════════════════════════════════════════════════╗')
console.log('║   Legion Phase 1.3 — Address Resolver Smoke Test        ║')
console.log('╚══════════════════════════════════════════════════════════╝\n')

console.log('── Valid Addresses ──────────────────────────────────────────')

for (const { address, expected, label } of FIXTURES) {
  try {
    const result = identifyFamily(address)
    const ok = result === expected
    if (ok) {
      console.log(`  ✓  ${label}`)
      console.log(`       "${address}" → ${result}`)
      passed++
    } else {
      console.log(`  ✗  ${label}`)
      console.log(`       "${address}" → got ${result}, expected ${expected}`)
      failed++
    }
  } catch (err) {
    console.log(`  ✗  ${label} — threw unexpectedly: ${String(err)}`)
    failed++
  }
}

console.log('\n── Invalid Addresses (must throw GatekeeperError) ───────────')

for (const { address, label } of INVALID_FIXTURES) {
  try {
    const result = identifyFamily(address)
    console.log(`  ✗  ${label} — should have thrown but returned: ${result}`)
    failed++
  } catch (err) {
    if (err instanceof GatekeeperError) {
      console.log(`  ✓  ${label} → GatekeeperError (code: ${err.code})`)
      passed++
    } else {
      console.log(`  ✗  ${label} — threw wrong error type: ${String(err)}`)
      failed++
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

const total = passed + failed
const status = failed === 0 ? 'PASS' : 'FAIL'

console.log(`\n── Results ─────────────────────────────────────────────────`)
console.log(`  ${passed}/${total} tests passed`)
console.log(`  Status: ${status}\n`)

if (failed > 0) {
  process.exit(1)
}
