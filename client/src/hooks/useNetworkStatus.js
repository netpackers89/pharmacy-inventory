import { useState, useEffect, useCallback, useRef } from 'react';
import { syncMedicines, getOfflineStats, getLastSyncAt, clearAllOfflineData } from '../services/offlineSync';
import { medicinesAPI } from '../services/api';

/**
 * useNetworkStatus — one reliable online/offline + sync state machine for the
 * whole app.
 *
 * The browser's `navigator.onLine` only knows whether a network interface
 * exists, not whether the pharmacy's server is actually reachable. This hook
 * therefore combines the browser events with an explicit health probe of the
 * real API, so the indicator says "Offline" when the server is genuinely
 * unreachable — not merely when a cable is plugged in.
 *
 * It also drives synchronisation:
 *   • when the connection returns, sync the local cache from the backend;
 *   • record the time of the last successful sync;
 *   • expose a manual `syncNow()` for the Settings page.
 *
 * Nothing here ever blocks or breaks the app: every failure is swallowed and
 * simply leaves the app in its offline state.
 */

const HEALTH_PROBE_TIMEOUT_MS = 6000;

/* How long to wait before re-probing after a failure (grows while offline so
   we never hammer the API or fill the console with repeated errors). */
const RETRY_DELAYS = [5000, 15000, 30000, 60000];

let probeAbort = null;

/** Ask the real backend whether it is reachable. */
const probeServer = async () => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

  if (probeAbort) {
    try { probeAbort.abort(); } catch (_) { /* ignore */ }
  }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  probeAbort = controller;

  const timer = setTimeout(() => {
    try { controller?.abort(); } catch (_) { /* ignore */ }
  }, HEALTH_PROBE_TIMEOUT_MS);

  try {
    const { default: api } = await import('../services/api');
    await api.get('/health', { signal: controller?.signal, timeout: HEALTH_PROBE_TIMEOUT_MS });
    return true;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
    if (probeAbort === controller) probeAbort = null;
  }
};

export const useNetworkStatus = (options = {}) => {
  const { enabled = true, autoSync = true } = options;

  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine
  ));
  const [status, setStatus] = useState('online');   // online | offline | syncing | synced
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [stats, setStats] = useState({ medicines: 0, images: 0, available: false });

  const syncingRef = useRef(false);
  const retryIndexRef = useRef(0);
  const retryTimerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }, []);

  const refreshStats = useCallback(async () => {
    const next = await getOfflineStats();
    if (mountedRef.current) setStats(next);
  }, []);

  /* Run a sync, guarding against overlapping runs. */
  const runSync = useCallback(async () => {
    if (syncingRef.current) return { ok: false, reason: 'already-syncing' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { ok: false, reason: 'offline' };
    }

    syncingRef.current = true;
    if (mountedRef.current) setStatus('syncing');

    try {
      const result = await syncMedicines(medicinesAPI);
      if (!mountedRef.current) return result;

      if (result.ok) {
        setStatus('synced');
        setLastSyncAt(await getLastSyncAt());
        await refreshStats();
        retryIndexRef.current = 0;
      } else {
        setStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online');
      }
      return result;
    } catch (_) {
      if (mountedRef.current) setStatus('online');
      return { ok: false, reason: 'error' };
    } finally {
      syncingRef.current = false;
    }
  }, [refreshStats]);

  const syncNow = useCallback(async () => runSync(), [runSync]);

  /* Browser connectivity events. */
  useEffect(() => {
    const goOnline = () => {
      retryIndexRef.current = 0;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      setIsOnline(true);
      setStatus('online');
      if (enabled && autoSync) runSync();
    };
    const goOffline = () => {
      setIsOnline(false);
      setStatus('offline');
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [enabled, autoSync, runSync]);

  /* Initial probe + first sync, and a gentle retry ladder while offline. */
  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;

    const check = async () => {
      const reachable = await probeServer();
      if (cancelled || !mountedRef.current) return;

      if (reachable) {
        retryIndexRef.current = 0;
        setIsOnline(true);
        setStatus((prev) => (prev === 'offline' ? 'online' : prev));
        if (autoSync) runSync();
        return;
      }

      setIsOnline(false);
      setStatus('offline');

      // Schedule a re-probe with a growing delay. This replaces the browser's
      // endless reconnect/error spam with one quiet, controlled retry.
      const index = Math.min(retryIndexRef.current, RETRY_DELAYS.length - 1);
      retryTimerRef.current = setTimeout(check, RETRY_DELAYS[index]);
      retryIndexRef.current += 1;
    };

    getLastSyncAt().then((value) => { if (!cancelled && mountedRef.current) setLastSyncAt(value); });
    refreshStats();
    check();

    return () => {
      cancelled = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [enabled, autoSync, runSync, refreshStats]);

  const clearCache = useCallback(async () => {
    await clearAllOfflineData();
    setLastSyncAt(null);
    await refreshStats();
  }, [refreshStats]);

  return { isOnline, status, lastSyncAt, stats, syncNow, clearCache, refreshStats };
};

export default useNetworkStatus;