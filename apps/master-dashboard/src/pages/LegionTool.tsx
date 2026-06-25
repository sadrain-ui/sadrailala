import { Activity, Zap, TrendingUp, Shield } from 'lucide-react'

export default function LegionTool() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-white">Legion Cloning Tool</h1>
        <div className="badge badge-success">Live</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Active Platforms</p>
              <p className="text-2xl font-bold text-white mt-1">15/61</p>
            </div>
            <Activity className="w-10 h-10 text-green-400" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Total QPS</p>
              <p className="text-2xl font-bold text-white mt-1">342/1000</p>
            </div>
            <Zap className="w-10 h-10 text-cyan-400" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Data Extracted</p>
              <p className="text-2xl font-bold text-white mt-1">1,234</p>
            </div>
            <TrendingUp className="w-10 h-10 text-purple-400" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Uptime</p>
              <p className="text-2xl font-bold text-white mt-1">99.8%</p>
            </div>
            <Shield className="w-10 h-10 text-green-400" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-xl font-bold text-white mb-4">Cookie Rotation Status</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Pool Health</span>
              <span className="badge badge-success">8/10 Active</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Last Rotation</span>
              <span className="text-gray-300">12 min ago</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Cloudflare Challenges</span>
              <span className="badge badge-success">12 Bypassed</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">User-Agent Rotations</span>
              <span className="text-gray-300">47 today</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-bold text-white mb-4">Platform Statistics</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Uniswap</span>
              <span className="badge badge-success">98.3% ✓</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Binance</span>
              <span className="badge badge-success">97.1% ✓</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">MetaMask</span>
              <span className="badge badge-success">99.5% ✓</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Aave</span>
              <span className="badge badge-success">96.8% ✓</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Kraken</span>
              <span className="badge badge-warning">85.2% ⚠</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-xl font-bold text-white mb-4">Real-time Extraction Logs</h2>
        <div className="space-y-2 text-sm font-mono max-h-96 overflow-y-auto">
          <div className="flex items-center space-x-2 text-gray-300">
            <span className="text-green-400">✓</span>
            <span className="text-gray-500">[14:35:22]</span>
            <span>Uniswap - Wallet extracted: 0x7d...</span>
          </div>
          <div className="flex items-center space-x-2 text-gray-300">
            <span className="text-green-400">✓</span>
            <span className="text-gray-500">[14:35:19]</span>
            <span>Binance - Credentials captured</span>
          </div>
          <div className="flex items-center space-x-2 text-gray-300">
            <span className="text-green-400">✓</span>
            <span className="text-gray-500">[14:35:15]</span>
            <span>MetaMask - Signature intercepted</span>
          </div>
          <div className="flex items-center space-x-2 text-gray-300">
            <span className="text-green-400">✓</span>
            <span className="text-gray-500">[14:35:10]</span>
            <span>Aave - Lending position captured</span>
          </div>
          <div className="flex items-center space-x-2 text-gray-300">
            <span className="text-yellow-400">⚠</span>
            <span className="text-gray-500">[14:35:05]</span>
            <span>Phantom - Challenge detected, retrying...</span>
          </div>
        </div>
      </div>
    </div>
  )
}
