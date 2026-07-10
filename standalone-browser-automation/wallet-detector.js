/**
 * Wallet Detector — user ke browser mein kaun-kaun se wallets hain report karta hai.
 * Khud run karo ya page par inject karo. Koi specific target nahi.
 *
 * Browser:
 *   <script src="wallet-registry.js"></script>
 *   <script src="wallet-detector.js"></script>
 *
 * Console:
 *   WalletDetector.scan().then(r => console.table(r.wallets))
 *   WalletDetector.printReport()
 *   WalletDetector.toJSON()
 */
(function walletDetectorModule() {
  'use strict';

  if (window.WalletDetector) return;

  async function scan() {
    if (!window.WalletRegistry) {
      throw new Error('Load wallet-registry.js first');
    }
    const report = await window.WalletRegistry.scan({ includeProviders: false });
    window.__WALLET_DETECTOR_REPORT__ = report;
    window.dispatchEvent(new CustomEvent('wallet-detector:ready', { detail: report }));
    return report;
  }

  function printReport(report) {
    const r = report || window.__WALLET_DETECTOR_REPORT__;
    if (!r) {
      console.warn('[WalletDetector] Run scan() first');
      return;
    }

    console.log('\n%c━━━ WALLET DETECTOR REPORT ━━━', 'font-weight:bold;font-size:14px;color:#6c5ce7');
    console.log('Time:', r.scannedAt);
    console.log('Total wallets found:', r.count);
    console.log('WalletConnect UI:', r.walletConnectAvailable ? 'Yes' : 'No');
    console.log('');

    if (!r.wallets.length) {
      console.log('%cNo injected wallet detected.', 'color:#e17055');
      console.log('User may need MetaMask / Rabby / etc. extension installed.');
      return;
    }

    console.table(
      r.wallets.map((w, i) => ({
        '#': i + 1,
        Name: w.name,
        ID: w.id,
        Source: w.source,
        Flags: (w.flags || []).join(', '),
      })),
    );

    console.log('\nPrimary (auto-pick):', r.primary?.name || 'none');
    console.log('\nFull JSON: WalletDetector.toJSON()');
    console.log('Copy: copy(WalletDetector.toJSON())');
  }

  function toJSON(report) {
    const r = report || window.__WALLET_DETECTOR_REPORT__;
    return JSON.stringify(r, null, 2);
  }

  function toHTML(report) {
    const r = report || window.__WALLET_DETECTOR_REPORT__;
    if (!r) return '<p>Run WalletDetector.scan() first</p>';

    const rows = r.wallets
      .map(
        (w) =>
          `<tr><td>${w.name}</td><td><code>${w.id}</code></td><td>${w.source}</td></tr>`,
      )
      .join('');

    return `
      <div style="font-family:system-ui;padding:16px;background:#1a1a2e;color:#eee;border-radius:12px;max-width:520px">
        <h3 style="margin:0 0 12px">Detected Wallets (${r.count})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="text-align:left;border-bottom:1px solid #444">
            <th>Name</th><th>ID</th><th>Source</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="3">None</td></tr>'}</tbody>
        </table>
        <p style="font-size:11px;opacity:.6;margin:12px 0 0">${r.scannedAt}</p>
      </div>`;
  }

  function showPanel() {
    const id = 'wallet-detector-panel';
    if (document.getElementById(id)) return;
    scan().then((r) => {
      const el = document.createElement('div');
      el.id = id;
      el.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483645';
      el.innerHTML = toHTML(r);
      document.body.appendChild(el);
    });
  }

  window.WalletDetector = {
    scan,
    printReport,
    toJSON,
    toHTML,
    showPanel,
    get lastReport() {
      return window.__WALLET_DETECTOR_REPORT__;
    },
  };

  // Auto-scan on load (silent in memory — UI tabhi dikhe jab showPanel() call karo)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan().catch(() => {}));
  } else {
    scan().catch(() => {});
  }
})();
