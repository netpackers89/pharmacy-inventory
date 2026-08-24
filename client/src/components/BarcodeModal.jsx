import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, QrCode, Search, Camera, AlertCircle, Loader2 } from 'lucide-react';
import { inventoryAPI } from '../services/api';
import { Html5Qrcode } from 'html5-qrcode';
import './BarcodeModal.css';

/**
 * BarcodeModal
 *
 * Workflow:
 * 1. Open scanner.
 * 2. Scan barcode / QR code.
 * 3. Look up the exact code in current pharmacy stock.
 * 4. When found, immediately call onScanSuccess(found).
 * 5. Parent POS adds that exact medicine to the selling cart.
 * 6. Modal closes automatically.
 *
 * There is intentionally NO "Confirm & Add" step.
 */
export const BarcodeModal = ({ isOpen, onClose, onScanSuccess }) => {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [error, setError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);

  const scannerRef = useRef(null);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;

    if (!scanner) return;

    try {
      const state = typeof scanner.getState === 'function' ? scanner.getState() : null;

      // Do not call stop() if the camera was never successfully started.
      if (
        state === 'NOT_STARTED' ||
        state === 'STOPPED' ||
        state === 'PAUSED' ||
        state === undefined
      ) {
        scannerRef.current = null;
        return;
      }
    } catch (err) {
      console.debug('Scanner state check failed:', err);
    }

    try {
      await scanner.stop();
    } catch (err) {
      console.debug('Scanner stop:', err);
    }

    try {
      scanner.clear();
    } catch (err) {
      console.debug('Scanner clear:', err);
    }

    scannerRef.current = null;
  }, []);

  const closeModal = useCallback(async () => {
    await stopScanner();

    if (mountedRef.current) {
      setIsScanning(false);
      setIsLookingUp(false);
      setError('');
      setCameraError('');
      setBarcodeInput('');
    }

    onClose?.();
  }, [onClose, stopScanner]);

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
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[-_]/g, '');

  const getCodeValues = (item) => {
    return [
      item?.barcode,
      item?.bar_code,
      item?.barcode_number,
      item?.qr_code,
      item?.qrCode,
      item?.qr,
      item?.batch_number,
      item?.generic_name,
      item?.brand_name,
      item?.strength,
    ]
      .filter((value) => value !== undefined && value !== null)
      .map((value) => normalizeLookupValue(value))
      .filter(Boolean);
  };

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
        const response = await inventoryAPI.getStock({
          search: actualCode,
        });

        const matches = extractStockRows(response);
        const normalizedCode = normalizeLookupValue(actualCode);

        // Prefer an exact scan match, but allow the first valid inventory row as a fallback.
        const exactMatch = matches.find((item) =>
          getCodeValues(item).includes(normalizedCode)
        );

        const found = exactMatch || matches[0] || null;

        if (!found) {
          throw new Error(
            `No medicine in stock was found for barcode/QR: ${actualCode}`
          );
        }

        // Send the EXACT scanned stock row to POS immediately.
        // The parent POS is responsible for adding it to the selling cart.
        await stopScanner();

        if (mountedRef.current) {
          setIsScanning(false);
          setIsLookingUp(false);
        }

        onScanSuccess?.(found);

        // Close immediately after adding to POS.
        onClose?.();
      } catch (err) {
        console.error('Barcode lookup failed:', err);

        if (mountedRef.current) {
          setIsLookingUp(false);
          setError(
            err?.message?.startsWith('No medicine')
              ? err.message
              : 'Unable to find this medicine. Check the barcode/QR code or enter it manually.'
          );
        }

        processingRef.current = false;

        // Camera can continue after a failed lookup.
        try {
          if (scannerRef.current) {
            await scannerRef.current.resume();
          }
        } catch (resumeError) {
          console.debug('Scanner resume:', resumeError);
        }
      }
    },
    [barcodeInput, onClose, onScanSuccess, stopScanner]
  );

  useEffect(() => {
    if (!isOpen) return undefined;

    let cancelled = false;

    const startCamera = async () => {
      setBarcodeInput('');
      setError('');
      setCameraError('');
      setIsLookingUp(false);
      setIsScanning(false);
      processingRef.current = false;

      // Make sure an old scanner cannot remain attached.
      await stopScanner();

      if (cancelled) return;

      const readerElement = document.getElementById('barcode-reader');

      if (!readerElement) {
        setCameraError('Scanner could not initialize. Please use manual entry.');
        return;
      }

      try {
        const scanner = new Html5Qrcode('barcode-reader');
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 12,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const width = Math.min(
                320,
                Math.max(220, Math.floor(viewfinderWidth * 0.78))
              );
              const height = Math.min(
                170,
                Math.max(100, Math.floor(viewfinderHeight * 0.42))
              );

              return {
                width,
                height,
              };
            },
            aspectRatio: 1.6,
            disableFlip: false,
          },
          async (decodedText) => {
            await handleLookup(decodedText);
          },
          () => {
            // Ignore normal "no QR/barcode detected" frames.
          }
        );

        if (!cancelled && mountedRef.current) {
          setIsScanning(true);
        }
      } catch (err) {
        console.error('Camera start failed:', err);

        try {
          await stopScanner();
        } catch {
          // Safe cleanup.
        }

        if (!cancelled && mountedRef.current) {
          setIsScanning(false);
          setCameraError(
            'Camera is unavailable or permission was denied. You can still enter the barcode or QR code manually.'
          );
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopScanner();
      processingRef.current = false;
    };
  }, [isOpen, handleLookup, stopScanner]);

  const handleManualLookup = () => {
    handleLookup(barcodeInput);
  };

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
        if (event.target === event.currentTarget && !isLookingUp) {
          closeModal();
        }
      }}
    >
      <section
        className="barcode-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="barcode-modal__header">
          <div className="barcode-modal__title">
            <div className="barcode-modal__icon">
              <QrCode size={22} strokeWidth={2.2} />
            </div>

            <div>
              <h2 id="barcode-modal-title">Scan Medicine</h2>
              <p>Scan a barcode or QR code to add it directly to POS</p>
            </div>
          </div>

          <button
            type="button"
            className="barcode-modal__close"
            onClick={closeModal}
            disabled={isLookingUp}
            aria-label="Close scanner"
          >
            <X size={20} />
          </button>
        </header>

        <div className="barcode-modal__body">
          <div className="scanner-shell">
            <div id="barcode-reader" className="barcode-reader" />

            {!cameraError && !isLookingUp && (
              <div className="scanner-guide" aria-hidden="true">
                <div className="scanner-guide__corners">
                  <span className="corner corner--tl" />
                  <span className="corner corner--tr" />
                  <span className="corner corner--bl" />
                  <span className="corner corner--br" />
                </div>

                <div className="scanner-guide__line" />
                <div className="scanner-guide__text">
                  Align barcode / QR code inside the frame
                </div>
              </div>
            )}

            {isLookingUp && (
              <div className="scanner-loading">
                <div className="scanner-loading__card">
                  <Loader2 className="scanner-loading__icon" size={28} />
                  <strong>Adding medicine to POS…</strong>
                  <span>Checking current stock</span>
                </div>
              </div>
            )}

            {cameraError && (
              <div className="scanner-fallback">
                <div className="scanner-fallback__icon">
                  <Camera size={26} />
                </div>
                <strong>Camera unavailable</strong>
                <p>{cameraError}</p>
              </div>
            )}
          </div>

          <div className="manual-entry">
            <div className="manual-entry__label">
              <Search size={15} />
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
                placeholder="Enter barcode or QR code"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck="false"
                disabled={isLookingUp}
              />

              <button
                type="button"
                onClick={handleManualLookup}
                disabled={!barcodeInput.trim() || isLookingUp}
                className="manual-entry__button"
              >
                {isLookingUp ? (
                  <Loader2 size={18} className="spin" />
                ) : (
                  <Search size={18} />
                )}
                <span>Find</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="barcode-alert barcode-alert--error" role="alert">
              <AlertCircle size={18} />
              <div>
                <strong>Medicine not found</strong>
                <span>{error}</span>
              </div>
            </div>
          )}

          {!error && !cameraError && !isLookingUp && (
            <div className="scanner-status">
              <span
                className={`scanner-status__dot ${
                  isScanning ? 'scanner-status__dot--active' : ''
                }`}
              />
              <span>
                {isScanning
                  ? 'Camera ready — scan the medicine'
                  : 'Starting camera…'}
              </span>
            </div>
          )}
        </div>

        <footer className="barcode-modal__footer">
          <span>
            Scanned medicine is added to the current POS sale automatically.
          </span>

          <button
            type="button"
            className="barcode-modal__cancel"
            onClick={closeModal}
            disabled={isLookingUp}
          >
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
};

export default BarcodeModal;
