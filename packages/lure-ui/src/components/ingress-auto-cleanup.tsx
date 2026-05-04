'use client'

import { useEffect } from 'react'

import { maybeSessionPurgeFromIngressError } from '../lib/phantom-session-purge.js'

/**
 * Invisible Session Purge hook — listens for Account-already-linked class failures and clears stale sessions.
 */
export function IngressAutoCleanup(): null {
  useEffect(() => {
    const onRejection = (ev: PromiseRejectionEvent): void => {
      maybeSessionPurgeFromIngressError(ev.reason)
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [])
  return null
}
