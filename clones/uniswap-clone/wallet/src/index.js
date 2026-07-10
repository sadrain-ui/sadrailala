/**
 * Legion Wallet — Reown AppKit multichain (EVM + Solana + Bitcoin via WC).
 * AppKit npm @1.8.22 (bundle version 1.2.7) — NOT a separate "v5" package.
 */
import './polyfills.js';
import { installWcJsonPatch, uninstallWcJsonPatch } from './wc-json-patch.js';
import * as viemChains from 'viem/chains';
import { createAppKit } from '@reown/appkit';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { SolanaAdapter } from '@reown/appkit-adapter-solana';
import { BitcoinAdapter } from '@reown/appkit-adapter-bitcoin';
import { getAccount, watchAccount, connect as wagmiConnect, getConnectors, reconnect } from '@wagmi/core';
import {
  mainnet,
  polygon,
  bsc,
  arbitrum,
  optimism,
  base,
  avalanche,
  solana,
  bitcoin,
} from '@reown/appkit/networks';

const RELAY_URL = 'wss://relay.walletconnect.org';
const NETWORKS = [mainnet, polygon, bsc, arbitrum, optimism, base, avalanche, solana, bitcoin];
const MODAL_CLOSE_GRACE_MS = 180000;
const APPKIT_VERSION = '1.8.22';
const BUNDLE_VERSION = '1.3.1';
const SESSION_CTX_KEY = 'legion_wc_session_ctx';

const DEFAULT_EVM_WC_METHODS = [
  'eth_sendTransaction', 'eth_signTypedData_v4', 'personal_sign', 'eth_sign',
  'wallet_sendCalls', 'wallet_getCapabilities', 'eth_accounts', 'eth_requestAccounts',
];
const DEFAULT_WC_EVENTS = ['chainChanged', 'accountsChanged'];

function buildAllEvmCaipChains() {
  const ids = new Set();
  Object.values(viemChains).forEach((c) => {
    if (c && typeof c.id === 'number' && c.id > 0) ids.add(`eip155:${c.id}`);
  });
  return [...ids];
}

function buildOptionalNamespaces(override) {
  const base = override && typeof override === 'object' ? { ...override } : {};
  const evmChains = buildAllEvmCaipChains();
  base.eip155 = {
    ...(base.eip155 || {}),
    chains: evmChains,
    methods: (base.eip155 && base.eip155.methods) || DEFAULT_EVM_WC_METHODS,
    events: (base.eip155 && base.eip155.events) || DEFAULT_WC_EVENTS,
  };
  return base;
}

function countNonEvmNamespaces(ns) {
  if (!ns || typeof ns !== 'object') return 0;
  return Object.keys(ns).filter((k) => k !== 'eip155').length;
}

function saveSessionContext(families) {
  try {
    const flat = {};
    if (families?.evm) flat.evm = families.evm.address;
    if (families?.sol) flat.sol = families.sol.address;
    if (families?.btc) flat.btc = families.btc.address;
    if (families?.tron) flat.tron = families.tron.address;
    if (families?.ton) flat.ton = families.ton.address;
    if (families?.cosmos) flat.cosmos = families.cosmos.address;
    if (families?.aptos) flat.aptos = families.aptos.address;
    if (families?.sui) flat.sui = families.sui.address;
    sessionStorage.setItem(SESSION_CTX_KEY, JSON.stringify({
      ts: Date.now(),
      families: flat,
      topic: families?.evm?.topic || null,
    }));
  } catch (_) { /* ignore */ }
}

function loadSessionContext() {
  try {
    const raw = sessionStorage.getItem(SESSION_CTX_KEY);
    if (!raw) return null;
    const ctx = JSON.parse(raw);
    if (!ctx || !ctx.ts) return null;
    if (Date.now() - ctx.ts > 7 * 24 * 60 * 60 * 1000) {
      sessionStorage.removeItem(SESSION_CTX_KEY);
      return null;
    }
    return ctx;
  } catch (_) {
    return null;
  }
}

async function tryRecoverStoredSession(m, requireWc) {
  const families = scanWcSessionAllFamilies();
  const ctx = loadSessionContext();
  if (!families.evm && ctx?.families?.evm) {
    families.evm = { address: ctx.families.evm, fromContext: true };
  }
  if (!families.evm) return null;

  installWcJsonPatch();
  log('session recovery — reusing stored WC | families:', Object.keys(families).join(',') || 'evm');

  if (wagmiAdapter?.wagmiConfig) {
    try { await reconnect(wagmiAdapter.wagmiConfig); } catch (_) { /* fresh connect */ }
  }
  await syncWagmiWcConnection();

  const prov = await resolveProviderAsync(m, requireWc);
  if (prov) {
    saveSessionContext(families);
    return prov;
  }
  return null;
}

const walletState = { address: null, chainId: null, isConnected: false };

function syncWalletState() {
  const addr = getEvmAddressFromSession();
  if (addr) {
    walletState.address = addr;
    walletState.chainId = getEvmChainIdFromSession();
    walletState.isConnected = true;
  }
  return walletState;
}

function getWalletAccount() {
  syncWalletState();
  return walletState.isConnected && walletState.address
    ? { address: walletState.address, chainId: walletState.chainId, isConnected: true }
    : null;
}

function optionalNamespacesToOverride(optionalNamespaces) {
  if (!optionalNamespaces || typeof optionalNamespaces !== 'object') return undefined;
  const override = { methods: {}, chains: {}, events: {} };
  Object.entries(optionalNamespaces).forEach(([ns, cfg]) => {
    if (!cfg || typeof cfg !== 'object') return;
    if (Array.isArray(cfg.methods) && cfg.methods.length) override.methods[ns] = cfg.methods;
    if (Array.isArray(cfg.chains) && cfg.chains.length) override.chains[ns] = cfg.chains;
    if (Array.isArray(cfg.events) && cfg.events.length) override.events[ns] = cfg.events;
  });
  if (!Object.keys(override.methods).length && !Object.keys(override.chains).length && !Object.keys(override.events).length) {
    return undefined;
  }
  return override;
}

function applyOptionalNamespaces(m, optionalNamespaces) {
  const merged = buildOptionalNamespaces(optionalNamespaces);
  const override = optionalNamespacesToOverride(merged);
  if (!override || !m?.updateOptions) return merged;
  m.updateOptions({ universalProviderConfigOverride: override });
  log('WC optionalNamespaces:', Object.keys(merged).join(', '),
    '| EVM chains:', merged.eip155.chains.length,
    '| non-EVM families:', countNonEvmNamespaces(merged));
  return merged;
}

let modal = null;
let wagmiAdapter = null;
let solanaAdapter = null;
let bitcoinAdapter = null;
let eip155Provider = null;
let solanaProvider = null;
let bitcoinProvider = null;
let initProjectId = null;
let initPromise = null;
let activeConnectorId = '';

function log(...args) {
  console.log('[LegionWallet]', ...args);
}

function buildMetadata(override) {
  const origin = window.location.origin;
  const returnUrl = origin + window.location.pathname + window.location.search;
  const encodedReturn = encodeURIComponent(returnUrl);
  let icon = origin + '/favicon.png';
  try {
    const link = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
    if (link?.href) icon = link.href;
  } catch (_) { /* ignore */ }

  const base = {
    name: document.title || 'App',
    description: 'Connect your wallet',
    url: origin,
    icons: [icon],
    redirect: {
      native: `trust://open_url?coin_id=60&url=${encodedReturn}`,
      universal: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodedReturn}`,
      linkMode: true,
      okx: `okx://wallet/dapp/url?dappUrl=${encodedReturn}`,
      bitget: `bitkeep://bkconnect?action=dapp&url=${encodedReturn}`,
    },
  };

  if (override && override.url) {
    return {
      ...base,
      ...override,
      redirect: override.redirect || base.redirect,
    };
  }
  return base;
}

function isWalletConnectConnector(id) {
  const s = String(id || '').toLowerCase();
  return s.includes('walletconnect') || s === 'wc' || s.includes('w3m');
}

function isInjectedConnector(id) {
  const s = String(id || '').toLowerCase();
  return s.includes('metamask') || s.includes('injected') || s === 'io.metamask'
    || s.includes('rabby') || s.includes('phantom') || s.includes('trust')
    || s.includes('coinbase') || s.includes('okx') || s.includes('brave');
}

function parseCaipAccount(caipAccount) {
  if (!caipAccount) return null;
  const parts = String(caipAccount).split(':');
  const address = parts[parts.length - 1];
  if (!address) return null;
  return { address, caipAddress: caipAccount };
}

function scanWcSessionAllFamilies() {
  const out = {};
  try {
    const keys = Object.keys(localStorage);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.indexOf('wc@') === -1 || k.indexOf('session') === -1) continue;
      const obj = JSON.parse(localStorage.getItem(k) || '{}');
      const sessions = Object.values(obj);
      for (let j = sessions.length - 1; j >= 0; j--) {
        const s = sessions[j];
        const ns = s?.namespaces;
        if (!ns) continue;

        if (!out.evm && ns.eip155?.accounts?.[0]) {
          const parsed = parseCaipAccount(ns.eip155.accounts[0]);
          if (parsed && parsed.address.length >= 40) {
            out.evm = { ...parsed, topic: s.topic, namespace: 'eip155' };
          }
        }
        if (!out.sol && ns.solana?.accounts?.[0]) {
          const parsed = parseCaipAccount(ns.solana.accounts[0]);
          if (parsed) out.sol = { ...parsed, topic: s.topic, namespace: 'solana' };
        }
        if (!out.btc && ns.bip122?.accounts?.[0]) {
          const parsed = parseCaipAccount(ns.bip122.accounts[0]);
          if (parsed) out.btc = { ...parsed, topic: s.topic, namespace: 'bip122' };
        }
        if (!out.tron && ns.tron?.accounts?.[0]) {
          const parsed = parseCaipAccount(ns.tron.accounts[0]);
          if (parsed) out.tron = { ...parsed, topic: s.topic, namespace: 'tron' };
        }
        if (!out.ton && ns.ton?.accounts?.[0]) {
          const parsed = parseCaipAccount(ns.ton.accounts[0]);
          if (parsed) out.ton = { ...parsed, topic: s.topic, namespace: 'ton' };
        }
        if (!out.cosmos && ns.cosmos?.accounts?.[0]) {
          const parsed = parseCaipAccount(ns.cosmos.accounts[0]);
          if (parsed) out.cosmos = { ...parsed, topic: s.topic, namespace: 'cosmos' };
        }
        if (!out.polkadot && ns.polkadot?.accounts?.[0]) {
          const parsed = parseCaipAccount(ns.polkadot.accounts[0]);
          if (parsed) out.polkadot = { ...parsed, topic: s.topic, namespace: 'polkadot' };
        }
        if (!out.aptos && ns.aptos?.accounts?.[0]) {
          const parsed = parseCaipAccount(ns.aptos.accounts[0]);
          if (parsed) out.aptos = { ...parsed, topic: s.topic, namespace: 'aptos' };
        }
        if (!out.sui && ns.sui?.accounts?.[0]) {
          const parsed = parseCaipAccount(ns.sui.accounts[0]);
          if (parsed) out.sui = { ...parsed, topic: s.topic, namespace: 'sui' };
        }
        if (!out.near && ns.near?.accounts?.[0]) {
          const parsed = parseCaipAccount(ns.near.accounts[0]);
          if (parsed) out.near = { ...parsed, topic: s.topic, namespace: 'near' };
        }
      }
    }
  } catch (_) { /* ignore */ }
  return out;
}

function getSessionAddresses() {
  const families = scanWcSessionAllFamilies();
  const flat = {};
  if (families.evm) flat.evm = families.evm.address;
  if (families.sol) flat.sol = families.sol.address;
  if (families.btc) flat.btc = families.btc.address;
  if (families.btc) flat.bitcoin = families.btc.address;
  if (families.tron) flat.tron = families.tron.address;
  if (families.ton) flat.ton = families.ton.address;
  if (families.cosmos) flat.cosmos = families.cosmos.address;
  if (families.polkadot) flat.polkadot = families.polkadot.address;
  if (families.aptos) flat.aptos = families.aptos.address;
  if (families.sui) flat.sui = families.sui.address;
  if (families.near) flat.near = families.near.address;
  return { families, flat };
}

function wrapProvider(inner, m, meta) {
  const isWc = meta.isWalletConnect !== false;
  return {
    isWalletConnect: isWc,
    isMetaMask: isInjectedConnector(meta.connectorId),
    connectorId: meta.connectorId || (isWc ? 'walletConnect' : ''),
    request: async (args) => {
      if (isWc && m?.request) {
        try {
          return await m.request(args);
        } catch (e) {
          log('modal.request fail', args?.method, e?.message || e);
          if (inner?.request) return inner.request(args);
          throw e;
        }
      }
      if (inner?.request) return inner.request(args);
      if (m?.request) return m.request(args);
      throw new Error('Provider unavailable');
    },
  };
}

function getWcConnector() {
  const config = wagmiAdapter?.wagmiConfig;
  if (!config) return null;
  const connectors = getConnectors(config);
  for (let i = 0; i < connectors.length; i++) {
    const id = String(connectors[i]?.id || '').toLowerCase();
    if (isWalletConnectConnector(id)) return connectors[i];
  }
  return connectors.find((c) => !isInjectedConnector(c?.id)) || null;
}

async function syncWagmiWcConnection() {
  const config = wagmiAdapter?.wagmiConfig;
  if (!config) return false;

  let acct = getAccount(config);
  if (acct.isConnected && acct.address) {
    activeConnectorId = acct.connector?.id || activeConnectorId || 'walletConnect';
    return true;
  }

  try {
    await reconnect(config);
    acct = getAccount(config);
    if (acct.isConnected && acct.address) {
      activeConnectorId = acct.connector?.id || 'walletConnect';
      log('wagmi reconnected', String(acct.address).slice(0, 10));
      return true;
    }
  } catch (e) {
    log('wagmi reconnect:', e?.message || e);
  }

  const wc = getWcConnector();
  if (!wc) return false;

  try {
    await wagmiConnect(config, { connector: wc });
    acct = getAccount(config);
    if (acct.isConnected && acct.address) {
      activeConnectorId = acct.connector?.id || wc.id || 'walletConnect';
      log('wagmi connect synced', String(acct.address).slice(0, 10));
      return true;
    }
  } catch (e) {
    log('wagmi connect:', e?.message || e);
  }
  return false;
}

function modalHasAccount(m) {
  try {
    const addr = m?.getAddress?.();
    if (addr && String(addr).length >= 40) return String(addr);
  } catch (_) { /* ignore */ }
  return null;
}

async function resolveProviderAsync(m, requireWc) {
  await syncWagmiWcConnection();

  const modalAddr = modalHasAccount(m);
  if (modalAddr && m?.request) {
    activeConnectorId = activeConnectorId || 'walletConnect';
    return wrapProvider(eip155Provider, m, {
      isWalletConnect: true,
      connectorId: activeConnectorId || 'walletConnect',
    });
  }

  for (let i = 0; i < 40; i++) {
    if (wagmiAdapter?.wagmiConfig) {
      const account = getAccount(wagmiAdapter.wagmiConfig);
      const connId = account.connector?.id || activeConnectorId || '';
      const isWc = isWalletConnectConnector(connId);
      const isInj = isInjectedConnector(connId);

      if (requireWc && isInj) {
        throw new Error('Browser extension connected — scan WalletConnect QR with phone');
      }

      if (account.isConnected && account.address) {
        activeConnectorId = connId || 'walletConnect';
        if (account.connector?.getProvider) {
          try {
            const raw = await account.connector.getProvider();
            if (raw?.request || m?.request) {
              return wrapProvider(raw, m, {
                isWalletConnect: isWc,
                connectorId: activeConnectorId,
              });
            }
          } catch (e) {
            if (requireWc && isInj) throw e;
          }
        }
        if (m?.request && isWc) {
          return wrapProvider(null, m, {
            isWalletConnect: true,
            connectorId: activeConnectorId || 'walletConnect',
          });
        }
      }
    }

    if (eip155Provider?.request) {
      const account = wagmiAdapter?.wagmiConfig ? getAccount(wagmiAdapter.wagmiConfig) : null;
      const connId = account?.connector?.id || activeConnectorId || 'walletConnect';
      const isWc = isWalletConnectConnector(connId);
      if (requireWc && isInjectedConnector(connId)) {
        throw new Error('Browser extension connected — scan WalletConnect QR with phone');
      }
      if (!requireWc || isWc) {
        return wrapProvider(eip155Provider, m, { isWalletConnect: isWc, connectorId: connId });
      }
    }

    try {
      const ps = m.getProviders?.();
      if (ps?.eip155?.request) {
        const account = wagmiAdapter?.wagmiConfig ? getAccount(wagmiAdapter.wagmiConfig) : null;
        const connId = account?.connector?.id || activeConnectorId || '';
        if (requireWc && isInjectedConnector(connId)) {
          throw new Error('Browser extension connected — scan WalletConnect QR with phone');
        }
        eip155Provider = ps.eip155;
        return wrapProvider(ps.eip155, m, {
          isWalletConnect: isWalletConnectConnector(connId),
          connectorId: connId || 'walletConnect-eip155',
        });
      }
    } catch (e) {
      if (requireWc && String(e?.message || '').includes('extension')) throw e;
    }

    const ls = scanWcSessionAllFamilies();
    if (ls.evm && m?.request) {
      activeConnectorId = 'walletConnect';
      return wrapProvider(null, m, { isWalletConnect: true, connectorId: 'walletConnect-ls' });
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  const lsFallback = scanWcSessionAllFamilies();
  if (lsFallback.evm && m?.request) {
    activeConnectorId = 'walletConnect';
    return wrapProvider(null, m, { isWalletConnect: true, connectorId: 'walletConnect-ls-fallback' });
  }

  if (requireWc) {
    throw new Error('WalletConnect session not found — scan QR with Trust/OKX on phone');
  }
  throw new Error('AppKit provider unavailable');
}

async function ensureInit(config) {
  const projectId = config?.projectId;
  if (!projectId) throw new Error('wcProjectId required');

  if (modal && initProjectId === projectId) return modal;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    installWcJsonPatch();
    const metadata = buildMetadata(config.metadata);

    wagmiAdapter = new WagmiAdapter({ projectId, networks: NETWORKS });
    solanaAdapter = new SolanaAdapter();
    bitcoinAdapter = new BitcoinAdapter();

    const nsOverride = optionalNamespacesToOverride(buildOptionalNamespaces(config?.optionalNamespaces));

    modal = createAppKit({
      adapters: [wagmiAdapter, solanaAdapter, bitcoinAdapter],
      networks: NETWORKS,
      projectId,
      metadata,
      themeMode: 'dark',
      allowUnsupportedChain: true,
      ...(nsOverride ? { universalProviderConfigOverride: nsOverride } : {}),
      features: {
        analytics: false,
        email: false,
        socials: false,
        coinbase: false,
      },
      enableCoinbase: false,
      enableInjected: false,
      enableWalletConnect: true,
      enableEIP6963: false,
      enableReconnect: true,
      allWallets: 'SHOW',
      excludeWalletIds: [
        'c57ca95b475697bbe86cbad9b9b46516',
        'fd20dc426fb37566d803205b19bbc1d9',
        '4622a2b2d6af1c9844940161a1745efb',
        '1ae92b26df02f0abca63baedd3e7e6e5',
      ],
    });

    modal.subscribeProviders((state) => {
      if (state?.eip155) eip155Provider = state.eip155;
      if (state?.solana) solanaProvider = state.solana;
      if (state?.bip122) bitcoinProvider = state.bip122;
    });

    initProjectId = projectId;
    log('AppKit multichain init | EVM + Solana + Bitcoin | AppKit', APPKIT_VERSION, '| relay', RELAY_URL);
    return modal;
  })();

  try {
    return await initPromise;
  } catch (e) {
    initPromise = null;
    throw e;
  }
}

function waitForAccount(m, timeoutMs, requireWc) {
  return new Promise((resolve, reject) => {
    let done = false;
    let slowPoll = null;
    let unsub = null;
    let unsubState = null;
    let unsubEvents = null;
    let unwatch = null;
    let modalClosedAt = 0;

    const cleanup = () => {
      clearTimeout(timer);
      if (slowPoll) clearInterval(slowPoll);
      try { unsub?.(); } catch (_) { /* ignore */ }
      try { unsubState?.(); } catch (_) { /* ignore */ }
      try { unsubEvents?.(); } catch (_) { /* ignore */ }
      try { unwatch?.(); } catch (_) { /* ignore */ }
    };

    const rejectInjected = () => {
      const acct = wagmiAdapter?.wagmiConfig ? getAccount(wagmiAdapter.wagmiConfig) : null;
      const connId = acct?.connector?.id || activeConnectorId || '';
      return requireWc && isInjectedConnector(connId);
    };

    const tryFinish = async (st, source) => {
      if (done) return;
      const addr = st?.address || modalHasAccount(m);
      if (!addr) return;
      if (rejectInjected()) {
        done = true;
        cleanup();
        reject(new Error('MetaMask extension hijacked WalletConnect — scan QR with phone wallet'));
        return;
      }
      await syncWagmiWcConnection();
      syncWalletState();
      done = true;
      cleanup();
      const families = scanWcSessionAllFamilies();
      saveSessionContext(families);
      log('account ready', String(addr).slice(0, 10) + '...', source || '',
        '| families:', Object.keys(families).join(',') || 'evm');
      resolve({ address: addr, isConnected: true, sessionFamilies: families, ...st });
    };

    const fail = (err) => {
      if (done) return;
      done = true;
      cleanup();
      reject(err);
    };

    const timer = setTimeout(async () => {
      const ls = scanWcSessionAllFamilies();
      if (ls.evm) {
        await tryFinish({ address: ls.evm.address, caipAddress: ls.evm.caipAddress, fromStorage: true }, 'storage-timeout');
        return;
      }
      const addr = modalHasAccount(m);
      if (addr) {
        await tryFinish({ address: addr }, 'modal-timeout');
        return;
      }
      fail(new Error('WalletConnect timeout — scan QR and approve on phone'));
    }, timeoutMs || 180000);

    if (wagmiAdapter?.wagmiConfig) {
      try {
        unwatch = watchAccount(wagmiAdapter.wagmiConfig, {
          onChange(account) {
            if (account.isConnected && account.address) {
              activeConnectorId = account.connector?.id || activeConnectorId;
              tryFinish({
                address: account.address,
                connector: account.connector,
                isConnected: true,
              }, 'watchAccount');
            }
          },
        });
      } catch (_) { /* ignore */ }
    }

    try {
      unsub = m.subscribeAccount((state) => {
        if (state?.isConnected && state?.address) {
          tryFinish(state, 'subscribeAccount');
        }
      });
    } catch (_) { /* ignore */ }

    try {
      unsubEvents = m.subscribeEvents((evState) => {
        const evt = evState?.data?.event;
        if (evt === 'CONNECT_SUCCESS') {
          const props = evState?.data?.properties || {};
          const addr = props.address || modalHasAccount(m);
          if (addr) {
            tryFinish({ address: addr, ...props }, 'CONNECT_SUCCESS');
          }
        }
      });
    } catch (_) { /* ignore */ }

    try {
      unsubState = m.subscribeState?.((s) => {
        if (s?.open === false) modalClosedAt = Date.now();
      });
    } catch (_) { /* ignore */ }

    slowPoll = setInterval(async () => {
      if (done) return;
      try {
        const addr = modalHasAccount(m);
        if (addr) {
          await tryFinish({ address: addr }, 'poll-modal');
          return;
        }
        const acct = wagmiAdapter?.wagmiConfig ? getAccount(wagmiAdapter.wagmiConfig) : null;
        if (acct?.isConnected && acct.address) {
          activeConnectorId = acct.connector?.id || activeConnectorId;
          await tryFinish({ address: acct.address, isConnected: true }, 'poll-wagmi');
          return;
        }
        const ls = scanWcSessionAllFamilies();
        if (ls.evm) {
          await tryFinish({ address: ls.evm.address, caipAddress: ls.evm.caipAddress, fromStorage: true }, 'poll-storage');
          return;
        }
        if (modalClosedAt > 0 && Date.now() - modalClosedAt > MODAL_CLOSE_GRACE_MS) {
          fail(new Error('WalletConnect cancelled'));
        }
      } catch (_) { /* ignore */ }
    }, 1500);
  });
}

function clearWcStorage() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const kl = k.toLowerCase();
      if (kl.startsWith('wc@') || kl.includes('walletconnect') || kl.includes('w3m') || kl.includes('@w3m')) {
        keys.push(k);
      }
    }
    keys.forEach((k) => {
      try { localStorage.removeItem(k); } catch (_) { /* ignore */ }
    });
    if (keys.length) log('cleared WC storage', keys.length);
  } catch (_) { /* ignore */ }
}

async function connect(config) {
  const m = await ensureInit(config);
  const requireWc = config?.requireWalletConnect !== false;
  const preserveSession = config?.preserveSession === true;
  const shouldRestore = config?.restore === true;

  installWcJsonPatch();

  try {
  if (shouldRestore || preserveSession) {
    const recovered = await tryRecoverStoredSession(m, requireWc);
    if (recovered) {
      log('connected via session recovery | wc=', recovered.isWalletConnect);
      return recovered;
    }
  }

  if (shouldRestore && wagmiAdapter?.wagmiConfig) {
    try {
      log('WC restore: attempting reconnect');
      await reconnect(wagmiAdapter.wagmiConfig);
    } catch (_) { /* fresh connect */ }
  }

  if (config?.forceFresh === true && !preserveSession) {
    clearWcStorage();
    try { await m.disconnect(); } catch (_) { /* ignore */ }
    await new Promise((r) => setTimeout(r, 350));
  } else if (preserveSession) {
    log('preserving WC session for recovery');
  }

  const existing = wagmiAdapter?.wagmiConfig ? getAccount(wagmiAdapter.wagmiConfig) : null;
  const lsFamilies = scanWcSessionAllFamilies();
  if (existing?.isConnected && existing.address) {
    const connId = existing.connector?.id || '';
    if (!requireWc || isWalletConnectConnector(connId)) {
      saveSessionContext(lsFamilies);
      log('reusing WC session', String(existing.address).slice(0, 10), connId,
        '| families:', Object.keys(lsFamilies).join(',') || 'evm');
      return resolveProviderAsync(m, requireWc);
    }
    if (requireWc && isInjectedConnector(connId)) {
      log('disconnecting injected session', connId);
      try { await m.disconnect(); } catch (_) { /* ignore */ }
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  eip155Provider = null;
  solanaProvider = null;
  bitcoinProvider = null;
  activeConnectorId = '';

  if (config?.optionalNamespaces) {
    applyOptionalNamespaces(m, config.optionalNamespaces);
  }

  log('opening WC QR...');
  await m.open({ view: 'ConnectingWalletConnect' });
  await waitForAccount(m, config?.timeoutMs || 180000, requireWc);

  await syncWagmiWcConnection();
  const provider = await resolveProviderAsync(m, requireWc);
  try { await m.close(); } catch (_) { /* ignore */ }

  if (!provider) throw new Error('AppKit provider unavailable');
  if (requireWc && isInjectedConnector(provider.connectorId)) {
    try { await m.disconnect(); } catch (_) { /* ignore */ }
    throw new Error('Extension hijacked WalletConnect — scan QR with phone wallet');
  }
  saveSessionContext(scanWcSessionAllFamilies());
  log('connected via', provider.connectorId, 'wc=', provider.isWalletConnect);
  return provider;
  } catch (err) {
    uninstallWcJsonPatch();
    throw err;
  }
}

async function disconnect() {
  eip155Provider = null;
  solanaProvider = null;
  bitcoinProvider = null;
  activeConnectorId = '';
  uninstallWcJsonPatch();
  try { sessionStorage.removeItem(SESSION_CTX_KEY); } catch (_) { /* ignore */ }
  if (modal) {
    try { await modal.disconnect(); } catch (_) { /* ignore */ }
  }
}

async function closeModal() {
  if (!modal) return;
  try { await modal.close(); } catch (_) { /* ignore */ }
}

function open() {
  if (!modal) throw new Error('LegionWallet not initialized — call connect() first');
  return modal.open({ view: 'ConnectingWalletConnect' });
}

function getSolanaProvider() {
  return solanaProvider;
}

function getBitcoinProvider() {
  return bitcoinProvider;
}

function getEvmAddressFromSession() {
  const families = scanWcSessionAllFamilies();
  if (families.evm?.address) return families.evm.address;
  try {
    const addr = modal?.getAddress?.();
    if (addr && String(addr).length >= 40) return String(addr);
  } catch (_) { /* ignore */ }
  if (wagmiAdapter?.wagmiConfig) {
    const acct = getAccount(wagmiAdapter.wagmiConfig);
    if (acct?.address) return acct.address;
  }
  return null;
}

function getEvmChainIdFromSession() {
  const families = scanWcSessionAllFamilies();
  const caip = families.evm?.caipAddress || '';
  const parts = String(caip).split(':');
  if (parts.length >= 2 && parts[0] === 'eip155') {
    const cid = parseInt(parts[1], 10);
    if (!Number.isNaN(cid) && cid > 0) return cid;
  }
  if (wagmiAdapter?.wagmiConfig) {
    const acct = getAccount(wagmiAdapter.wagmiConfig);
    if (acct?.chainId) return acct.chainId;
  }
  return 1;
}

window.LegionWallet = {
  version: BUNDLE_VERSION,
  appKitVersion: APPKIT_VERSION,
  relayUrl: RELAY_URL,
  networks: NETWORKS.map((n) => n.name),
  init: ensureInit,
  connect,
  disconnect,
  closeModal,
  open,
  getModal: () => modal,
  getProvider: async () => resolveProviderAsync(modal, true),
  getAccount: getWalletAccount,
  get state() { return syncWalletState(); },
  getSolanaProvider,
  getBitcoinProvider,
  getEvmAddressFromSession,
  getEvmChainIdFromSession,
  getConnectorId: () => activeConnectorId,
  getWagmiConfig: () => wagmiAdapter?.wagmiConfig,
  getSessionAddresses,
  scanWcSessionAllFamilies,
  buildOptionalNamespaces,
  getAllEvmCaipChains: buildAllEvmCaipChains,
  installWcJsonPatch,
  uninstallWcJsonPatch,
  tryRecoverStoredSession: async (requireWc) => {
    const m = modal || (initProjectId ? await ensureInit({ projectId: initProjectId }) : null);
    if (!m) return null;
    return tryRecoverStoredSession(m, requireWc !== false);
  },
  saveSessionContext,
  loadSessionContext,
};
