import { create } from 'zustand';
export const useStore = create((set) => ({
    isAuthenticated: !!localStorage.getItem('token'),
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    token: localStorage.getItem('token'),
    login: async (email, password) => {
        // Mock login - replace with actual API call
        const mockUser = {
            id: '1',
            name: 'Admin User',
            email,
            role: 'admin',
        };
        const mockToken = 'mock-jwt-token-' + Date.now();
        localStorage.setItem('user', JSON.stringify(mockUser));
        localStorage.setItem('token', mockToken);
        set({
            isAuthenticated: true,
            user: mockUser,
            token: mockToken,
        });
    },
    logout: () => {
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        set({
            isAuthenticated: false,
            user: null,
            token: null,
        });
    },
    setUser: (user) => {
        localStorage.setItem('user', JSON.stringify(user));
        set({ user });
    },
}));
