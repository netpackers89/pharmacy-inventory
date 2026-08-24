import React, { useState, useEffect } from 'react';
import { Search, QrCode, Pill, Menu, X, LogOut } from 'lucide-react';
import './Header.css';
import { medicinesAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

export const Header = ({ onScanClick, onSelectMedicine, toggleSidebar, isSidebarOpen }) => {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    if (query.trim().length >= 2) {
      medicinesAPI.getAll({ search: query })
        .then(res => {
          setSuggestions(res.data || []);
          setShowDropdown(true);
        })
        .catch(() => setSuggestions([]));
    } else {
      setSuggestions([]);
      setShowDropdown(false);
    }
  }, [query]);

  const handleItemClick = (med) => {
    setShowDropdown(false);
    setQuery('');
    if (onSelectMedicine) onSelectMedicine(med);
  };

  const handleLogout = () => {
    localStorage.removeItem('pharm_token');
    localStorage.removeItem('pharm_user');
    window.location.reload();
  };

  return (
    <header className="header">
      {/* Hamburger / X toggle */}
      <button
        className="sidebar-toggle-btn"
        aria-label={isSidebarOpen ? 'Close navigation' : 'Open navigation'}
        onClick={() => typeof toggleSidebar === 'function' && toggleSidebar()}
      >
        {isSidebarOpen ? <X size={20} color="#475569" /> : <Menu size={20} color="#475569" />}
      </button>

       <div className="pharma">N.D</div>

      {/* Header Actions */}
      <div className="header-actions">
        {/* Barcode scan button — label hidden on smallest screens */}
        <button className="btn-scan" onClick={onScanClick} aria-label="Barcode scan">
          <QrCode size={16} />
          <span className="btn-scan-label">Scan</span>
        </button>

  

        {/* User avatar + name — hidden on mobile */}
        <div className="user-profile" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div className="user-avatar-big">
            {user?.username?.charAt(0).toUpperCase() || 'P'}
          </div>
          <div className="user-info">
            <span className="username">{user?.username || 'User'}</span>
            <span className="role">{user?.role || 'Staff'}</span>
          </div>
        </div>
      </div>
    </header>
  );
};
