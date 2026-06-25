import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/authStore'
import { Shield } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('admin@legion.com')
  const [password, setPassword] = useState('password')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { login } = useStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (error) {
      console.error('Login failed:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-950">
      <div className="w-full max-w-md">
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="flex justify-center">
              <Shield className="w-16 h-16 text-cyan-400" />
            </div>
            <h1 className="text-3xl font-bold text-white">Legion Control</h1>
            <p className="text-gray-400">Master Control Center</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-cyan-400"
                placeholder="admin@legion.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-cyan-400"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Logging in...' : 'Sign In'}
            </button>
          </form>

          <p className="text-center text-gray-400 text-sm">
            Demo: admin@legion.com / password
          </p>
        </div>
      </div>
    </div>
  )
}
