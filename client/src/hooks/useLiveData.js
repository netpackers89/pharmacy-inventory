import { useEffect, useRef, useState, useCallback } from 'react';
import { socket } from '../services/socket';

/*
 * CENTRAL LIVE-DATA HOOK (the "once and for all" data layer)
 *
 * Components subscribe to a topic instead of owning their own fetch cycles:
 *   - First call fetches once and caches per topic (shared across pages).
 *   - Server-driven `data_updated` socket events refresh only the topics
 *     that changed (sales -> stock, supplier create -> suppliers, ...).
 * Critical data always comes from the database; this is a cache for speed,
 * never the source of truth.
 */

const cache = new Map();        // topic -> data
const listeners = new Map();    // topic -> Set<callback>
const inflight = new Map();     // topic -> Promise
const lastUpdate = {};          // topic -> timestamp

const notify = (topic) => {
  (listeners.get(topic) || new Set()).forEach((cb) => cb(cache.get(topic)));
};

if (!socket.connected) socket.connect();

socket.on('data_updated', ({ topic } = {}) => {
  const t = topic || 'general';
  lastUpdate[t] = Date.now();
  if (cache.has(t)) {
    // Drop the stale cache; subscribers refetch automatically.
    cache.delete(t);
    notify(t);
  }
});

/**
 * useLiveData(topic, fetcher)
 *   topic   - cache key, also the socket event topic ('medicines', 'stock', …)
 *   fetcher - async () => data
 * Returns [data, { loading, error, refresh, lastUpdateAt }]
 */
export function useLiveData(topic, fetcher) {
  const [data, setData] = useState(() => cache.get(topic) ?? null);
  const [loading, setLoading] = useState(!cache.has(topic));
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0); // bumped on realtime updates to refetch
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (cache.has(topic)) {
        setData(cache.get(topic));
        setLoading(false);
        return;
      }
      if (inflight.has(topic)) {
        await inflight.get(topic);
        if (!cancelled) { setData(cache.get(topic) ?? null); setLoading(false); }
        return;
      }
      setLoading(true);
      const p = (async () => {
        try {
          const result = await fetcherRef.current();
          cache.set(topic, result);
          lastUpdate[topic] = Date.now();
        } catch (e) {
          if (!cancelled) setError(e);
        } finally {
          inflight.delete(topic);
        }
      })();
      inflight.set(topic, p);
      await p;
      if (!cancelled) { setData(cache.get(topic) ?? null); setLoading(false); setTick((t) => t + 1); }
    };
    load();
    return () => { cancelled = true; };
  }, [topic, tick]);

  useEffect(() => {
    const cb = () => setTick((t) => t + 1);
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic).add(cb);
    return () => listeners.get(topic).delete(cb);
  }, [topic]);

  const refresh = useCallback(() => {
    cache.delete(topic);
    setTick((t) => t + 1);
  }, [topic]);

  return [data, { loading, error, refresh, lastUpdateAt: lastUpdate[topic] }];
}

/** Imperatively invalidate a topic after a local mutation. */
export const invalidateTopic = (topic) => {
  cache.delete(topic);
  notify(topic);
};