import React, { useState, useEffect, useCallback, useRef } from 'react';
import './AuthPage.css';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Eye, EyeOff, LogIn, ArrowRight, ArrowLeft,
  Moon, Sun, Loader2, ShieldCheck, UserRound,
} from 'lucide-react';

/* ── Showcase slides — /public images (local assets only) ─────────────── */
const SLIDES = [
  {
    img: '/showcase/inventory.svg',
    title: 'Smart Inventory',
    text: 'Control medicines, batches, expiry dates and stock from one workspace.',
  },
  {
    img: '/showcase/pos.svg',
    title: 'Fast POS',
    text: 'Ring up sales in seconds with a cart built for busy pharmacy counters.',
  },
  {
    img: '/showcase/scanner.svg',
    title: 'Barcode & QR Scanning',
    text: 'Scan a code and the right medicine lands in the sale instantly.',
  },
  {
    img: '/showcase/bincard.svg',
    title: 'Bin Card & Stock History',
    text: 'Every movement is written to a complete ledger you can trust.',
  },
  {
    img: '/showcase/reorder.svg',
    title: 'Smart Reordering',
    text: 'Critical, high and normal priorities calculated before you run out.',
  },
  {
    img: '/showcase/medicines.svg',
    title: 'Medicine Management',
    text: 'Clean master records for every drug — never duplicated by packaging.',
  },
  {
    img: '/showcase/reports.svg',
    title: 'Reports & Analytics',
    text: 'Sales, profit and expiry analytics ready to export any time.',
  },
];

export const AuthPage = () => {
  const { login, loginAsGuest } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  // Guest mode panel state
  const [guestOpen, setGuestOpen] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestLoading, setGuestLoading] = useState(false);

  const [error, setError] = useState('');
  const [guestError, setGuestError] = useState('');

  /* ── Carousel ── */
  const [slide, setSlide] = useState(0);
  const autoRef = useRef(null);

  const goTo = useCallback((i) => setSlide(((i % SLIDES.length) + SLIDES.length) % SLIDES.length), []);

  useEffect(() => {
    autoRef.current = setInterval(() => setSlide((s) => (s + 1) % SLIDES.length), 5500);
    return () => clearInterval(autoRef.current);
  }, []);

  const pauseAuto = () => {
    clearInterval(autoRef.current);
    autoRef.current = setInterval(() => setSlide((s) => (s + 1) % SLIDES.length), 9000);
  };

  /* ── Sign in ── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!identifier.trim() || !password.trim()) {
      setError('Please enter your username and password.');
      return;
    }

    setLoading(true);
    try {
      const result = await login(identifier.trim(), password);
      if (result && !result.success) {
        setError(
          result.error === 'Invalid credentials'
            ? 'Please check your username and password and try again.'
            : result.error || 'Unable to sign in. Please try again.'
        );
      }
    } catch {
      setError('Unable to sign in. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Enter as Guest (name required; validated on both ends) ── */
  const handleGuestSubmit = async (e) => {
    e.preventDefault();
    setGuestError('');

    const trimmed = guestName.replace(/\s+/g, ' ').trim();
    if (!trimmed || trimmed.length < 2 || trimmed.length > 60) {
      setGuestError('Please enter your full name (2–60 characters).');
      return;
    }

    setGuestLoading(true);
    try {
      const result = await loginAsGuest(trimmed);
      if (!result.success) setGuestError(result.error || 'Could not start guest session.');
    } catch {
      setGuestError('Could not start guest session. Please try again.');
    } finally {
      setGuestLoading(false);
    }
  };

  const current = SLIDES[slide];

  return (
    <div className="auth-page">
      {/* ══ LEFT · AUTHENTICATION ══ */}
      <div className="auth-left dot-grid">
        <div className="auth-topbar">
          <div className="auth-brand">
            <span className="auth-logo">NP</span>
            <span className="auth-brand-name">NET-PHARMA</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            data-tip={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        <div className="auth-form-wrap">
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-subtitle">Sign in to manage inventory, batches and point of sale.</p>

          {error && (
            <div className="auth-alert auth-alert--error" role="alert">
              <strong>Unable to sign in</strong>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            <div className="auth-field">
              <label htmlFor="auth-identifier">USERNAME</label>
              <input
                id="auth-identifier"
                type="text"
                autoComplete="username"
                placeholder="Enter your username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>

            <div className="auth-field">
              <label htmlFor="auth-password">PASSWORD</label>
              <div className="auth-pass-wrap">
                <input
                  id="auth-password"
                  type={showPass ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="auth-eye"
                  onClick={() => setShowPass(!showPass)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? <Loader2 size={18} className="spin" /> : <LogIn size={18} />}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="auth-divider"><span>Guest Access</span></div>

          {!guestOpen ? (
            <button type="button" className="auth-guest" onClick={() => { setGuestOpen(true); setGuestError(''); }}>
              <UserRound size={17} />
              Enter as Guest
            </button>
          ) : (
            <form onSubmit={handleGuestSubmit} className="auth-guest-panel fade-in">
              <div className="auth-guest-head">
                <UserRound size={16} />
                <strong>Guest Mode</strong>
              </div>

              <label className="auth-field">
                Your name
                <input
                  type="text"
                  placeholder="e.g. Abebe Kebede"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  maxLength={60}
                  autoFocus
                />
              </label>

              {guestError && (
                <div className="auth-alert auth-alert--error" role="alert">{guestError}</div>
              )}

              <div className="auth-guest-actions">
                <button type="submit" className="auth-submit" disabled={guestLoading}>
                  {guestLoading ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
                  {guestLoading ? 'Starting…' : 'Enter as Guest'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ width: '100%' }}
                  onClick={() => { setGuestOpen(false); setGuestError(''); }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <p className="guest-note">
            View-only access.
            <br />
            All guest activity is audited.
          </p>

          <p className="auth-footnote">
            Internal pharmacy system · accounts are created by administrators.
          </p>
        </div>
      </div>

      {/* ══ RIGHT · PRODUCT SHOWCASE CAROUSEL ══ */}
      <aside className="auth-right dot-grid" aria-label="NET-PHARMA product showcase">
        <div className="auth-showcase" onMouseEnter={pauseAuto}>
          <div key={slide} className="auth-slide fade-in" role="group" aria-roledescription="slide" aria-label={`${slide + 1} of ${SLIDES.length}`}>
            <div className="auth-slide-frame">
              <img src={current.img} alt="" loading={slide === 0 ? 'eager' : 'lazy'} />
            </div>
            <h2 className="auth-slide-title">{current.title}</h2>
            <p className="auth-slide-text">{current.text}</p>
          </div>

          <div className="auth-carousel-controls">
            <button type="button" className="carousel-arrow" onClick={() => { pauseAuto(); goTo(slide - 1); }} aria-label="Previous slide">
              <ArrowLeft size={15} />
            </button>
            <div className="carousel-dots" role="tablist" aria-label="Feature slides">
              {SLIDES.map((s, i) => (
                <button
                  key={s.title}
                  type="button"
                  role="tab"
                  aria-selected={i === slide}
                  aria-label={`Show slide ${i + 1}: ${s.title}`}
                  className={`carousel-dot ${i === slide ? 'active' : ''}`}
                  onClick={() => { pauseAuto(); goTo(i); }}
                />
              ))}
            </div>
            <button type="button" className="carousel-arrow" onClick={() => { pauseAuto(); goTo(slide + 1); }} aria-label="Next slide">
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};
