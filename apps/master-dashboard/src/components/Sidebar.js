import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, Wallet, Target, Lock, AlertTriangle, Zap, BarChart3, Settings, Bell, User, } from 'lucide-react';
const menuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/', color: 'text-blue-400' },
    { icon: TrendingUp, label: 'Trading', path: '/trading', color: 'text-green-400' },
    { icon: Wallet, label: 'Portfolio', path: '/portfolio', color: 'text-purple-400' },
    { icon: Target, label: 'Campaigns', path: '/campaigns', color: 'text-orange-400' },
    { icon: Lock, label: 'Admin Panel', path: '/admin', color: 'text-red-400' },
    { icon: AlertTriangle, label: 'Diagnostics', path: '/diagnostics', color: 'text-yellow-400' },
    { icon: Zap, label: 'Legion Tool', path: '/legion-tool', color: 'text-cyan-400' },
    { icon: BarChart3, label: 'Monitoring', path: '/monitoring', color: 'text-pink-400' },
    { icon: Settings, label: 'Configuration', path: '/config', color: 'text-indigo-400' },
    { icon: Bell, label: 'Alerts', path: '/alerts', color: 'text-red-500' },
    { icon: User, label: 'Profile', path: '/profile', color: 'text-gray-400' },
];
export default function Sidebar({ isOpen }) {
    const location = useLocation();
    return (_jsxs("div", { className: `${isOpen ? 'w-64' : 'w-20'} bg-gray-800 border-r border-gray-700 transition-all duration-300 overflow-y-auto`, children: [_jsx("div", { className: "p-4", children: _jsx("div", { className: "text-2xl font-bold text-cyan-400 text-center", children: isOpen ? '⚔️ LEGION' : '⚔️' }) }), _jsx("nav", { className: "space-y-2 p-4", children: menuItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.path;
                    return (_jsxs(Link, { to: item.path, className: `flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${isActive
                            ? 'bg-gray-700 text-white'
                            : 'text-gray-300 hover:bg-gray-700'}`, title: !isOpen ? item.label : '', children: [_jsx(Icon, { className: `w-5 h-5 ${item.color}` }), isOpen && _jsx("span", { children: item.label })] }, item.path));
                }) })] }));
}
