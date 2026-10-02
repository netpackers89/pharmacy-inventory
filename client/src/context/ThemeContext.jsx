import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ThemeContext = createContext();

const STORAGE_KEY = 'pharm_theme';
const PALETTE_KEY = 'pharm_palette';

/*
 * THEME PALETTES
 *
 * `mode` decides whether the page is light or dark; the palette supplies the
 * brand colours on top of it (see styles/variables.css). "system" follows the
 * operating system preference and falls back to the Classic tokens.
 *
 * Keeping the two concepts separate is what allows the Header's light/dark
 * toggle to keep working while the palette (and therefore the colours the
 * toggle acts on) is chosen independently in Settings.
 */
export const PALETTES = [
  { id: 'classic',          label: 'Classic',            mode: 'light', note: "The application's original theme" },
  { id: 'clinical-mint',    label: 'Clinical Mint',      mode: 'light', bg: '#F8FAFC', surface: '#FFFFFF', primary: '#0EA5E9', secondary: '#10B981', text: '#0F172A' },
  { id: 'caduceus-blue',    label: 'Caduceus Blue',      mode: 'light', bg: '#F0F4F8', surface: '#FFFFFF', primary: '#2563EB', secondary: '#059669', text: '#1E293B' },
  { id: 'nordic-sage',      label: 'Nordic Sage',        mode: 'light', bg: '#F4F7F5', surface: '#FFFFFF', primary: '#0F766E', secondary: '#84CC16', text: '#132E2B' },
  { id: 'mono-bw',          label: 'Black & White',      mode: 'light', bg: '#FFFFFF', surface: '#FFFFFF', primary: '#111827', secondary: '#4B5563', text: '#000000' },
  { id: 'midnight-rx',      label: 'Midnight Rx',        mode: 'dark',  bg: '#0B132B', surface: '#1C2541', primary: '#38BDF8', secondary: '#34D399', text: '#F1F5F9' },
  { id: 'cyber-apothecary', label: 'Cyber Apothecary',   mode: 'dark',  bg: '#121212', surface: '#1E1E2E', primary: '#2DD4BF', secondary: '#A855F7', text: '#E2E8F0' },
  { id: 'dracula-slate',    label: 'Dracula Slate',      mode: 'dark',  bg: '#181825', surface: '#1E1E2E', primary: '#89B4FA', secondary: '#A6E3A1', text: '#CDD6F4' },
  { id: 'system',           label: 'System Default',     mode: 'auto',  note: 'Follows your operating system' },
];

const PALETTE_IDS = new Set(PALETTES.map((p) => p.id));
const getPalette = (id) => PALETTES.find((p) => p.id === id) || PALETTES[0];

const prefersDark = () => {
  try {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch (_) {
    return false;
  }
};

const readPalette = () => {
  try {
    const saved = localStorage.getItem(PALETTE_KEY);
    if (saved && PALETTE_IDS.has(saved)) return saved;
  } catch (_) { /* storage unavailable */ }
  return 'classic';
};

const getInitialTheme = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (_) { /* storage unavailable */ }
  return prefersDark() ? 'dark' : 'light';
};

export const ThemeProvider = ({ children }) => {
  const [manualTheme, setManualTheme] = useState(getInitialTheme);
  const [paletteId, setPaletteId] = useState(readPalette);
  const [systemDark, setSystemDark] = useState(prefersDark);

  // Track OS changes so System Default stays live.
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const palette = getPalette(paletteId);
  // "System Default" and a dark palette both resolve to dark automatically.
  const theme = palette.mode === 'auto'
    ? (systemDark ? 'dark' : 'light')
    : palette.mode;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // The "system" palette reuses the Classic tokens for its resolved mode.
    document.documentElement.setAttribute(
      'data-palette',
      paletteId === 'system' ? 'classic' : paletteId
    );
    document.documentElement.setAttribute('data-palette-mode', paletteId);
  }, [theme, paletteId]);

  const setPalette = useCallback((id) => {
    if (!PALETTE_IDS.has(id)) return;
    setPaletteId(id);
    try { localStorage.setItem(PALETTE_KEY, id); } catch (_) { /* ignore */ }
  }, []);

  const setTheme = useCallback((next) => {
    const value = next === 'dark' ? 'dark' : 'light';
    setManualTheme(value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch (_) { /* ignore */ }
  }, []);

  const toggleTheme = useCallback(() => {
    // Smooth cross-fade of surfaces while switching
    document.documentElement.classList.add('theme-transition');
    setTheme(theme === 'dark' ? 'light' : 'dark');
    window.setTimeout(
      () => document.documentElement.classList.remove('theme-transition'),
      350
    );
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, palette, paletteId, setPalette, palettes: PALETTES }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};
