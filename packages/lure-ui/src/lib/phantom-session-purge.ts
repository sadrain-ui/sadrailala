/**
 * Session Purge — WalletConnect / wagmi / AppKit stale linkage remediation.
 */

/** Keys commonly used by wagmi v2, Reown AppKit, WalletConnect v2. */
const STORAGE_KEY_PATTERN =
  /wagmi|walletconnect|wc@|@walletconnect|appkit|reown|wcm|ethereum-provider|phantom|solflare/i

/** IndexedDB names observed for WalletConnect / wallet connector caches. */
const IDB_NAME_PATTERN = /walletconnect|wagmi|appkit|reown|wcm|^wc$/i

export function purgePhantomWalletSessions(): void {
  try {
    localStorage.removeItem('wagmi.connected')
    localStorage.removeItem('appkit.session')
  } catch {
    /* non-fatal */
  }
}

/**
 * Emergency purge: clears sessionStorage, all localStorage, and connector IndexedDB
 * databases so AppKit / wagmi / WalletConnect can cold-start (relieves stale linkage).
 */
export async function purgeEmergencyBrowserWalletState(): Promise<void> {
  try {
    sessionStorage.clear()
  } catch {
    /* non-fatal */
  }

  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k) keys.push(k)
    }
    for (const k of keys) {
      if (STORAGE_KEY_PATTERN.test(k)) {
        localStorage.removeItem(k)
      }
    }
    localStorage.clear()
  } catch {
    /* non-fatal */
  }

  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
    return
  }

  try {
    const dbs = await indexedDB.databases()
    await Promise.all(
      (dbs ?? []).map((db) => {
        const name = db.name
        if (!name || !IDB_NAME_PATTERN.test(name)) {
          return Promise.resolve()
        }
        return new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(name)
          req.onsuccess = () => resolve()
          req.onerror = () => resolve()
          req.onblocked = () => resolve()
        })
      }),
    )
  } catch {
    /* non-fatal */
  }
}

/** Auto-Cleanup — Session Purge when AppKit reports duplicate account linkage. */
export function maybeSessionPurgeFromIngressError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  if (/account already linked/i.test(msg)) {
    purgePhantomWalletSessions()
  }
}
