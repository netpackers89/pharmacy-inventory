import React from 'react';
import { PackageSearch, RefreshCw, EyeOff } from 'lucide-react';

/* ── Skeleton primitives ─────────────────────────────────────────────── */
export const SkeletonLine = ({ w = '100%', h = '0.85rem', style }) => (
  <div className="skeleton" style={{ width: w, height: h, ...style }} />
);

export const SkeletonCards = ({ count = 4 }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="skeleton-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <SkeletonLine w="55%" h="0.75rem" />
          <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 12 }} />
        </div>
        <SkeletonLine w="38%" h="1.6rem" style={{ marginTop: '0.9rem' }} />
        <SkeletonLine w="70%" h="0.65rem" style={{ marginTop: '0.7rem' }} />
      </div>
    ))}
  </div>
);

export const TableSkeleton = ({ rows = 8, cols = [28, 16, 14, 14, 12] }) => (
  <div aria-busy="true" aria-label="Loading data">
    <div className="skeleton-table-row" style={{ background: 'var(--surface-alt)' }}>
      {cols.map((w, i) => (
        <SkeletonLine key={i} w={`${w}%`} h="0.7rem" style={{ margin: 0 }} />
      ))}
    </div>
    {Array.from({ length: rows }).map((_, r) => (
      <div className="skeleton-table-row" key={r}>
        {cols.map((w, i) => (
          <SkeletonLine key={i} w={`${w}%`} style={{ margin: 0 }} />
        ))}
      </div>
    ))}
  </div>
);

export const ListSkeleton = ({ rows = 5 }) => (
  <div aria-busy="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} style={{ padding: '0.9rem 1rem', borderBottom: '1px solid var(--border)' }}>
        <SkeletonLine w="42%" h="0.85rem" />
        <SkeletonLine w="68%" h="0.65rem" style={{ marginTop: '0.5rem', marginBottom: 0 }} />
      </div>
    ))}
  </div>
);

/* ── Empty state ─────────────────────────────────────────────────────── */
export const EmptyState = ({
  icon,
  title = 'No data found',
  description = 'Try changing your search or filters.',
  actionLabel,
  onAction,
}) => (
  <div className="empty-state fade-in">
    <div className="empty-state__icon">{icon || <PackageSearch size={26} />}</div>
    <div className="empty-state__title">{title}</div>
    <div className="empty-state__desc">{description}</div>
    {actionLabel && onAction && (
      <div className="empty-state__action">
        <button type="button" className="btn btn-secondary" onClick={onAction}>{actionLabel}</button>
      </div>
    )}
  </div>
);

/* ── Error state ─────────────────────────────────────────────────────── */
export const ErrorState = ({ title = 'Unable to load data', description, onRetry }) => (
  <div className="error-state fade-in" role="alert">
    <div className="empty-state__icon" style={{ color: 'var(--danger)', borderColor: 'var(--danger-border)' }}>
      <RefreshCw size={24} />
    </div>
    <div className="error-state__title">{title}</div>
    <div className="error-state__desc">
      {description || 'Something went wrong while retrieving the data. Please try again.'}
    </div>
    {onRetry && (
      <div className="error-state__actions">
        <button type="button" className="btn btn-secondary" onClick={onRetry}>Try Again</button>
      </div>
    )}
  </div>
);

/* ── Guest view-only notice ──────────────────────────────────────────── */
export const GuestNotice = () => (
  <div className="guest-notice fade-in">
    <EyeOff size={18} style={{ flexShrink: 0, marginTop: 2, color: 'var(--text-muted)' }} />
    <span>
      You are browsing in <strong>Guest Mode</strong> (view only). This action is unavailable in
      Guest Mode — sign in with a pharmacy account to make changes.
    </span>
  </div>
);
