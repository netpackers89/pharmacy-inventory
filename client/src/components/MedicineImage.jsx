import React, { useState } from 'react';
import './MedicineImage.css';

/*
 * MEDICINE IMAGE system.
 *
 * getMedicineImage(med) normalizes every supported image_url format in ONE
 * place so cards, tables, POS and the details view all behave identically:
 *   1. blank / missing          → fallback (inline SVG — always available)
 *   2. https?://… external URL  → used as-is
 *   3. data:image/…             → used as-is
 *   4. /… local public asset    → used as-is (resolves on the app origin)
 *   5. anything else (garbage)  → fallback (never produces /api/images/undefined
 *                                 or http://host/http://… double prefixes)
 *
 * The rendered <img> is fully predictable: fixed aspect-ratio container,
 * object-fit: contain, lazy loading, and an onError handler that swaps in
 * the fallback image instantly when a URL turns out to be broken.
 */

export const MEDICINE_FALLBACK = (label = 'Medicine') =>
  'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#eef4ff"/>
          <stop offset="100%" stop-color="#e3ecfb"/>
        </linearGradient>
        <linearGradient id="cap" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#4f74f9"/>
          <stop offset="50%" stop-color="#6d8bfb"/>
          <stop offset="100%" stop-color="#f2f5ff"/>
        </linearGradient>
      </defs>
      <rect width="240" height="240" fill="url(#bg)"/>
      <circle cx="200" cy="30" r="58" fill="#ffffff" opacity="0.55"/>
      <circle cx="28" cy="205" r="40" fill="#ffffff" opacity="0.4"/>
      <g transform="rotate(-32 120 120)">
        <rect x="70" y="88" width="100" height="64" rx="32" fill="url(#cap)"/>
        <rect x="70" y="88" width="100" height="64" rx="32" fill="none" stroke="#3b5bdb" stroke-opacity="0.25" stroke-width="2"/>
        <rect x="116" y="88" width="5" height="64" fill="#ffffff" opacity="0.85"/>
      </g>
      <text x="120" y="222" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="13" fill="#5b7bd5" font-weight="600">${(label || 'Medicine').replace(/[<>&]/g, '')}</text>
    </svg>`
  );

/**
 * Normalize a medicine image URL. Returns the usable URL or null when the
 * value is missing/invalid so the caller can fall back to MEDICINE_FALLBACK.
 */
export const getMedicineImage = (src) => {
  if (!src || typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (!trimmed) return null;
  // External URLs and inline data URIs pass through untouched.
  if (/^(https?:|data:image\/)/i.test(trimmed)) return trimmed;
  // Local public assets (/assets/…, /uploads/…) resolve on the frontend origin.
  if (trimmed.startsWith('/')) return trimmed;
  // Relative app assets (assets/…) also work in dev.
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) return trimmed;
  // Anything else (plain names, "undefined", "/api/images/…") is garbage.
  return null;
};

/**
 * Convenience: normalize from a medicine record's image_url field.
 */
export const getMedicineImageFromMedicine = (med) =>
  getMedicineImage(med?.image_url);

export const MedicineImage = ({ src, alt, className, placebo, contain = true }) => {
  const [failed, setFailed] = useState(false);
  const resolved = getMedicineImage(src);
  const usable = resolved && !failed ? resolved : MEDICINE_FALLBACK(alt || placebo || 'Medicine');

  return (
    <img
      className={className}
      src={usable}
      alt={alt || placebo || 'Medicine'}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={(e) => {
        // Broken URL / failed download → swap in the working fallback.
        e.currentTarget.src = MEDICINE_FALLBACK(alt || placebo || 'Medicine');
        setFailed(true);
      }}
    />
  );
};