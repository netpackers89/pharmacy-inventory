import React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

/*
 * Shared management-UI primitives used by Category / Subcategory / Supplier
 * screens. All styling flows through the global design tokens so light and
 * dark mode work automatically.
 */

/* ── StatusBadge: ACTIVE = positive, INACTIVE = muted/neutral ── */
export const StatusBadge = ({ status }) => (
  <span className={`badge ${String(status).toUpperCase() === 'ACTIVE' ? 'badge-success' : 'badge-neutral'}`}>
    {status}
  </span>
);

/* ── FilterTabs: [ All ] [ Active ] [ Inactive ] — default ACTIVE ── */
export const FilterTabs = ({ value, onChange, counts }) => {
  const tabs = [
    { key: 'ACTIVE', label: 'Active', count: counts?.ACTIVE },
    { key: 'INACTIVE', label: 'Inactive', count: counts?.INACTIVE },
    { key: 'ALL', label: 'All', count: counts?.ALL },
  ];
  return (
    <div className="filter-tabs" role="tablist" aria-label="Filter by status">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          className={`filter-tab ${value === t.key ? 'active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {Number.isFinite(t.count) && <span className="filter-tab__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
};

/* ── ConfirmDialog: async-safe confirmation (Deactivate/Activate/…) ── */
export const ConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 1200 }}
      onMouseDown={(e) => {
        // Block accidental close while the action is saving.
        if (e.target === e.currentTarget && !loading) onCancel?.();
      }}
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="modal-card confirm-dialog" style={{ maxWidth: '420px' }}>
        <div className={`confirm-dialog__icon ${danger ? 'danger' : ''}`}>
          <AlertTriangle size={22} />
        </div>
        <h3 className="confirm-dialog__title">{title}</h3>
        <p className="confirm-dialog__message">{message}</p>

        <div className="confirm-actions" style={{ marginTop: '1.25rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'btn btn-primary confirm-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={loading}
            aria-busy={loading}
          >
            {loading && <Loader2 size={15} className="spin" />}
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── Inline button spinner for submit buttons ── */
export const ButtonSpinner = () => <Loader2 size={15} className="spin" />;
