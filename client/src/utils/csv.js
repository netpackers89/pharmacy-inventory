/*
 * Shared CSV export utility.
 * Exports the CURRENT dataset (already filtered by the page) and
 * produces a meaningful date-stamped filename:
 *   net-pharma-inventory-2026-08-24.csv
 */
const csvEscape = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
};

export const buildCsv = (rows, columns) => {
  if (!rows || !rows.length) return '';

  let keys;
  let headers;

  if (Array.isArray(columns) && columns.length) {
    headers = columns.map((c) => c.label ?? c.key);
    keys = columns.map((c) => c.key);
  } else {
    keys = Object.keys(rows[0]);
    headers = keys;
  }

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(keys.map((k) => csvEscape(row[k])).join(','));
  }
  return lines.join('\r\n');
};

export const todayStamp = () => new Date().toISOString().slice(0, 10);

export const downloadCsv = ({ rows, columns, dataset, notify }) => {
  if (!rows || !rows.length) {
    notify?.warning?.('There is no data to export.');
    return false;
  }

  const csv = buildCsv(rows, columns);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `net-pharma-${dataset}-${todayStamp()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  notify?.success?.(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'} to ${link.download}`);
  return true;
};
