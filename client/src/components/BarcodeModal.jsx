import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X, QrCode, Search, Camera, AlertCircle, Loader2, PackagePlus,
  Frame, Zap, ZapOff, RefreshCw,
} from 'lucide-react';
import { inventoryAPI } from '../services/api';
import { Html5Qrcode } from 'html5-qrcode';
import './BarcodeModal.css';

/**
 * BarcodeModal
 *
 * Workflow:
 * 1. Open scanner (rear camera preferred).
 * 2. Scan barcode / QR code — native BarcodeDetector used when available
 *    for fast decoding, jsQR fallback everywhere else.
 * 3. Look up the exact code in current pharmacy stock.
 * 4. Found    -> onScanSuccess(found) -> POS adds it -> modal closes.
 * 5. Unknown  -> offer "Register this medicine" (onRegisterRequest).
 *
 * UX features:
 *  - Adjustable scan frame (S / M / L) — swaps instantly without losing theme
 *  - Torch toggle when the device supports it
 *  - Manual code entry fallback
 */

/* Frame presets: fraction of the video viewfinder covered by the scan box */
const FRAME_SIZES = [
  { key: 'S', label: 'Small', wf: 0.52, hf: 0.32 },
  { key: 'M', label: 'Medium', wf: 0.72, hf: 0.44 },
  { key: 'L', label: 'Large', wf: 0.9, hf: 0.58 },
];

const FRAME_STORAGE_KEY = 'pharm_scanner_frame';

export const BarcodeModal = ({ isOpen, onClose, onScanSuccess, onRegisterRequest }) => {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [error, setError] = useState('');
  const [unknownCode, setUnknownCode] = useState(null);
  const [cameraError, setCameraError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [flash, setFlash] = useState(false); // success pulse

  const [frameKey, setFrameKey] = useState(() => {
    try { return localStorage.getItem(FRAME_STORAGE_KEY) || 'M'; } catch { return 'M'; }
  });
  const frame = FRAME_SIZES.find((f) => f.key === frameKey) || FRAME_SIZES[1];

  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  const scannerRef = useRef(null);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const lastScanRef = useRef({ code: null, at: 0 });

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /* ── Scanner lifecycle ─────────────────────────────────────────────── */
  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;

    try {
      const state = typeof scanner.getState === 'function' ? scanner.getState() : null;
      if (state === 'NOT_STARTED' || state === 'STOPPED' || state === 'PAUSED' || state === undefined) {
        scannerRef.current = null;
        return;
      }
    } catch { /* state check is best-effort */ }

    try { await scanner.stop(); } catch { /* ignore */ }
    try { scanner.clear(); } catch { /* ignore */ }
    scannerRef.current = null;
  }, []);

  const startScanner = useCallback(async (activeFrame) => {
    await stopScanner();

    if (!mountedRef.current) return;

    const readerElement = document.getElementById('barcode-reader');
    if (!readerElement) {
      setCameraError('Scanner could not initialize. Please use manual entry.');
      return;
    }

    try {
      const scanner = new Html5Qrcode('barcode-reader', {
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        formatsToSupport: undefined, // all supported formats (barcodes + QR)
      });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: (vw, vh) => ({
            width: Math.max(140, Math.floor(vw * activeFrame.wf)),
            height: Math.max(90, Math.floor(vh * activeFrame.hf)),
          }),
          aspectRatio: 1.6,
          disableFlip: false,
        },
        async (decodedText) => {
          /* Debounce identical rapid re-reads of the same code */
          const now = Date.now();
          if (
            lastScanRef.current.code === decodedText &&
            now - lastScanRef.current.at < 1500 &&
            processingRef.current
          ) return;
          lastScanRef.current = { code: decodedText, at: now };
          handleLookup(decodedText);
        },
        () => { /* no-code frames are normal */ }
      );

      if (mountedRef.current) {
        setIsScanning(true);

        // Detect torch support once the track exists
        try {
          const caps = scanner.getRunningTrackCapabilities?.();
          setTorchSupported(Boolean(caps && 'torch' in caps));
        } catch {
          setTorchSupported(false);
        }
      }
    } catch (err) {
      console.error('Camera start failed:', err);
      try { await stopScanner(); } catch { /* safe */ }

      if (mountedRef.current) {
        setIsScanning(false);
        setCameraError('Camera is unavailable or permission was denied. You can still enter the barcode or QR code manually.');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopScanner]);

  /* Start/stop with modal open state AND frame changes (instant frame swap) */
  useEffect(() => {
    if (!isOpen) return undefined;

    let cancelled = false;

    const boot = async () => {
      setBarcodeInput('');
      setError('');
      setCameraError('');
      setIsLookingUp(false);
      setIsScanning(false);
      setUnknownCode(null);
      setTorchOn(false);
      processingRef.current = false;
      lastScanRef.current = { code: null, at: 0 };

      await startScanner(frame);
      if (cancelled) await stopScanner();
    };

    boot();

    return () => {
      cancelled = true;
      stopScanner();
      processingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /* Frame change while open: warm-swap the scanner (permission already held) */
  const changeFrame = async (key) => {
    if (key === frameKey || !isOpen) return;
    setFrameKey(key);
    try { localStorage.setItem(FRAME_STORAGE_KEY, key); } catch { /* private mode */ }

    if (!scannerRef.current && !isScanning) return; // camera failed — just remember choice

    setIsSwapping(true);
    setTorchOn(false);
    await startScanner(FRAME_SIZES.find((f) => f.key === key) || FRAME_SIZES[1]);
    if (mountedRef.current) setIsSwapping(false);
  };

  const toggleTorch = async () => {
    const scanner = scannerRef.current;
    if (!scanner || !torchSupported) return;
    try {
      await scanner.applyVideoConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(!torchOn);
    } catch (err) {
      console.debug('Torch toggle failed:', err);
      setTorchSupported(false);
    }
  };

  const closeModal = useCallback(async () => {
    await stopScanner();
    if (mountedRef.current) {
      setIsScanning(false);
      setIsLookingUp(false);
      setError('');
      setCameraError('');
      setBarcodeInput('');
      setUnknownCode(null);
      setFlash(false);
    }
    onClose?.();
  }, [onClose, stopScanner]);

  /* ── Lookup (unchanged business rules) ─────────────────────────────── */
  const extractStockRows = (response) => {
    const payload = response?.data;
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.rows)) return payload.rows;
    if (Array.isArray(payload?.results)) return payload.results;
    return [];
  };

  const normalizeLookupValue = (value) =>
    String(value ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/[-_]/g, '');

  const getCodeValues = (item) =>
    [
      item?.barcode, item?.bar_code, item?.barcode_number,
      item?.qr_code, item?.qrCode, item?.qr,
      item?.batch_number, item?.generic_name, item?.brand_name, item?.strength,
    ]
      .filter((v) => v !== undefined && v !== null)
      .map(normalizeLookupValue)
      .filter(Boolean);

  const handleLookup = useCallback(
    async (codeValue) => {
      const actualCode = String(codeValue || barcodeInput || '').trim();
      if (!actualCode || processingRef.current) return;

      processingRef.current = true;

      if (mountedRef.current) {
        setError('');
        setIsLookingUp(true);
      }

      try {
        const response = await inventoryAPI.getStock({ search: actualCode });
        const matches = extractStockRows(response);
        const normalizedCode = normalizeLookupValue(actualCode);

        // Prefer an exact scan match, fall back to the first valid row.
        const exactMatch = matches.find((item) => getCodeValues(item).includes(normalizedCode));
        const found = exactMatch || matches[0] || null;

        if (!found) {
          if (mountedRef.current) {
            setUnknownCode(actualCode);
            setError('');
            setIsLookingUp(false);
          }
          processingRef.current = false;
          return;
        }

        if (mountedRef.current) setFlash(true);

        await stopScanner();

        if (mountedRef.current) {
          setIsScanning(false);
          setIsLookingUp(false);
        }

        onScanSuccess?.(found);
        onClose?.();
      } catch (err) {
        console.error('Barcode lookup failed:', err);
        if (mountedRef.current) {
          setIsLookingUp(false);
          setError('Unable to check this code right now. Verify it or try again.');
        }
        processingRef.current = false;

        try { await scannerRef.current?.resume(); } catch { /* camera keeps running or restarts */ }
      }
    },
    [barcodeInput, onClose, onScanSuccess, stopScanner]
  );

  const handleManualLookup = () => handleLookup(barcodeInput);

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleManualLookup();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="barcode-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="barcode-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isLookingUp) closeModal();
      }}
    >
      <section className="barcode-modal" onMouseDown={(event) => event.stopPropagation()}>
        {/* ── Header ── */}
        <header className="barcode-modal__header">
          <div className="barcode-modal__title">
            <div className="barcode-modal__icon">
              <QrCode size={21} strokeWidth={2.2} />
            </div>
            <div>
              <h2 id="barcode-modal-title">Scan Medicine</h2>
              <p>Barcode or QR — added straight to POS</p>
            </div>
          </div>

          <button
            type="button"
            className="barcode-modal__close"
            onClick={closeModal}
            disabled={isLookingUp}
            aria-label="Close scanner"
          >
            <X size={19} />
          </button>
        </header>

        {/* ── Body ── */}
        <div className="barcode-modal__body">
          <div className="scanner-shell">
            <div id="barcode-reader" className="barcode-reader" />

            {!cameraError && !isLookingUp && (
              <>
                {/* Adjustable frame guide */}
                <div className={`scanner-guide frame-${frame.key}`} aria-hidden="true">
                  <div className="scanner-guide__corners">
                    <span className="corner corner--tl" />
                    <span className="corner corner--tr" />
                    <span className="corner corner--bl" />
                    <span className="corner corner--br" />
                  </div>
                  <div className="scanner-guide__line" />
                </div>

                {/* Frame controls */}
                <div className="scanner-controls">
                  <div className="frame-switch" role="group" aria-label="Scan frame size">
                    <Frame size={13} />
                    {FRAME_SIZES.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        className={`frame-switch__btn ${frameKey === f.key ? 'active' : ''}`}
                        onClick={() => changeFrame(f.key)}
                        disabled={isSwapping || isLookingUp}
                        title={`${f.label} frame`}
                        aria-pressed={frameKey === f.key}
                      >
                        {f.key}
                      </button>
                    ))}
                  </div>

                  {torchSupported && (
                    <button
                      type="button"
                      className={`scanner-chip-btn ${torchOn ? 'active' : ''}`}
                      onClick={toggleTorch}
                      title={torchOn ? 'Turn light off' : 'Turn light on'}
                      aria-label={torchOn ? 'Turn light off' : 'Turn light on'}
                    >
                      {torchOn ? <ZapOff size={15} /> : <Zap size={15} />}
                    </button>
                  )}
                </div>

                <div className="scanner-guide__text">Align the code inside the frame</div>
              </>
            )}

            {(isSwapping || (!isScanning && !cameraError && !isLookingUp)) && (
              <div className="scanner-boot" aria-live="polite">
                <Loader2 size={20} className="spin" />
                <span>{isSwapping ? 'Adjusting frame…' : 'Starting camera…'}</span>
              </div>
            )}

            {flash && <div className="scanner-flash" aria-hidden="true" />}

            {isLookingUp && (
              <div className="scanner-loading">
                <div className="scanner-loading__card">
                  <Loader2 className="scanner-loading__icon spin" size={26} />
                  <strong>Adding medicine to POS…</strong>
                  <span>Checking current stock</span>
                </div>
              </div>
            )}

            {cameraError && (
              <div className="scanner-fallback">
                <div className="scanner-fallback__icon"><Camera size={24} /></div>
                <strong>Camera unavailable</strong>
                <p>{cameraError}</p>
              </div>
            )}
          </div>

          {/* Manual entry */}
          <div className="manual-entry">
            <div className="manual-entry__label">
              <Search size={14} />
              <span>Manual barcode / QR entry</span>
            </div>

            <div className="manual-entry__row">
              <input
                type="text"
                value={barcodeInput}
                onChange={(event) => {
                  setBarcodeInput(event.target.value);
                  if (error) setError('');
                }}
                onKeyDown={handleKeyDown}
                placeholder="Type or plug in a USB scanner…"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck="false"
                inputMode="search"
                disabled={isLookingUp}
              />

              <button
                type="button"
                onClick={handleManualLookup}
                disabled={!barcodeInput.trim() || isLookingUp}
                className="manual-entry__button"
              >
                {isLookingUp ? <Loader2 size={17} className="spin" /> : <Search size={17} />}
                <span>Find</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="barcode-alert barcode-alert--error" role="alert">
              <AlertCircle size={17} />
              <div>
                <strong>Lookup failed</strong>
                <span>{error}</span>
              </div>
            </div>
          )}

          {!error && unknownCode && (
            <div className="barcode-alert barcode-alert--unknown" role="status">
              <div>
                <strong>This code is not registered</strong>
                <span>
                  “{unknownCode}” does not match any medicine in stock. Would you like to register it?
                </span>
              </div>
              <button
                type="button"
                className="barcode-register-btn"
                onClick={() => {
                  const code = unknownCode;
                  setUnknownCode(null);
                  onRegisterRequest?.(code);
                }}
              >
                <PackagePlus size={15} />
                Yes, Register Medicine
              </button>
            </div>
          )}

          {!error && !unknownCode && !cameraError && !isLookingUp && (
            <div className="scanner-status">
              <span className={`scanner-status__dot ${isScanning ? 'scanner-status__dot--active' : ''}`} />
              <span>
                {isScanning
                  ? 'Ready — hold steady over the code'
                  : 'Preparing scanner…'}
              </span>
              <RefreshCw size={12} style={{ opacity: 0.45 }} aria-hidden="true" />
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <footer className="barcode-modal__footer">
          <span>The scanned medicine joins your current POS sale.</span>
          <button type="button" className="barcode-modal__cancel" onClick={closeModal} disabled={isLookingUp}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
};

export default BarcodeModal;
