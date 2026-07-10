/**
 * Universal wallet registry — EIP-6963 + legacy window scans.
 * Works in browser: window.WalletRegistry.scan()
 */
(function walletRegistryModule() {
  'use strict';

  if (window.WalletRegistry) return;

  /** @type {Map<string, object>} */
  const eip6963Providers = new Map();

  const KNOWN_FLAGS = [
    { key: 'isMetaMask', name: 'MetaMask', id: 'io.metamask' },
    { key: 'isRabby', name: 'Rabby', id: 'io.rabby' },
    { key: 'isCoinbaseWallet', name: 'Coinbase Wallet', id: 'com.coinbase.wallet' },
    { key: 'isOkxWallet', name: 'OKX Wallet', id: 'com.okex.wallet' },
    { key: 'isOKExWallet', name: 'OKX Wallet', id: 'com.okex.wallet' },
    { key: 'isTrust', name: 'Trust Wallet', id: 'com.trustwallet.app' },
    { key: 'isTrustWallet', name: 'Trust Wallet', id: 'com.trustwallet.app' },
    { key: 'isBraveWallet', name: 'Brave Wallet', id: 'com.brave.wallet' },
    { key: 'isPhantom', name: 'Phantom', id: 'app.phantom' },
    { key: 'isRainbow', name: 'Rainbow', id: 'me.rainbow' },
    { key: 'isTokenPocket', name: 'TokenPocket', id: 'pro.tokenpocket' },
    { key: 'isBitKeep', name: 'Bitget Wallet', id: 'com.bitget.web3' },
    { key: 'isBitget', name: 'Bitget Wallet', id: 'com.bitget.web3' },
    { key: 'isImToken', name: 'imToken', id: 'im.token' },
    { key: 'isFrame', name: 'Frame', id: 'sh.frame' },
    { key: 'isZerion', name: 'Zerion', id: 'io.zerion' },
    { key: 'isExodus', name: 'Exodus', id: 'exodus' },
    { key: 'isSafePal', name: 'SafePal', id: 'com.safepal' },
    { key: 'isOneKey', name: 'OneKey', id: 'so.onekey.app' },
    { key: 'isXDEFI', name: 'XDEFI', id: 'xdefi' },
    { key: 'isTalisman', name: 'Talisman', id: 'xyz.talisman' },
    { key: 'isEnkrypt', name: 'Enkrypt', id: 'com.enkrypt' },
    { key: 'isBackpack', name: 'Backpack', id: 'app.backpack' },
    { key: 'isRonin', name: 'Ronin', id: 'com.roninchain.wallet' },
  ];

  const GLOBAL_SLOTS = [
    { path: 'ethereum', label: 'window.ethereum' },
    { path: 'coinbaseWalletExtension', label: 'window.coinbaseWalletExtension' },
    { path: 'okxwallet', label: 'window.okxwallet' },
    { path: 'trustwallet', label: 'window.trustwallet' },
    { path: 'phantom.ethereum', label: 'window.phantom.ethereum' },
    { path: 'bitkeep.ethereum', label: 'window.bitkeep.ethereum' },
    { path: 'bybitWallet', label: 'window.bybitWallet' },
    { path: 'gatewallet', label: 'window.gatewallet' },
  ];

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }

  function identifyProvider(provider, source = 'unknown') {
    if (!provider || typeof provider !== 'object') return null;

    for (const f of KNOWN_FLAGS) {
      if (provider[f.key] === true) {
        return { name: f.name, id: f.id, source, provider, flags: [f.key] };
      }
    }

    if (provider.isMetaMask && !provider.isRabby) {
      return { name: 'MetaMask', id: 'io.metamask', source, provider, flags: ['isMetaMask'] };
    }

    const rdns = provider.providerInfo?.rdns || provider.info?.rdns;
    const name = provider.providerInfo?.name || provider.info?.name;
    if (rdns || name) {
      return { name: name || rdns, id: rdns || name, source, provider, flags: ['providerInfo'] };
    }

    return { name: 'Unknown Injected', id: 'injected.unknown', source, provider, flags: [] };
  }

  function listenEip6963(timeoutMs = 300) {
    return new Promise((resolve) => {
      const found = [];

      const onAnnounce = (event) => {
        const { info, provider } = event.detail || {};
        if (!provider) return;
        const entry = {
          name: info?.name || 'Unknown',
          id: info?.rdns || info?.uuid || 'unknown',
          icon: info?.icon,
          source: 'eip6963',
          provider,
          flags: ['eip6963'],
          uuid: info?.uuid,
        };
        const key = entry.id + (entry.uuid || '');
        if (!eip6963Providers.has(key)) {
          eip6963Providers.set(key, entry);
          found.push(entry);
        }
      };

      window.addEventListener('eip6963:announceProvider', onAnnounce);
      window.dispatchEvent(new Event('eip6963:requestProvider'));

      setTimeout(() => {
        window.removeEventListener('eip6963:announceProvider', onAnnounce);
        resolve(found);
      }, timeoutMs);
    });
  }

  function scanLegacy() {
    const results = [];
    const seen = new Set();

    const add = (entry) => {
      if (!entry?.provider || seen.has(entry.provider)) return;
      seen.add(entry.provider);
      results.push(entry);
    };

    if (window.ethereum?.providers?.length) {
      for (const p of window.ethereum.providers) {
        add(identifyProvider(p, 'ethereum.providers'));
      }
    }

    for (const slot of GLOBAL_SLOTS) {
      const p = getPath(window, slot.path);
      if (p) add(identifyProvider(p, slot.label));
    }

  if (window.ethereum && !seen.has(window.ethereum)) {
      add(identifyProvider(window.ethereum, 'window.ethereum'));
    }

    return results;
  }

  async function scan(options = {}) {
    const timeout = options.eip6963Timeout ?? 400;
    const eip6963 = await listenEip6963(timeout);
    const legacy = scanLegacy();

    const merged = [];
    const seenProviders = new Set();
    const seenIds = new Set();

    const merge = (entry) => {
      if (!entry) return;
      if (entry.provider && seenProviders.has(entry.provider)) return;
      const idKey = entry.id + '|' + entry.name;
      if (seenIds.has(idKey) && !entry.provider) return;
      seenIds.add(idKey);
      if (entry.provider) seenProviders.add(entry.provider);
      merged.push({
        name: entry.name,
        id: entry.id,
        source: entry.source,
        flags: entry.flags || [],
        uuid: entry.uuid || null,
        hasProvider: !!entry.provider,
      });
    };

    for (const e of eip6963) merge(e);
    for (const e of legacy) merge(e);

    const walletConnect = !!(window.WalletConnectProvider || document.querySelector('w3m-modal, appkit-modal'));

    return {
      scannedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      count: merged.length,
      wallets: merged,
      walletConnectAvailable: walletConnect,
      primary: merged[0] || null,
      _providers: options.includeProviders
        ? [...eip6963, ...legacy].map((e) => e.provider).filter(Boolean)
        : undefined,
    };
  }

  function getProviders(options = {}) {
    return scan({ ...options, includeProviders: true }).then((r) => {
      const legacy = scanLegacy();
      const eip = eip6963Providers;
      const all = [...legacy];
      for (const [, v] of eip) {
        if (!all.find((x) => x.provider === v.provider)) all.push(v);
      }
      return all.map((x) => x.provider).filter(Boolean);
    });
  }

  function getProviderEntries() {
    const legacy = scanLegacy();
    const from6963 = [...eip6963Providers.values()];
    const out = [];
    const seen = new Set();
    for (const e of [...from6963, ...legacy]) {
      if (!e.provider || seen.has(e.provider)) continue;
      seen.add(e.provider);
      out.push(e);
    }
    return out;
  }

  function pickBestProvider(entries) {
    if (!entries?.length) return window.ethereum || null;
    // Prefer EIP-6963 entries, then first legacy
    const sorted = [...entries].sort((a, b) => {
      const score = (e) => (e.source === 'eip6963' ? 0 : 1);
      return score(a) - score(b);
    });
    return sorted[0].provider;
  }

  window.WalletRegistry = {
    scan,
    scanLegacy,
    listenEip6963,
    getProviders,
    getProviderEntries,
    pickBestProvider,
    identifyProvider,
    KNOWN_FLAGS,
  };
})();
