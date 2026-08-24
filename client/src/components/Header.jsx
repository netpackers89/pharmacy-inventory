import React, { useState, useEffect, useRef } from 'react';
import { Search, QrCode, Menu, X, LogOut, Moon, Sun } from 'lucide-react';
import './Header.css';
import { medicinesAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { SkeletonLine } from './Feedback';

export const Header = ({ onScanClick, onSelectMedicine, toggleSidebar, isSidebarOpen }) => {
  const { user, isGuest, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchBoxRef = useRef(null);

  // Debounced search — avoids a request per keystroke
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      setSearching(false);
      return undefined;
    }

    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await medicinesAPI.getAll({ search: q });
        if (cancelled) return;
        setSuggestions(Array.isArray(res.data) ? res.data : []);
        setShowDropdown(true);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Close the suggestion dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleItemClick = (med) => {
    setShowDropdown(false);
    setQuery('');
    if (onSelectMedicine) onSelectMedicine(med);
  };

  return (
    <header className="header">
      <button
        className="sidebar-toggle-btn"
        aria-label={isSidebarOpen ? 'Close navigation' : 'Open navigation'}
        onClick={() => typeof toggleSidebar === 'function' && toggleSidebar()}
      >
        {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      <div className="header-brand" aria-hidden="true">NP</div>

      {/* Global medicine search */}
      <div className="header-search" ref={searchBoxRef}>
        <Search size={15} className="header-search-icon" />
        <input
          type="text"
          placeholder="Search medicines…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim().length >= 2 && setShowDropdown(true)}
          aria-label="Search medicines"
        />
        {showDropdown && (
          <div className="header-search-dropdown fade-in" role="listbox">
            {searching && suggestions.length === 0 && (
              <div style={{ padding: '0.6rem 1rem' }}>
                <SkeletonLine w="60%" /><SkeletonLine w="40%" style={{ marginBottom: 0 }} />
              </div>
            )}
            {!searching && suggestions.length === 0 && (
              <div className="header-search-empty">No medicines match “{query}”.</div>
            )}
            {!searching && suggestions.map((med) => (
              <button
                type="button"
                key={med.medicine_id}
                role="option"
                aria-selected="false"
                className="search-dropdown-item"
                onClick={() => handleItemClick(med)}
              >
                <span className="suggestion-left">
                  <span>
                    <span className="brand-name">{med.generic_name}</span>
                    <span className="generic-info">{[med.brand_name, med.strength].filter(Boolean).join(' · ')}</span>
                  </span>
                </span>
                <span className="suggestion-right">
                  <span className={`badge ${parseInt(med.stock_on_hand) === 0 ? 'badge-danger' : 'badge-neutral'}`}>
                    {med.stock_on_hand ?? 0}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="header-actions">
        {isGuest && (
          <span className="guest-badge" title="Guest sessions are read-only">
            View Only
          </span>
        )}

        <button className="icon-btn" onClick={toggleTheme} data-tip={theme === 'dark' ? 'Light mode' : 'Dark mode'} aria-label="Toggle light or dark theme">
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        <button className="icon-btn header-scan-btn" onClick={onScanClick} data-tip="Scan barcode / QR" aria-label="Scan barcode or QR code">
          <QrCode size={17} />
        </button>

        <div className="user-profile">
          <div className="user-avatar-big">{(isGuest ? 'G' : user?.username?.charAt(0).toUpperCase()) || 'P'}</div>
          <div className="user-info">
            <span className="username">{user?.full_name || user?.username || 'User'}</span>
            <span className="role">{isGuest ? 'Guest · read only' : (user?.role || 'Staff')}</span>
          </div>
          <button className="icon-btn header-logout-btn" onClick={logout} data-tip="Sign out" aria-label="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
};
