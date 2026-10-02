import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, QrCode, Menu, X, LogOut, Moon, Sun, CornerDownLeft } from 'lucide-react';
import './Header.css';
import { searchAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { SkeletonLine } from './Feedback';

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

/** Escape text, then wrap the matched fragment in <mark>. */
function highlight(text, query) {
  const raw = String(text ?? '');
  const needle = String(query || '').trim().toLowerCase();
  if (needle.length < MIN_CHARS) return raw;
  const index = raw.toLowerCase().indexOf(needle);
  if (index < 0) return raw;
  return (
    <>
      {raw.slice(0, index)}
      <mark>{raw.slice(index, index + needle.length)}</mark>
      {raw.slice(index + needle.length)}
    </>
  );
}

export const Header = ({ onScanClick, onSelectMedicine, onNavigate, toggleSidebar, isSidebarOpen }) => {
  const { user, isGuest, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const searchBoxRef = useRef(null);
  const inputRef = useRef(null);

  // Global shortcut: Ctrl+K (Cmd+K on macOS) focuses the search.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounced search; stale responses are ignored via `cancelled`.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setGroups([]); setOpen(false); setSearching(false); setError(false);
      return undefined;
    }
    setSearching(true);
    setError(false);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await searchAPI.global(q);
        if (cancelled) return;
        setGroups(Array.isArray(res.data?.groups) ? res.data.groups : []);
        setActive(0);
        setOpen(true);
      } catch (_) {
        if (!cancelled) { setGroups([]); setError(true); setOpen(true); }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /** Flattened list so arrow keys can walk across groups. */
  const flat = useMemo(
    () => groups.flatMap((g) => g.items.map((item) => ({ ...item, groupLabel: g.label }))),
    [groups]
  );

  const openItem = useCallback((item) => {
    if (!item) return;
    setOpen(false);
    setQuery('');
    if (item.target === 'page') {
      if (typeof onNavigate === 'function') onNavigate(item.page);
      return;
    }
    if (item.target === 'inventory-movements') {
      if (typeof onNavigate === 'function') onNavigate('inventory');
      return;
    }
    if (item.medicineId && typeof onSelectMedicine === 'function') {
      onSelectMedicine({
        medicine_id: item.medicineId,
        generic_name: item.title,
        brand_name: item.subtitle || '',
        openBinCard: item.target === 'medicine-bincard',
      });
    }
  }, [onNavigate, onSelectMedicine]);

  const onKeyDown = (e) => {
    if (!open || flat.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % flat.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + flat.length) % flat.length); }
    else if (e.key === 'Enter') { e.preventDefault(); openItem(flat[active]); }
  };

  let cursor = -1;
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

      {/* ── ONE global search for the whole application ── */}
      <div className="header-search" ref={searchBoxRef}>
        <Search size={15} className="header-search-icon" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search medicines, batches, documents, pages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim().length >= MIN_CHARS && setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          aria-label="Global search"
        />
        <kbd className="header-search-kbd" aria-hidden="true">Ctrl K</kbd>

        {open && (
          <div className="header-search-dropdown fade-in" id="global-search-results" role="listbox">
            {searching && (
              <div style={{ padding: '0.6rem 1rem' }}>
                <SkeletonLine w="60%" /><SkeletonLine w="40%" style={{ marginBottom: 0 }} />
              </div>
            )}

            {!searching && error && (
              <div className="header-search-empty">Search is unavailable right now. Please try again.</div>
            )}

            {!searching && !error && flat.length === 0 && (
              <div className="header-search-empty">No matches for “{query.trim()}”.</div>
            )}

            {!searching && !error && groups.map((group) => (
              <div key={group.key} className="search-group">
                <div className="search-group-label">{group.label}</div>
                {group.items.length === 0 && group.hint && (
                  <div className="search-group-hint">{group.hint}</div>
                )}
                {group.items.map((item) => {
                  cursor += 1;
                  const index = cursor;
                  const isActive = index === active;
                  return (
                    <button
                      key={`${group.key}-${item.type}-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={`search-dropdown-item ${isActive ? 'active' : ''}`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => openItem(item)}
                    >
                      <span className="suggestion-left">
                        <span>
                          <span className="brand-name">{highlight(item.title, query)}</span>
                          {item.subtitle && (
                            <span className="generic-info">{highlight(item.subtitle, query)}</span>
                          )}
                        </span>
                      </span>
                      <span className="suggestion-right">
                        {item.stockState === 'out' && <span className="badge badge-danger">{item.meta}</span>}
                        {item.stockState === 'low' && <span className="badge badge-warning">{item.meta}</span>}
                        {item.stockState !== 'out' && item.stockState !== 'low' && (
                          <span className="badge badge-neutral">{item.meta ?? item.extra ?? ''}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}

            {flat.length > 0 && (
              <div className="search-group-hint search-footer">
                <CornerDownLeft size={11} /> Enter to open · ↑ ↓ to navigate · Esc to close
              </div>
            )}
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
