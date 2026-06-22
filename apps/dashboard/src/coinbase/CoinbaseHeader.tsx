import React, { useState } from 'react';
import { Search, Bell, Settings, User, LogOut } from 'lucide-react';
import './styles/header.css';

interface CoinbaseHeaderProps {
  user?: { name: string; email: string };
  onLogout?: () => void;
}

export const CoinbaseHeader: React.FC<CoinbaseHeaderProps> = ({ user, onLogout }) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [notificationCount, setNotificationCount] = useState(3);

  return (
    <header className="coinbase-header">
      <div className="header-container">
        {/* Logo */}
        <div className="header-logo">
          <div className="coinbase-icon">₿</div>
          <span className="coinbase-text">Coinbase</span>
        </div>

        {/* Navigation */}
        <nav className="header-nav">
          <a href="#buy" className="nav-link">Buy</a>
          <a href="#sell" className="nav-link">Sell</a>
          <a href="#convert" className="nav-link">Convert</a>
          <a href="#prices" className="nav-link">Prices</a>
          <a href="#portfolio" className="nav-link active">Portfolio</a>
          <a href="#accounts" className="nav-link">Accounts</a>
        </nav>

        {/* Right Section */}
        <div className="header-right">
          {/* Search */}
          <div className="header-search">
            <Search size={18} />
            <input
              type="text"
              placeholder="Search assets or people..."
              className="search-input"
            />
          </div>

          {/* Notifications */}
          <button className="header-icon-btn">
            <Bell size={20} />
            {notificationCount > 0 && (
              <span className="notification-badge">{notificationCount}</span>
            )}
          </button>

          {/* Settings */}
          <button className="header-icon-btn">
            <Settings size={20} />
          </button>

          {/* User Menu */}
          <div className="user-menu-container">
            <button
              className="user-menu-btn"
              onClick={() => setShowUserMenu(!showUserMenu)}
            >
              <User size={20} />
              <span className="user-name">{user?.name || 'User'}</span>
            </button>

            {showUserMenu && (
              <div className="user-menu-dropdown">
                <div className="user-menu-header">
                  <div className="user-avatar">
                    {(user?.name || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="user-info">
                    <div className="user-name-full">{user?.name || 'Guest User'}</div>
                    <div className="user-email">{user?.email || 'user@example.com'}</div>
                  </div>
                </div>
                <hr className="menu-divider" />
                <a href="#profile" className="menu-item">View Profile</a>
                <a href="#settings" className="menu-item">Settings</a>
                <a href="#security" className="menu-item">Security</a>
                <a href="#help" className="menu-item">Help & Support</a>
                <hr className="menu-divider" />
                <button
                  className="menu-item logout"
                  onClick={() => {
                    onLogout?.();
                    setShowUserMenu(false);
                  }}
                >
                  <LogOut size={16} />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
