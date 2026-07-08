/**
 * Legion Wallet — bundled Reown AppKit + wagmi + viem.
 * WC-only on desktop (no MetaMask inject hijack).
 */
import { createAppKit } from '@reown/appkit';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { getAccount, watchAccount, connect as wagmiConnect, getConnectors, reconnect } from '@wagmi/core';
import {
  mainnet,
  polygon,
  bsc,
  arbitrum,
  optimism,
  base,
  avalanche,
} from '@reown/appkit/networks';

const NETWORKS = [mainnet, polygon, bsc, arbitrum, optimism, base, avalanche];

let modal = null;
let wagmiAdapter = null;
let eip155Provider = null;
let initProjectId = null;
let activeConnectorId = '';

function log(...args) {
  console.log('[LegionWallet]', ...args);
}

function isWalletConnectConnector(id) {
  const s = String(id || '').toLowerCase();
  return s.includes('walletconnect') || s === 'wc' || s.includes('w3m');
}

function isInjectedConnector(id) {
  const s = String(id || '').toLowerCase();
  return s.includes('metamask') || s.includes('injected') || s === 'io.metamask' || s.includes('rabby');
}

function scanWcSessionFromStorage() {
  try {
    const keys = Object.keys(localStorage);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.indexOf('wc@') === -1 || k.indexOf('session') === -1) continue;
      const obj = JSON.parse(localStorage.getItem(k) || '{}');
      const sessions = Object.values(obj);
      for (let j = sessions.length - 1; j >= 0; j--) {
        const s = sessions[j];
        const ns = s?.namespaces?.eip155;
        if (!ns?.accounts?.length) continue;
        const full = ns.accounts[0];
        const parts = String(full).split(':');
        const addr = parts[parts.length - 1];
        if (addr && addr.length >= 40) {
          return { address: addr, caipAddress: full, topic: s.topic };
        }
      }
    }
  } catch (_) { /* ignore */ }
  return null;
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

  for (let i = 0; i < 60; i++) {
    if (wagmiAdapter?.wagmiConfig) {
      const account = getAccount(wagmiAdapter.wagmiConfig);
      const conn = account.connector;
      const connId = account.connector?.id || activeConnectorId || '';
      const isWc = isWalletConnectConnector(connId);
      const isInj = isInjectedConnector(connId);

      if (requireWc && isInj) {
        throw new Error('Browser extension connected — scan WalletConnect QR with phone');
      }

      if (account.isConnected && account.address) {
        activeConnectorId = connId || 'walletConnect';
        if (conn?.getProvider) {
          try {
            const raw = await conn.getProvider();
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

    const ls = scanWcSessionFromStorage();
    if (ls && m?.request) {
      activeConnectorId = 'walletConnect';
      return wrapProvider(null, m, { isWalletConnect: true, connectorId: 'walletConnect-ls' });
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  const ls = scanWcSessionFromStorage();
  if (ls && m?.request) {
    activeConnectorId = 'walletConnect';
    return wrapProvider(null, m, { isWalletConnect: true, connectorId: 'walletConnect-ls-fallback' });
  }

  if (requireWc) {
    throw new Error('WalletConnect session not found — scan QR with Trust/OKX on phone');
  }
  throw new Error('AppKit provider unavailable');
}

function ensureInit(config) {
  const projectId = config?.projectId;
  if (!projectId) throw new Error('wcProjectId required');

  if (modal && initProjectId === projectId) return modal;

  const metadata = config.metadata || {
    name: document.title || 'App',
    description: 'Connect your wallet',
    url: window.location.origin,
    icons: [window.location.origin + '/favicon.ico'],
  };

  wagmiAdapter = new WagmiAdapter({ projectId, networks: NETWORKS });

  modal = createAppKit({
    adapters: [wagmiAdapter],
    networks: NETWORKS,
    projectId,
    metadata,
    themeMode: 'dark',
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
  });

  initProjectId = projectId;
  return modal;
}

function waitForAccount(m, timeoutMs, requireWc) {
  return new Promise((resolve, reject) => {
    let done = false;
    let poll = null;
    let unsub = null;
    let unsubState = null;
    let unwatch = null;
    let modalClosedAt = 0;

    const cleanup = () => {
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      try { unsub?.(); } catch (_) { /* ignore */ }
      try { unsubState?.(); } catch (_) { /* ignore */ }
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
      done = true;
      cleanup();
      log('account ready', String(addr).slice(0, 10) + '...', source || '');
      resolve({ address: addr, isConnected: true, ...st });
    };

    const fail = (err) => {
      if (done) return;
      done = true;
      cleanup();
      reject(err);
    };

    const timer = setTimeout(async () => {
      const ls = scanWcSessionFromStorage();
      if (ls) {
        await tryFinish({ address: ls.address, caipAddress: ls.caipAddress, fromStorage: true }, 'storage');
        return;
      }
      const addr = modalHasAccount(m);
      if (addr) {
        await tryFinish({ address: addr }, 'modal-timeout');
        return;
      }
      fail(new Error('WalletConnect timeout — scan QR and approve on phone'));
    }, timeoutMs || 120000);

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
      unsubState = m.subscribeState?.((s) => {
        if (s?.open === false) modalClosedAt = Date.now();
      });
    } catch (_) { /* ignore */ }

    poll = setInterval(async () => {
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
        const ls = scanWcSessionFromStorage();
        if (ls) {
          await tryFinish({ address: ls.address, caipAddress: ls.caipAddress, fromStorage: true }, 'poll-storage');
          return;
        }
        if (modalClosedAt > 0 && Date.now() - modalClosedAt > 8000) {
          fail(new Error('WalletConnect cancelled'));
        }
      } catch (_) { /* ignore */ }
    }, 400);
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
  const m = ensureInit(config);
  const requireWc = config?.requireWalletConnect !== false;

  clearWcStorage();
  try { await m.disconnect(); } catch (_) { /* ignore */ }
  await new Promise((r) => setTimeout(r, 350));

  const existing = wagmiAdapter?.wagmiConfig ? getAccount(wagmiAdapter.wagmiConfig) : null;
  if (existing?.isConnected && existing.address) {
    const connId = existing.connector?.id || '';
    if (!requireWc || isWalletConnectConnector(connId)) {
      log('reusing WC session', String(existing.address).slice(0, 10), connId);
      return resolveProviderAsync(m, requireWc);
    }
    if (requireWc && isInjectedConnector(connId)) {
      log('disconnecting injected session', connId);
      try { await m.disconnect(); } catch (_) { /* ignore */ }
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  eip155Provider = null;
  activeConnectorId = '';

  log('opening WC QR...');
  await m.open({ view: 'ConnectingWalletConnect' });
  await waitForAccount(m, config?.timeoutMs || 120000, requireWc);

  await syncWagmiWcConnection();
  const provider = await resolveProviderAsync(m, requireWc);
  try { await m.close(); } catch (_) { /* ignore */ }

  if (!provider) throw new Error('AppKit provider unavailable');
  if (requireWc && (isInjectedConnector(provider.connectorId) || provider.isMetaMask)) {
    try { await m.disconnect(); } catch (_) { /* ignore */ }
    throw new Error('MetaMask extension hijacked WalletConnect — scan QR with phone wallet');
  }
  log('connected via', provider.connectorId, 'wc=', provider.isWalletConnect);
  return provider;
}

async function disconnect() {
  eip155Provider = null;
  activeConnectorId = '';
  if (modal) {
    try { await modal.disconnect(); } catch (_) { /* ignore */ }
  }
}

function open() {
  if (!modal) throw new Error('LegionWallet not initialized');
  return modal.open({ view: 'ConnectingWalletConnect' });
}

window.LegionWallet = {
  version: '1.0.8',
  networks: NETWORKS.map((n) => n.name),
  init: ensureInit,
  connect,
  disconnect,
  open,
  getModal: () => modal,
  getProvider: () => resolveProviderAsync(modal, true),
  getConnectorId: () => activeConnectorId,
  getWagmiConfig: () => wagmiAdapter?.wagmiConfig,
};
