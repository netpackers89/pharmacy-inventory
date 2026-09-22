/*
 * Operational stock status shared by the medicine cards, table views and
 * the detail modal. Order matters: administrative state first, then
 * stock/expiry urgency (worst first). Every state pairs an icon with its
 * text — never colour alone.
 */
export const getStockStatus = (med) => {
  const stock = parseInt(med?.stock_on_hand, 10) || 0;
  if (med?.status && med.status !== 'ACTIVE') {
    return { key: 'inactive', label: 'Inactive', icon: '×', tone: 'muted' };
  }
  if ((parseInt(med?.expired_batches, 10) || 0) > 0) {
    return { key: 'expired', label: 'Expired', icon: '×', tone: 'danger' };
  }
  if (stock <= 0) {
    return { key: 'out', label: 'Out of Stock', icon: '×', tone: 'danger' };
  }
  if ((parseInt(med?.expiring_soon, 10) || 0) > 0) {
    return { key: 'expiring', label: 'Expiring Soon', icon: '⚠', tone: 'warning' };
  }
  const reorder = parseInt(med?.reorder_level, 10) || 0;
  if (reorder > 0 && stock < reorder) {
    return { key: 'low', label: 'Low Stock', icon: '⚠', tone: 'warning' };
  }
  return { key: 'in', label: 'In Stock', icon: '●', tone: 'success' };
};

/* "12 May 2027" style date used on cards + detail modal. */
export const fmtExpiry = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (_) {
    return d;
  }
};
