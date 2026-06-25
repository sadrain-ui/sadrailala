import { Menu, LogOut } from 'lucide-react'
import { useStore } from '../store/authStore'
import { useNavigate } from 'react-router-dom'

interface HeaderProps {
  onMenuClick: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { user, logout } = useStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
      <button
        onClick={onMenuClick}
        className="text-gray-400 hover:text-white"
      >
        <Menu className="w-6 h-6" />
      </button>

      <div className="flex items-center space-x-4">
        <div className="text-right">
          <p className="text-white font-medium">{user?.name}</p>
          <p className="text-gray-400 text-sm">{user?.role}</p>
        </div>
        <button
          onClick={handleLogout}
          className="text-gray-400 hover:text-red-400 transition-colors"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  )
}
