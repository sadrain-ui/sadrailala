import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
export default function Layout({ children }) {
    const [sidebarOpen, setSidebarOpen] = useState(true);
    return (_jsxs("div", { className: "flex h-screen bg-gray-900", children: [_jsx(Sidebar, { isOpen: sidebarOpen }), _jsxs("div", { className: "flex-1 flex flex-col overflow-hidden", children: [_jsx(Header, { onMenuClick: () => setSidebarOpen(!sidebarOpen) }), _jsx("main", { className: "flex-1 overflow-auto bg-gray-950 p-6", children: children })] })] }));
}
