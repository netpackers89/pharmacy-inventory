import React, { useState } from 'react';
import './MedicineImage.css';

/*
 * MEDICINE IMAGE with professional fallback.
 *
 * Renders the medicine's image_url (lazy loaded, cropped, rounded);
 * when missing/invalid it shows a pharmacy-styled capsule illustration
 * generated inline (SVG data URI — always available, never a broken icon
 * and never dependent on an external placeholder service).
 */

export const MEDICINE_FALLBACK = (label = 'Medicine') =>
  'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160">
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
      <rect width="240" height="160" fill="url(#bg)"/>
      <circle cx="200" cy="30" r="46" fill="#ffffff" opacity="0.55"/>
      <circle cx="28" cy="132" r="30" fill="#ffffff" opacity="0.4"/>
      <g transform="rotate(-32 120 80)">
        <rect x="60" y="58" width="120" height="44" rx="22" fill="url(#cap)"/>
        <rect x="60" y="58" width="120" height="44" rx="22" fill="none" stroke="#3b5bdb" stroke-opacity="0.25" stroke-width="2"/>
        <rect x="118" y="58" width="4" height="44" fill="#ffffff" opacity="0.85"/>
      </g>
      <text x="120" y="146" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="11" fill="#5b7bd5" font-weight="600">${label.replace(/[<>&]/g, '')}</text>
    </svg>`
  );

export const MedicineImage = ({ src, alt, className }) => {
  const [failed, setFailed] = useState(false);
  const resolved = src && !failed ? src : MEDICINE_FALLBACK(alt || 'Medicine');
  return (
    <img
      className={className}
      src={resolved}
      alt={alt || 'Medicine'}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
};