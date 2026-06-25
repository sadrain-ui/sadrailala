import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Menu, LogOut } from 'lucide-react';
import { useStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';
export default function Header({ onMenuClick }) {
    const { user, logout } = useStore();
    const navigate = useNavigate();
    const handleLogout = () => {
        logout();
        navigate('/login');
    };
    return (_jsxs("header", { className: "bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between", children: [_jsx("button", { onClick: onMenuClick, className: "text-gray-400 hover:text-white", children: _jsx(Menu, { className: "w-6 h-6" }) }), _jsxs("div", { className: "flex items-center space-x-4", children: [_jsxs("div", { className: "text-right", children: [_jsx("p", { className: "text-white font-medium", children: user?.name }), _jsx("p", { className: "text-gray-400 text-sm", children: user?.role })] }), _jsx("button", { onClick: handleLogout, className: "text-gray-400 hover:text-red-400 transition-colors", children: _jsx(LogOut, { className: "w-5 h-5" }) })] })] }));
}
