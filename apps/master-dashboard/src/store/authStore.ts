import { create } from 'zustand'

interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'user' | 'viewer'
}

interface AuthStore {
  isAuthenticated: boolean
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  setUser: (user: User) => void
}

export const useStore = create<AuthStore>((set) => ({
  isAuthenticated: !!localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  token: localStorage.getItem('token'),

  login: async (email: string, password: string) => {
    // Mock login - replace with actual API call
    const mockUser: User = {
      id: '1',
      name: 'Admin User',
      email,
      role: 'admin',
    }
    const mockToken = 'mock-jwt-token-' + Date.now()

    localStorage.setItem('user', JSON.stringify(mockUser))
    localStorage.setItem('token', mockToken)

    set({
      isAuthenticated: true,
      user: mockUser,
      token: mockToken,
    })
  },

  logout: () => {
    localStorage.removeItem('user')
    localStorage.removeItem('token')
    set({
      isAuthenticated: false,
      user: null,
      token: null,
    })
  },

  setUser: (user: User) => {
    localStorage.setItem('user', JSON.stringify(user))
    set({ user })
  },
}))
