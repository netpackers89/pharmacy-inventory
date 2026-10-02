import React, { useState, useEffect, useRef } from 'react';
import './MedicineImage.css';
import { getCachedImageUrl, cacheMedicineImage } from '../services/offlineSync';

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
 *
 * OFFLINE PICTURES
 * ────────────────
 * Passing `medicineId` turns on local picture support:
 *   • When offline (or if the remote image fails), the copy already stored in
 *     IndexedDB is rendered instead, so a medicine the pharmacist has already
 *     looked at still shows its picture with no connection.
 *   • When online, the picture is quietly downloaded once into IndexedDB so
 *     it is available next time the device goes offline.
 *   • A picture that was never downloaded simply uses the normal placeholder.
 * Without `medicineId` the component behaves exactly as it always has.
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

export const MedicineImage = ({
  src,
  alt,
  className,
  placebo,
  contain = true,
  medicineId,
  medicine,
}) => {
  const [failed, setFailed] = useState(false);
  /* Object URL of the locally cached copy, when one exists. */
  const [localUrl, setLocalUrl] = useState(null);
  const [triedLocal, setTriedLocal] = useState(false);
  const localUrlRef = useRef(null);

  const resolved = getMedicineImage(src);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  /*
   * Online → make sure this picture is stored locally for next time.
   * Runs once per medicine and is a no-op when the URL is missing, inline or
   * already cached, so it never re-downloads the same image.
   */
  useEffect(() => {
    if (!medicine || !resolved) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    cacheMedicineImage({ ...medicine, image_url: resolved });
  }, [medicineId, resolved, medicine]);

  /*
   * Offline (or after a failure) → look for a locally cached copy.
   * `triedLocal` makes sure we only look once per component instance, so a
   * list of 100 cards does not fire 100 identical lookups on re-render.
   */
  useEffect(() => {
    if (medicineId === undefined || medicineId === null) return;
    if (!offline && !failed) return;
    if (triedLocal) return;
    setTriedLocal(true);

    let cancelled = false;
    getCachedImageUrl(medicineId).then((url) => {
      if (cancelled || !url) return;
      localUrlRef.current = url;
      setLocalUrl(url);
    });

    return () => { cancelled = true; };
  }, [medicineId, offline, failed, triedLocal]);

  /* Release the object URL when this card goes away. */
  useEffect(() => () => {
    if (localUrlRef.current) {
      try { URL.revokeObjectURL(localUrlRef.current); } catch (_) { /* ignore */ }
      localUrlRef.current = null;
    }
  }, []);

  const fallback = MEDICINE_FALLBACK(alt || placebo || 'Medicine');

  /*
   * Resolution order:
   *   1. a locally cached copy (offline, or the remote one just failed)
   *   2. the remote/local URL, while it is working
   *   3. the existing inline-SVG placeholder
   */
  const usable = localUrl
    || (resolved && !failed ? resolved : null)
    || fallback;

  return (
    <img
      className={className}
      src={usable}
      alt={alt || placebo || 'Medicine'}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={(e) => {
        /* Broken URL / failed download → try the local copy, else the
           always-available placeholder. */
        if (localUrl) {
          e.currentTarget.src = localUrl;
          return;
        }
        e.currentTarget.src = fallback;
        setFailed(true);
      }}
    />
  );
};