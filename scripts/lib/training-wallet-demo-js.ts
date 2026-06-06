/**
 * Self-contained training wallet demo bundle (vanilla JS) — mirrors Lure multi-chain ingress.
 * Injected into generated static clones; no build step required.
 */

export type TrainingWalletDemoConfig = {
  demoApiUrl: string
  walletConnectProjectId?: string
}

export function buildTrainingWalletDemoCss(): string {
  return `
#legion-training-banner{position:fixed;top:0;left:0;right:0;z-index:2147483646;background:#b91c1c;color:#fff;padding:10px 16px;font:600 14px/1.4 system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.35);}
#legion-training-panel{position:fixed;bottom:20px;right:20px;z-index:2147483647;width:min(380px,calc(100vw - 32px));background:#0f172a;color:#e2e8f0;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.45);font:14px/1.45 system-ui,sans-serif;overflow:hidden;}
#legion-training-panel header{padding:12px 14px;background:#1e293b;font-weight:600;font-size:13px;}
#legion-training-panel .tabs{display:flex;border-bottom:1px solid #334155;}
#legion-training-panel .tabs button{flex:1;padding:10px;border:0;background:transparent;color:#94a3b8;cursor:pointer;font:inherit;}
#legion-training-panel .tabs button.active{background:#334155;color:#fff;}
#legion-training-panel .body{padding:14px;}
#legion-training-panel .status{min-height:2.5em;font-size:12px;color:#94a3b8;margin-bottom:10px;}
#legion-training-panel .actions{display:flex;flex-direction:column;gap:8px;}
#legion-training-panel button.primary{width:100%;padding:12px;border:0;border-radius:10px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer;}
#legion-training-panel button.primary:disabled{opacity:.5;cursor:not-allowed;}
#legion-training-panel button.secondary{width:100%;padding:10px;border:1px solid #475569;border-radius:10px;background:transparent;color:#e2e8f0;font:inherit;cursor:pointer;}
#legion-training-panel .success{color:#4ade80;font-weight:600;}
#legion-training-panel::after{content:"";display:block;height:0;}
body.legion-training-active{padding-top:48px;}
`.trim()
}

export function buildTrainingWalletDemoJs(config: TrainingWalletDemoConfig): string {
  const demoApi = config.demoApiUrl.replace(/\/$/, '')
  const wcProjectId = config.walletConnectProjectId?.trim() || ''

  return `/* Legion authorized training wallet demo — localhost only, no settlement */
(function () {
  var DEMO_API = ${JSON.stringify(demoApi)};
  var WC_PROJECT_ID = ${JSON.stringify(wcProjectId)};
  var ACTIVE_TAB = 'evm';

  function isLocalhost() {
    return /^https?:\\/\\/(localhost|127\\.0\\.0\\.1|\\[::1\\])(:\\d+)?$/i.test(window.location.origin);
  }

  if (!isLocalhost()) {
    document.body.innerHTML = '<p style="font:16px system-ui;padding:24px;color:#b91c1c">Training demo may only run on localhost.</p>';
    return;
  }

  function buildTrainingMessage() {
    return [
      'Legion security training — verify wallet ownership for demo only.',
      'No funds will move. No approvals are requested.',
      '',
      'Nonce: ' + Date.now()
    ].join('\\n');
  }

  function setStatus(text, isSuccess) {
    var el = document.getElementById('legion-training-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'status' + (isSuccess ? ' success' : '');
  }

  async function postRecord(payload) {
    var url = DEMO_API + '/api/training-demo/record';
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-legion-training-demo': '1'
      },
      body: JSON.stringify(Object.assign({ page_url: window.location.href }, payload))
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var msg = (data && data.message) || res.statusText || 'API error';
      throw new Error(msg);
    }
    return data;
  }

  async function connectEvm() {
    var eth = window.ethereum;
    if (!eth) throw new Error('No EVM wallet (MetaMask / Rabby / Coinbase). Install an injected wallet.');
    var accounts = await eth.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts[0]) throw new Error('No EVM account returned');
    return { address: accounts[0], provider: eth.isMetaMask ? 'MetaMask' : (eth.isCoinbaseWallet ? 'Coinbase' : 'Injected EVM') };
  }

  async function signEvm(address, provider) {
    var message = buildTrainingMessage();
    var sig = await window.ethereum.request({
      method: 'personal_sign',
      params: [message, address]
    });
    return { message: message, signature: sig, wallet_provider: provider };
  }

  async function connectSolana() {
    var sol = window.phantom && window.phantom.solana;
    if (!sol && window.solflare && window.solflare.isSolflare) sol = window.solflare;
    if (!sol) throw new Error('No Solana wallet (install Phantom or Solflare).');
    var resp = await sol.connect();
    var pubkey = (resp && resp.publicKey) ? resp.publicKey.toString() : (sol.publicKey && sol.publicKey.toString());
    if (!pubkey) throw new Error('Solana connect did not return a public key');
    var name = window.phantom && window.phantom.solana === sol ? 'Phantom' : 'Solflare';
    return { address: pubkey, provider: sol, name: name };
  }

  async function signSolana(conn) {
    var message = buildTrainingMessage();
    var encoded = new TextEncoder().encode(message);
    var result;
    if (conn.provider.signMessage) {
      result = await conn.provider.signMessage(encoded, 'utf8');
    } else {
      throw new Error('Wallet does not support signMessage');
    }
    var sig = result.signature;
    var sigHex = typeof sig === 'string' ? sig : (sig && sig.toString ? sig.toString() : String(sig));
    return { message: message, signature: sigHex, wallet_provider: conn.name };
  }

  async function connectTron() {
    if (window.tronLink && window.tronLink.request) {
      await window.tronLink.request({ method: 'tron_requestAccounts' });
    }
    var tw = window.tronWeb;
    if (!tw || !tw.defaultAddress || !tw.defaultAddress.base58) {
      throw new Error('TronLink not ready — unlock TronLink and refresh.');
    }
    return { address: tw.defaultAddress.base58, provider: 'TronLink' };
  }

  async function signTron(address) {
    var message = buildTrainingMessage();
    var tw = window.tronWeb;
    if (!tw || !tw.trx || !tw.trx.signMessageV2) {
      throw new Error('tronWeb.signMessageV2 unavailable');
    }
    var sig = await tw.trx.signMessageV2(message);
    return { message: message, signature: sig, wallet_provider: 'TronLink' };
  }

  async function runDemo() {
    var btn = document.getElementById('legion-training-primary');
    if (btn) btn.disabled = true;
    setStatus('Connecting wallet…', false);
    try {
      var chain = ACTIVE_TAB;
      var wallet_address, signPayload, wallet_provider;

      if (chain === 'evm') {
        var evm = await connectEvm();
        wallet_address = evm.address;
        wallet_provider = evm.provider;
        setStatus('Signing training message (personal_sign)…', false);
        signPayload = await signEvm(wallet_address, wallet_provider);
      } else if (chain === 'sol') {
        var sol = await connectSolana();
        wallet_address = sol.address;
        wallet_provider = sol.name;
        setStatus('Signing training message…', false);
        signPayload = await signSolana(sol);
      } else if (chain === 'tron') {
        var tron = await connectTron();
        wallet_address = tron.address;
        wallet_provider = tron.provider;
        setStatus('Signing training message…', false);
        signPayload = await signTron(wallet_address);
      } else {
        throw new Error('Unsupported chain tab');
      }

      document.dispatchEvent(new CustomEvent('legion-training-wallet-connected', {
        detail: { address: wallet_address, chain: chain }
      }));

      setStatus('Sending to training API…', false);
      await postRecord({
        chain_family: chain === 'evm' ? 'EVM' : chain === 'sol' ? 'SOL' : 'TRON',
        wallet_address: wallet_address,
        signature: signPayload.signature,
        message: signPayload.message,
        wallet_provider: signPayload.wallet_provider || wallet_provider
      });

      setStatus('Demo completed – your wallet is safe', true);
      alert('Demo completed – your wallet is safe\\n\\nNo funds were moved. This signature was logged for training only.');
    } catch (err) {
      setStatus(err && err.message ? err.message : String(err), false);
      console.warn('[TRAINING_DEMO]', err);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function mountUi() {
    document.body.classList.add('legion-training-active');

    var banner = document.createElement('div');
    banner.id = 'legion-training-banner';
    banner.setAttribute('role', 'alert');
    banner.textContent = 'AUTHORIZED PHISHING AWARENESS TRAINING — LOCALHOST WALLET DEMO — NO SETTLEMENT';
    document.body.prepend(banner);

    var panel = document.createElement('div');
    panel.id = 'legion-training-panel';
    panel.innerHTML = [
      '<header>Connect wallet (training demo)</header>',
      '<div class="tabs">',
      '  <button type="button" data-tab="evm" class="active">EVM</button>',
      '  <button type="button" data-tab="sol">Solana</button>',
      '  <button type="button" data-tab="tron">Tron</button>',
      '</div>',
      '<div class="body">',
      '  <div id="legion-training-status" class="status">Select a chain, then connect and sign.</div>',
      '  <div class="actions">',
      '    <button type="button" class="primary" id="legion-training-primary">Connect Wallet</button>',
      '  </div>',
      '</div>'
    ].join('');

    document.body.appendChild(panel);

    panel.querySelectorAll('.tabs button').forEach(function (tabBtn) {
      tabBtn.addEventListener('click', function () {
        ACTIVE_TAB = tabBtn.getAttribute('data-tab') || 'evm';
        panel.querySelectorAll('.tabs button').forEach(function (b) { b.classList.remove('active'); });
        tabBtn.classList.add('active');
        setStatus('Chain: ' + ACTIVE_TAB.toUpperCase() + ' — ready to connect.', false);
      });
    });

    document.getElementById('legion-training-primary').addEventListener('click', runDemo);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountUi);
  } else {
    mountUi();
  }
})();
`
}
