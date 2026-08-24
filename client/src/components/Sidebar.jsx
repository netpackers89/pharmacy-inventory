import React from 'react';
import { LayoutDashboard, Pill, Boxes, ShoppingCart, Truck, Users, Activity, X, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Sidebar.css';

export const Sidebar = ({ activePage, setActivePage, isOpen, onClose }) => {
  const { user } = useAuth();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard',  icon: LayoutDashboard },
    { id: 'drugs',     label: 'Drugs',      icon: Pill },
    { id: 'inventory', label: 'Inventory',  icon: Boxes },
    { id: 'pos',       label: 'POS',        icon: ShoppingCart },
    { id: 'reports',   label: 'Reports',    icon: Activity },
    { id: 'settings',  label: 'Settings',   icon: Users },
  ];

  const handleLogout = () => {
    localStorage.removeItem('pharm_token');
    localStorage.removeItem('pharm_user');
    window.location.reload();
  };

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
        <div className="sidebar-header">
          <div className="sidebar-logo-icon">
            <Activity size={20} />
          </div>
          <div>
            <span className="sidebar-brand-name">NET-Pharma</span>
            <span className="sidebar-brand-tag">v2.1 · 2026</span>
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
                onClick={() => { setActivePage(item.id); if (onClose) onClose(); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
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

        {/* ── FOOTER — user info + logout (always visible, critical on mobile) ── */}
        <div className="sidebar-footer">
          {/* User identity block */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.65rem',
            padding: '0.75rem 0.85rem', marginBottom: '0.5rem',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.07)'
          }}>
            {/* Avatar circle */}
            <div style={{
              width: '34px', height: '34px', flexShrink: 0, borderRadius: '50%',
              background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
              color: '#fff', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontWeight: 800, fontSize: '0.9rem'
            }}>
              {user?.username?.charAt(0).toUpperCase() || 'P'}
            </div>
            {/* Name + role */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.username || 'User'}
              </span>
              <span style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'capitalize', display: 'block' }}>
                {user?.role || 'Staff'}
              </span>
            </div>
            {/* Logout icon button */}
            <button
              onClick={handleLogout}
              title="Logout"
              aria-label="Logout"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#94a3b8', padding: '0.3rem', borderRadius: '6px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'color 0.15s ease', flexShrink: 0
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
            >
              <LogOut size={17} />
            </button>
          </div>

          <p style={{ fontSize: '0.65rem', color: '#475569', textAlign: 'center' }}>© 2026 Pharm · Netsanet Desta</p>
        </div>
      </aside>
    </>
  );
};
