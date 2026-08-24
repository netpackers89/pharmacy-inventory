import React from 'react';
import { LayoutDashboard, Pill, Boxes, ShoppingCart, Activity, Settings as SettingsIcon, Truck, X, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Sidebar.css';

export const Sidebar = ({ activePage, setActivePage, isOpen, onClose }) => {
  const { user, isGuest, logout } = useAuth();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard',  icon: LayoutDashboard },
    { id: 'drugs',     label: 'Medicines',  icon: Pill },
    { id: 'inventory', label: 'Inventory',  icon: Boxes },
    { id: 'pos',       label: 'POS',        icon: ShoppingCart },
    { id: 'reports',   label: 'Reports',    icon: Activity },
    { id: 'settings',  label: 'Settings',   icon: SettingsIcon },
  ];

  const handleLogout = () => logout();

  return (
    <>
      {isOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar ${isOpen ? 'open' : ''}`} aria-label="Main navigation">
        {/* ── HEADER ── */}
        <div className="sidebar-header dot-grid">
          <div className="sidebar-logo-icon">NP</div>
          <div>
            <span className="sidebar-brand-name">NET-PHARMA</span>
            <span className="sidebar-brand-tag">Inventory Suite</span>
          </div>
          {/* X close — visible only on mobile */}
          <button
            className="sidebar-close-btn"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── NAV ITEMS ── */}
        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <div
                key={item.id}
                className={`nav-item ${isActive ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => { setActivePage(item.id); if (onClose) onClose(); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActivePage(item.id);
                    if (onClose) onClose();
                  }
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </div>
            );
          })}
        </nav>

        {isGuest && (
          <div className="sidebar-guest-note" role="note">
            Guest Mode is active — you have read-only access.
          </div>
        )}

        {/* ── FOOTER — user info + logout ── */}
        <div className="sidebar-footer">
          <div className="sidebar-user-card">
            <div className={`sidebar-avatar ${isGuest ? 'guest' : ''}`}>
              {(isGuest ? 'G' : user?.username?.charAt(0).toUpperCase()) || 'P'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="sidebar-user-name">
                {user?.full_name || user?.username || 'User'}
              </span>
              <span className="sidebar-user-role">
                {isGuest ? 'Guest · view only' : (user?.role || 'Staff')}
              </span>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
              className="sidebar-logout-btn"
            >
              <LogOut size={17} />
            </button>
          </div>

          <p className="sidebar-copyright">© 2026 NET-PHARMA · Netsanet Desta</p>
        </div>
      </aside>
    </>
  );
};
