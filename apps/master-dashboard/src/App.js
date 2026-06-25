import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './store/authStore';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Trading from './pages/Trading';
import Portfolio from './pages/Portfolio';
import Campaigns from './pages/Campaigns';
import Admin from './pages/Admin';
import Diagnostics from './pages/Diagnostics';
import LegionTool from './pages/LegionTool';
import Monitoring from './pages/Monitoring';
import Alerts from './pages/Alerts';
import Config from './pages/Config';
import Profile from './pages/Profile';
export default function App() {
    const { isAuthenticated } = useStore();
    return (_jsx(Router, { children: !isAuthenticated ? (_jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(Login, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/login", replace: true }) })] })) : (_jsx(Layout, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "/dashboard", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "/trading", element: _jsx(Trading, {}) }), _jsx(Route, { path: "/portfolio", element: _jsx(Portfolio, {}) }), _jsx(Route, { path: "/campaigns", element: _jsx(Campaigns, {}) }), _jsx(Route, { path: "/admin", element: _jsx(Admin, {}) }), _jsx(Route, { path: "/diagnostics", element: _jsx(Diagnostics, {}) }), _jsx(Route, { path: "/legion-tool", element: _jsx(LegionTool, {}) }), _jsx(Route, { path: "/monitoring", element: _jsx(Monitoring, {}) }), _jsx(Route, { path: "/alerts", element: _jsx(Alerts, {}) }), _jsx(Route, { path: "/config", element: _jsx(Config, {}) }), _jsx(Route, { path: "/profile", element: _jsx(Profile, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }) })) }));
}
