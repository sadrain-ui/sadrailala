/**
 * Telegram dedupe + EVM tx hash validation tests.
 */
import { describe, expect, it } from 'vitest'
import { isEvmTransactionHash } from '../lib/evm-tx-verify.js'
import { shouldSendTelegramOnce } from '../lib/telegram.js'

describe('isEvmTransactionHash', () => {
  it('accepts canonical 32-byte hashes', () => {
    const hash = '0x' + 'a'.repeat(64)
    expect(isEvmTransactionHash(hash)).toBe(true)
  })

  it('rejects wallet_sendCalls batch IDs', () => {
    expect(isEvmTransactionHash('0xabc123')).toBe(false)
    expect(isEvmTransactionHash('0x' + 'ab'.repeat(20))).toBe(false)
  })
})

describe('shouldSendTelegramOnce', () => {
  it('dedupes within TTL window', () => {
    const key = `test:${Date.now()}:wallet`
    expect(shouldSendTelegramOnce(key, 60_000)).toBe(true)
    expect(shouldSendTelegramOnce(key, 60_000)).toBe(false)
  })
})
