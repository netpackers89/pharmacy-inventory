import React from 'react';
import { CloudOff, RefreshCw, Check, Cloud } from 'lucide-react';
import './ConnectionIndicator.css';

/**
 * ConnectionIndicator — a small, unobtrusive pill showing the app's
 * connection state: Online / Offline / Syncing / Synced.
 *
 * It is informational only. It never blocks the UI, never retries on its own
 * and never produces a sound or a toast. Clicking it (while online) triggers
 * a manual re-sync, which is genuinely useful after a pharmacy's link has
 * been unstable for a while.
 */

const fmtRelative = (iso) => {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(then).toLocaleDateString();
};

export const ConnectionIndicator = ({ status, isOnline, lastSyncAt, onSync, syncing }) => {
  const online = isOnline !== false;
  const isSyncing = status === 'syncing' || syncing;
  const isSynced = status === 'synced';
  const offline = !online || status === 'offline';

  let icon = <Cloud size={13} />;
  let label = 'Online';
  if (offline) {
    icon = <CloudOff size={13} />;
    label = 'Offline';
  } else if (isSyncing) {
    icon = <RefreshCw size={13} className="spin" />;
    label = 'Syncing…';
  } else if (isSynced) {
    icon = <Check size={13} />;
    label = 'Synced';
  }

  const since = fmtRelative(lastSyncAt);

  /* Offline: medicines are read from the local cache. Explain it in a
     tooltip, and make the badge non-interactive — there is nothing to sync. */
  if (offline) {
    return (
      <span
        className="conn-badge conn-badge--offline"
        title={
          since
            ? `No connection. Showing medicines cached on this device (last synced ${since}).`
            : 'No connection. Showing medicines cached on this device.'
        }
      >
        {icon}
        <span className="conn-badge__label">Offline</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`conn-badge ${isSyncing ? 'conn-badge--syncing' : ''} ${isSynced ? 'conn-badge--synced' : ''}`}
      onClick={onSync}
      disabled={isSyncing}
      title={since ? `Last synced ${since}. Click to sync now.` : 'Click to sync now.'}
    >
      {icon}
      <span className="conn-badge__label">{label}</span>
    </button>
  );
};

export default ConnectionIndicator;
