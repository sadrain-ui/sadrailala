import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/authStore';
import { Shield } from 'lucide-react';
export default function Login() {
    const [email, setEmail] = useState('admin@legion.com');
    const [password, setPassword] = useState('password');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const { login } = useStore();
    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await login(email, password);
            navigate('/');
        }
        catch (error) {
            console.error('Login failed:', error);
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsx("div", { className: "flex items-center justify-center h-screen bg-gray-950", children: _jsx("div", { className: "w-full max-w-md", children: _jsxs("div", { className: "bg-gray-800 border border-gray-700 rounded-lg p-8 space-y-6", children: [_jsxs("div", { className: "text-center space-y-2", children: [_jsx("div", { className: "flex justify-center", children: _jsx(Shield, { className: "w-16 h-16 text-cyan-400" }) }), _jsx("h1", { className: "text-3xl font-bold text-white", children: "Legion Control" }), _jsx("p", { className: "text-gray-400", children: "Master Control Center" })] }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-300 mb-2", children: "Email" }), _jsx("input", { type: "email", value: email, onChange: (e) => setEmail(e.target.value), className: "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-cyan-400", placeholder: "admin@legion.com" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-300 mb-2", children: "Password" }), _jsx("input", { type: "password", value: password, onChange: (e) => setPassword(e.target.value), className: "w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-cyan-400", placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" })] }), _jsx("button", { type: "submit", disabled: loading, className: "w-full bg-cyan-600 hover:bg-cyan-700 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-50", children: loading ? 'Logging in...' : 'Sign In' })] }), _jsx("p", { className: "text-center text-gray-400 text-sm", children: "Demo: admin@legion.com / password" })] }) }) }));
}
