import React, { useState, useEffect, useMemo } from 'react';
import './Import.css';
import {
  Upload, Download, Check, AlertTriangle,
  XCircle, Building2, Loader2, ChevronDown, ChevronRight, PackagePlus,
  RefreshCw, Pill, FileText,
} from 'lucide-react';
import { medicinesAPI, suppliersAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useGuestGuard } from '../hooks/useGuestGuard';
import { invalidateTopic } from '../hooks/useLiveData';

const DRAFT_KEY = 'pharm_import_draft_v1';
const IMPORT_HISTORY_KEY = 'pharm_import_history_v1';

const STATUS_META = {
  ready: { cls: 'imp-badge ready', label: 'Ready' },
  duplicate: { cls: 'imp-badge duplicate', label: 'Duplicate' },
  error: { cls: 'imp-badge error', label: 'Missing data' },
  supplier_issue: { cls: 'imp-badge supplier', label: 'Supplier issue' },
};

/* Minimal quoted-CSV parser (handles "a,b", ""-escapes and CRLF). */
function parseCsv(text) {
  const rows = [];
  let cur = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { cur.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cur.push(field); field = '';
      if (cur.some((c) => c !== '')) rows.push(cur);
      cur = [];
    } else field += ch;
  }
  cur.push(field);
  if (cur.some((c) => c !== '')) rows.push(cur);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/* Client-side mirror of the server validation so edits re-validate instantly. */
const isValidDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const squash = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const identityKeyForRow = (row) => [
  squash(row.generic_name),
  squash(row.brand_name),
  squash(row.strength).replace(/\s+/g, '').replace(/(mg|mcg|ug|ml|iu|units?|meq|mmol|g|l|%)$/i, '$1'),
].join('||');

function localValidate(row, registeredSuppliers, mode) {
  const issues = [];
  if (!row.generic_name) issues.push({ field: 'generic_name', message: 'Generic name is required' });
  if (!row.strength) issues.push({ field: 'strength', message: 'Strength is required' });

  if (mode === 'batch') {
    // Required batch fields
    const required = [
      ['batch_number', 'Batch Number'],
      ['expiry_date', 'Expiry Date'],
      ['quantity', 'Units Received'],
      ['buy_price', 'Buy Price'],
      ['sell_price', 'Sell Price'],
      ['supplier', 'Supplier'],
      ['packaging_unit', 'Packaging Unit'],
      ['units_per_package', 'Single doses per selected unit'],
    ];
    for (const [f, label] of required) {
      if (!row[f]) issues.push({ field: f, message: `${label} is missing` });
    }
    if (row.expiry_date && !isValidDate(row.expiry_date)) issues.push({ field: 'expiry_date', message: 'Use YYYY-MM-DD' });
    if (row.quantity && (!Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0)) issues.push({ field: 'quantity', message: 'Units received must be positive' });
    if (row.units_per_package && (!Number.isFinite(Number(row.units_per_package)) || Number(row.units_per_package) < 1)) issues.push({ field: 'units_per_package', message: 'Must be at least 1' });
    if (row.packaging_unit && !['SINGLE_DOSE', 'STRIP', 'INNER_BOX', 'OUTER_BOX'].includes(String(row.packaging_unit).toUpperCase())) {
      issues.push({ field: 'packaging_unit', message: 'Must be SINGLE_DOSE, STRIP, INNER_BOX, or OUTER_BOX' });
    }
    if (row.abc_category && !['A', 'B', 'C'].includes(String(row.abc_category).toUpperCase())) {
      issues.push({ field: 'abc_category', message: 'Must be A, B, or C' });
    }
    if (row.ven_category && !['V', 'E', 'N'].includes(String(row.ven_category).toUpperCase())) {
      issues.push({ field: 'ven_category', message: 'Must be V, E, or N' });
    }
  }

  const supplierOk = mode !== 'batch' || !row.supplier || registeredSuppliers.some((s) => squash(s.name) === squash(row.supplier));
  return { issues, supplierOk };
}

/* What will this row DO once imported? (shown in the Action column) */
function actionLabel(row, mode) {
  if (mode === 'medicine') {
    if (!row.medicine_id) return 'New Medicine';
    return 'Update Existing';
  }
  if (!row.medicine_id) return 'New Medicine + Batch';
  if (row.duplicate && row.batch_id) {
    const qty = Number(row.data.quantity) || 0;
    const next = (Number(row.current_stock) || 0) + qty;
    return `Restock +${qty} → ${next}`;
  }
  return 'New Batch';
}

export const Import = () => {
  const { toast } = useToast();
  const guard = useGuestGuard();

  const [rows, setRows] = useState([]);            // editable preview rows
  const [suppliers, setSuppliers] = useState([]);  // registered suppliers
  const [parsing, setParsing] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [expandedRow, setExpandedRow] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);
  const [supplierModal, setSupplierModal] = useState(null); // { name, rowIndex }
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_person: '', phone: '', address: '', email: '' });
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [importHistory, setImportHistory] = useState(() => {
    try {
      const saved = localStorage.getItem(IMPORT_HISTORY_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showHistory, setShowHistory] = useState(false);

  /*
   * Import modes on ONE page:
   *   Medicines  → master data only (importing a medicine does NOT add stock)
   *   Batch      → new batch / restock existing batch (resupply)
   */
  const [mode, setMode] = useState(() => localStorage.getItem('pharm_import_mode') || 'batch');
  useEffect(() => { localStorage.setItem('pharm_import_mode', mode); setResults(null); }, [mode]);

  const PAGE_SIZE = 25;

  useEffect(() => {
    suppliersAPI.getAll({ status: 'ACTIVE' })
      .then((res) => setSuppliers(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
    // Restore a saved draft import if the user left mid-workflow.
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (draft?.rows?.length) {
        setRows(draft.rows);
        toast.info?.(`Restored draft import (${draft.rows.length} rows).`);
      }
    } catch (_) { /* ignore corrupt drafts */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Persist draft so an accidental refresh never loses staged work. */
  useEffect(() => {
    if (rows.length > 0) localStorage.setItem(DRAFT_KEY, JSON.stringify({ rows, at: Date.now() }));
    else localStorage.removeItem(DRAFT_KEY);
  }, [rows]);

  const applyPreview = (rawRows, selectedMode = mode) => {
    setParsing(true);
    medicinesAPI.previewImport(rawRows, selectedMode)
      .then((res) => {
        setRows(Array.isArray(res.data) ? res.data : []);
        setResults(null);
        setFilter('ALL');
        setPage(1);
      })
      .catch((err) => toast.error(
        err?.response?.data?.details || err?.response?.data?.error || err?.message ||
        'Could not validate the file. Check the format and try again.'
      ))
      .finally(() => setParsing(false));
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        let parsed = [];
        if (file.name.toLowerCase().endsWith('.json')) {
          const source = String(evt.target.result || '')
            .replace(/^\uFEFF/, '')
            .replace(/^\s*```(?:json)?\s*/i, '')
            .replace(/\s*```\s*$/i, '')
            .trim();
          const json = JSON.parse(source);
          parsed = Array.isArray(json) ? json : (Array.isArray(json?.rows) ? json.rows : [json]);
        } else {
          parsed = parseCsv(evt.target.result);
        }
        if (!parsed.length) { toast.error('No data rows found in the file.'); setParsing(false); return; }
        const hasBatchColumns = parsed.some((row) => row.batch_number || row.batch || row['Batch Number *'] || row.quantity || row['Units Received *']);
        const detectedMode = hasBatchColumns ? 'batch' : 'medicine';
        setMode(detectedMode);
        applyPreview(parsed, detectedMode);
      } catch (err) {
        toast.error(`Could not read the file: ${err?.message || 'invalid CSV or JSON format'}`);
        setParsing(false);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const downloadTemplate = async () => {
    try {
      const res = await medicinesAPI.importTemplate({ type: mode });
      const tRows = Array.isArray(res.data) ? res.data : [];
      if (!tRows.length) { toast.error('Could not download the template.'); return; }

      /* Human-readable headers — the import parser understands these labels
         via its alias map, so a downloaded (edit + re-upload) template still works. */
      const READABLE = {
        generic_name: 'Generic Name *',
        brand_name: 'Brand Name',
        strength: 'Strength *',
        mass: 'Mass / Weight',
        mass_unit: 'Mass Unit (mg, g, kg, mcg)',
        dosage_form: 'Dosage Form *',
        manufacturer: 'Manufacturer',
        country: 'Country',
        image_url: 'Medicine Image URL',
        route: 'Route of Administration',
        prescription_type: 'Prescription Type',
        category: 'Category',
        subcategory: 'Subcategory',
        description: 'Description',
        indications: 'Indications',
        contraindications: 'Contraindications',
        side_effects: 'Side Effects',
        warnings: 'Warnings',
        storage_conditions: 'Storage Conditions',
        pronunciation_english: 'English Pronunciation',
        pronunciation_amharic: 'Amharic Pronunciation',
        batch_number: 'Batch Number *',
        expiry_date: 'Expiry Date *',
        quantity: 'Units Received *',
        stock_quantity: 'Units Received *',
        packaging_unit: 'Packaging Unit *',
        units_per_package: 'Single doses per selected unit *',
        buy_price: 'Buy Price *',
        sell_price: 'Sell Price *',
        supplier: 'Supplier *',
        barcode: 'Barcode',
        qr_code: 'QR Code',
        abc_category: 'ABC Category',
        ven_category: 'VEN Category',
      };

      const canonicalKeys = Object.keys(tRows[0]);
      const headers = canonicalKeys.map((k) => READABLE[k] || k);

      const csv = [
        /* Header is always the first row so the same template can be edited
           and uploaded again without losing its column mapping. */
        headers.join(','),
        ...tRows.map((r) => canonicalKeys.map((h) => `"${String(r[h] ?? '')}"`).join(',')),
      ].join('\n');

      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = mode === 'medicine' ? 'medicines-import-template.csv' : 'inventory-import-template.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (_) {
      toast.error('Could not download the template.');
    }
  };

  const revalidateWithServer = async () => {
    if (!rows.length || parsing) return;
    setParsing(true);
    try {
      const response = await medicinesAPI.previewImport(rows.map((row) => row.data), mode);
      const refreshedRows = Array.isArray(response.data) ? response.data : [];
      const previousDecisions = new Map(
        rows.map((row) => [identityKeyForRow(row.data), row.duplicate_action])
      );
      setRows(refreshedRows.map((row) => ({
        ...row,
        duplicate_action: previousDecisions.get(identityKeyForRow(row.data)) || undefined,
      })));
      setResults(null);
      setFilter('ALL');
      setPage(1);
      toast.success?.('Import rows revalidated against the latest database data.');
    } catch (err) {
      toast.error?.(err?.response?.data?.error || 'Could not revalidate the import rows.');
    } finally {
      setParsing(false);
    }
  };

  /* Re-validate the edited row locally (status flips immediately). */
  const updateRow = (rowIndex, field, value) => {
    setRows((prev) => prev.map((r) => {
      if (r.row_index !== rowIndex) return r;
      const data = { ...r.data, [field]: value };
      const { issues, supplierOk } = localValidate(data, suppliers, mode);
      const batchUnchanged = squash(data.batch_number) === squash(r.data.batch_number);
      const status = issues.length > 0 ? 'error' : (!supplierOk ? 'supplier_issue' : (r.duplicate && batchUnchanged ? 'duplicate' : 'ready'));
      return { ...r, data, issues, status };
    }));
  };

  /* Register a missing supplier inline — the user never leaves the import. */
  const openSupplierModal = (name) => {
    setSupplierForm({ name: name || '', contact_person: '', phone: '', address: '', email: '' });
    setSupplierModal(true);
  };

  const saveSupplier = async () => {
    if (!supplierForm.name || supplierForm.name.trim().length < 2) {
      toast.error?.('Supplier name is required.');
      return;
    }
    setSavingSupplier(true);
    try {
      const res = await suppliersAPI.create(supplierForm);
      const created = res.data;
      const refreshed = await suppliersAPI.getAll({ status: 'ACTIVE' });
      const list = Array.isArray(refreshed.data) ? refreshed.data : [];
      setSuppliers(list);
      // Attach the new supplier to every row using that name.
      setRows((prev) => prev.map((r) => {
        if (squash(r.data.supplier) === squash(created.name)) {
          const { issues } = localValidate(r.data, list, mode);
          return { ...r, supplier_id: created.supplier_id, supplier_issue: null, status: issues.length ? 'error' : (r.duplicate ? 'duplicate' : 'ready') };
        }
        return r;
      }));
      invalidateTopic('suppliers');
      toast.success?.(`Supplier "${created.name}" registered.`);
      setSupplierModal(null);
    } catch (err) {
      toast.error?.(err?.response?.data?.error || 'Could not register the supplier.');
    } finally {
      setSavingSupplier(false);
    }
  };

  const confirmImport = () => {
    const importable = (r) => {
      if (r.status !== 'ready' && r.status !== 'duplicate') return false;
      if (r.repeated_in_file) return false;
      // Medicine mode: duplicates are resolved by the user —
      // 'skip' / 'use_existing' are never sent to the server.
      if (mode === 'medicine' && r.status === 'duplicate') return r.duplicate_action === 'import';
      return true;
    };
    const readyRows = rows
      .filter(importable)
      .map((r) => ({ ...r.data, supplier_id: r.supplier_id || undefined }));
    if (!readyRows.length) {
      toast.error?.('No rows are ready. Fix the errors or resolve duplicates/supplier issues first.');
      return;
    }
    guard(() => {
      setImporting(true);
      setProgress(0);
      const timer = setInterval(() => setProgress((p) => Math.min(p + 7, 90)), 250);
      medicinesAPI.confirmImport(readyRows, mode)
        .then((res) => {
          clearInterval(timer);
          setProgress(100);
          setResults(res.data);
          setRows((prev) => prev.filter((r) => r.status === 'error' || r.status === 'supplier_issue'));
          invalidateTopic('medicines');
          invalidateTopic('stock');
          invalidateTopic('inventory');
          toast.success?.(`Imported ${res.data.imported} rows · ${res.data.medicines_created} medicines · ${res.data.batches_created} batches`);
          /* Save to import history */
          const historyEntry = {
            id: Date.now(),
            date: new Date().toISOString(),
            mode,
            imported: res.data.imported || 0,
            medicines_created: res.data.medicines_created || 0,
            batches_created: res.data.batches_created || 0,
            total_rows: readyRows.length,
          };
          setImportHistory(prev => {
            const updated = [historyEntry, ...prev].slice(0, 50);
            localStorage.setItem(IMPORT_HISTORY_KEY, JSON.stringify(updated));
            return updated;
          });
        })
        .catch((err) => {
          clearInterval(timer);
          setProgress(0);
          toast.error?.(
            err?.response?.data?.details || err?.response?.data?.error ||
            'Import failed. Nothing was committed — the database rolled back.'
          );
        })
        .finally(() => setImporting(false));
    });
  };

  const cancelImport = () => {
    if (importing) return;
    setRows([]);
    setResults(null);
    setFilter('ALL');
    setPage(1);
    setExpandedRow(null);
    localStorage.removeItem(DRAFT_KEY);
    toast.info?.('Staged import cancelled. Nothing was changed in the database.');
  };

  /* Derived counts + filtered/paginated view. */
  const counts = useMemo(() => ({
    ALL: rows.length,
    ready: rows.filter((r) => r.status === 'ready').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    error: rows.filter((r) => r.status === 'error').length,
    supplier_issue: rows.filter((r) => r.status === 'supplier_issue').length,
  }), [rows]);

  const visibleRows = useMemo(
    () => (filter === 'ALL' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter]
  );
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const pagedRows = visibleRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  /* Medicine mode: only duplicates explicitly resolved as "Import anyway" count as ready. */
  const readyCount = mode === 'medicine'
    ? counts.ready + rows.filter((r) => r.status === 'duplicate' && r.duplicate_action === 'import').length
    : counts.ready + counts.duplicate;

  const fieldInput = (field, row) => (
    <input
      type={fType(field)}
      className="form-control"
      value={row.data[field] ?? ''}
      onChange={(e) => updateRow(row.row_index, field, e.target.value)}
    />
  );
  const fType = (f) => (f === 'expiry_date' ? 'date' : (['quantity', 'buy_price', 'sell_price', 'mass', 'units_per_package'].includes(f) ? 'number' : 'text'));

  return (
    <div className="import-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Inventory Import</h1>
          <p>
            {mode === 'medicine'
              ? 'Medicine master data — registering a medicine does NOT add stock.'
              : 'Medicines, batches and incoming stock — new batches, restocks and resupply.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div className="view-toggle" role="group" aria-label="Import mode">
            <button
              type="button"
              className={`view-toggle__btn ${mode === 'medicine' ? 'active' : ''}`}
              onClick={() => setMode('medicine')}
              title="Medicine master data (no stock)"
            >
              <Pill size={15} /> <span className="hide-sm">Medicines</span>
            </button>
            <button
              type="button"
              className={`view-toggle__btn ${mode === 'batch' ? 'active' : ''}`}
              onClick={() => setMode('batch')}
              title="New batch / restock existing batch"
            >
              <PackagePlus size={15} /> <span className="hide-sm">Batch / Resupply</span>
            </button>
          </div>
          <button className="btn btn-secondary" onClick={downloadTemplate}>
            <Download size={15} /> <span className="hide-sm">Template</span>
          </button>
        </div>
      </div>

      {!rows.length && (
        <div className="import-hero">
          <div className="import-hero__icon"><PackagePlus size={28} /></div>
          <h2>{mode === 'medicine' ? 'Medicine Import' : 'Batch / Resupply Import'}</h2>
          <p>
            {mode === 'medicine'
              ? 'Register new medicine master data. Duplicates (Generic + Brand + Strength) are detected after normalization — nothing is imported twice by accident.'
              : 'The row decides what happens: medicine found + new batch number → NEW BATCH; medicine found + existing batch → RESTOCK (stock adds up, never a duplicate batch); unknown medicine → NEW MEDICINE + BATCH.'}
          </p>
          <div className="import-hero__buttons">
            <label className="btn btn-primary">
              <Upload size={15} /> Upload CSV
              <input type="file" accept=".csv,text/csv" hidden onChange={handleFile} />
            </label>
            <label className="btn btn-secondary">
              <Upload size={15} /> Upload JSON
              <input type="file" accept=".json,application/json" hidden onChange={handleFile} />
            </label>
            <button className="btn btn-ghost" onClick={downloadTemplate}>
              <Download size={15} /> Download Template
            </button>
          </div>
          {parsing && <div className="import-loading"><Loader2 size={16} className="spin" /> Reading &amp; validating file…</div>}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="import-summary">
            <div className="import-summary__count">
              <strong>{rows.length}</strong> rows staged
              <button className="btn btn-ghost btn-sm" onClick={revalidateWithServer} disabled={parsing}>
                <RefreshCw size={13} className={parsing ? 'spin' : ''} /> Revalidate
              </button>
              <label className="btn btn-secondary btn-sm">
                <Upload size={13} /> New file
                <input type="file" accept=".csv,.json" hidden onChange={handleFile} />
              </label>
            </div>
            <div className="import-filters">
              {[['ALL', `All ${counts.ALL}`], ['ready', `Ready ${counts.ready}`], ['duplicate', `Duplicate ${counts.duplicate}`], ['error', `Missing ${counts.error}`], ['supplier_issue', `Supplier ${counts.supplier_issue}`]].map(([key, label]) => (
                <button key={key} className={`imp-chip ${filter === key ? 'active' : ''}`} onClick={() => { setFilter(key); setPage(1); }}>
                  {label}
                </button>
              ))}
            </div>
            <button className="btn btn-primary" onClick={confirmImport} disabled={importing || readyCount === 0} aria-busy={importing}>
              {importing ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
              Import {readyCount} ready rows
            </button>
            <button type="button" className="btn btn-secondary" onClick={cancelImport} disabled={importing}>
              <XCircle size={15} /> Cancel import
            </button>
          </div>

          {importing && (
            <div className="import-progress">
              <div className="import-progress__bar"><span style={{ width: `${progress}%` }} /></div>
              <small>Importing… committing all rows in one transaction</small>
            </div>
          )}

          {results && (
            <div className="imp-results-card">
              <Check size={16} />
              Imported {results.imported} rows — {results.medicines_created} new medicines, {results.medicines_updated || 0} medicines updated, {results.batches_created} new batches, {results.stock_updated} stock updates, {results.suppliers_created} suppliers registered{results.skipped ? `, ${results.skipped} skipped` : ''}.
            </div>
          )}
        </>
      )}

      <div className="import-rows">
        {pagedRows.map((row) => (
          <div key={row.row_index} className={`import-row ${row.status}`}>
            <button className="import-row__head" onClick={() => setExpandedRow(expandedRow === row.row_index ? null : row.row_index)}>
              {expandedRow === row.row_index ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              <span className="import-row__index">Row {row.row_index + 1}</span>
              <span className="import-row__name">
                {row.data.generic_name || '—'}{row.data.brand_name ? ` (${row.data.brand_name})` : ''} {row.data.strength || ''}
              </span>
              <span className="import-row__decision">
                {actionLabel(row, mode)}
              </span>
              <span className={STATUS_META[row.status]?.cls || 'imp-badge'}>{STATUS_META[row.status]?.label || row.status}</span>
            </button>

            {expandedRow === row.row_index && (
              <div className="import-row__editor">
                {/* Medicine mode: resolve duplicates explicitly — never silently. */}
                {mode === 'medicine' && row.status === 'duplicate' && (
                  <div className="imp-duplicate-bar">
                    <span>Duplicate medicine (Generic + Brand + Strength already exist):</span>
                    <button
                      className={`imp-chip ${!row.duplicate_action || row.duplicate_action === 'skip' ? 'active' : ''}`}
                      onClick={() => setRows((prev) => prev.map((x) => x.row_index === row.row_index ? { ...x, duplicate_action: 'skip' } : x))}
                    >
                      Skip
                    </button>
                    <button
                      className={`imp-chip ${row.duplicate_action === 'use_existing' ? 'active' : ''}`}
                      onClick={() => setRows((prev) => prev.map((x) => x.row_index === row.row_index ? { ...x, duplicate_action: 'use_existing' } : x))}
                    >
                      Use existing medicine
                    </button>
                    <button
                      className={`imp-chip ${row.duplicate_action === 'import' ? 'active' : ''}`}
                      onClick={() => setRows((prev) => prev.map((x) => x.row_index === row.row_index ? { ...x, duplicate_action: 'import' } : x))}
                    >
                      Import anyway (edit identity below)
                    </button>
                  </div>
                )}
                <div className="form-grid">
                  {(mode === 'medicine'
                    ? ['generic_name', 'brand_name', 'strength', 'mass', 'mass_unit', 'dosage_form', 'route', 'manufacturer', 'country', 'image_url', 'category', 'subcategory', 'description', 'indications', 'contraindications', 'side_effects', 'warnings', 'storage_conditions', 'pronunciation_english', 'pronunciation_amharic']
                    : ['generic_name', 'brand_name', 'strength', 'batch_number', 'expiry_date', 'packaging_unit', 'units_per_package', 'quantity', 'buy_price', 'sell_price', 'supplier', 'barcode', 'qr_code', 'abc_category', 'ven_category']
                  ).map((f) => (
                    <div className="form-group" key={f}>
                      <label>
                        {f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                        {row.issues?.some((i) => i.field === f) && (
                          <em className="imp-field-error">{row.issues.find((i) => i.field === f).message}</em>
                        )}
                      </label>
                      {f === 'supplier' ? (
                        <select
                          className="form-control"
                          value={row.supplier_id || ''}
                          onChange={(e) => {
                            const s = suppliers.find((x) => String(x.supplier_id) === e.target.value);
                            updateRow(row.row_index, 'supplier', s ? s.name : row.data.supplier);
                          }}
                        >
                          <option value="">{row.data.supplier || '— Choose Supplier —'}</option>
                          {suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
                        </select>
                      ) : f === 'dosage_form' ? (
                        <select
                          className="form-control"
                          value={row.data.dosage_form || ''}
                          onChange={(e) => updateRow(row.row_index, 'dosage_form', e.target.value)}
                        >
                          <option value="">— Select —</option>
                          {['Solid', 'Liquid', 'Semi-solid', 'Other'].map((form) => <option key={form} value={form}>{form}</option>)}
                        </select>
                      ) : f === 'packaging_unit' ? (
                        <select
                          className="form-control"
                          value={row.data.packaging_unit || ''}
                          onChange={(e) => updateRow(row.row_index, 'packaging_unit', e.target.value)}
                        >
                          <option value="">— Select —</option>
                          <option value="SINGLE_DOSE">Single Dose (bottle, tube, puff, unit)</option>
                          <option value="STRIP">Strip</option>
                          <option value="INNER_BOX">Inner Box</option>
                          <option value="OUTER_BOX">Outer Box</option>
                        </select>
                      ) : f === 'abc_category' ? (
                        <select
                          className="form-control"
                          value={row.data.abc_category || ''}
                          onChange={(e) => updateRow(row.row_index, 'abc_category', e.target.value)}
                        >
                          <option value="">— Select —</option>
                          <option value="A">A - High Value</option>
                          <option value="B">B - Medium Value</option>
                          <option value="C">C - Low Value</option>
                        </select>
                      ) : f === 'ven_category' ? (
                        <select
                          className="form-control"
                          value={row.data.ven_category || ''}
                          onChange={(e) => updateRow(row.row_index, 'ven_category', e.target.value)}
                        >
                          <option value="">— Select —</option>
                          <option value="V">V - Vital</option>
                          <option value="E">E - Essential</option>
                          <option value="N">N - Non-Essential</option>
                        </select>
                      ) : fieldInput(f, row)}
                    </div>
                  ))}
                </div>
                {row.supplier_issue && (
                  <button className="btn btn-secondary btn-sm" onClick={() => openSupplierModal(row.supplier_issue)}>
                    <Building2 size={14} /> Register Supplier “{row.supplier_issue}”
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {rows.length > 0 && pageCount > 1 && (
        <div className="import-pagination">
          <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Previous</button>
          <span>Page {page} / {pageCount} · {visibleRows.length} shown</span>
          <button className="btn btn-ghost btn-sm" disabled={page === pageCount} onClick={() => setPage((p) => p + 1)}>Next →</button>
        </div>
      )}

      {/* ── IMPORT HISTORY SECTION ── */}
      <div className="import-history-section">
        <div className="import-history-header" onClick={() => setShowHistory(!showHistory)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={18} />
            <h3>Import History</h3>
            <span className="import-history-count">{importHistory.length} record{importHistory.length === 1 ? '' : 's'}</span>
          </div>
          <button className="btn btn-ghost btn-sm">
            {showHistory ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
        {showHistory && (
          <div className="import-history-content">
            {importHistory.length === 0 ? (
              <p className="import-history-empty">No import history yet. Completed imports will appear here.</p>
            ) : (
              <div className="import-history-table-wrapper">
                <table className="custom-table import-history-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Mode</th>
                      <th>Rows Imported</th>
                      <th>Medicines</th>
                      <th>Batches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importHistory.map(entry => (
                      <tr key={entry.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{new Date(entry.date).toLocaleString()}</td>
                        <td>
                          <span className={`imp-badge ${entry.mode === 'medicine' ? 'ready' : 'duplicate'}`}>
                            {entry.mode === 'medicine' ? 'Medicine' : 'Batch'}
                          </span>
                        </td>
                        <td>{entry.imported}</td>
                        <td>{entry.medicines_created}</td>
                        <td>{entry.batches_created}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {importHistory.length > 0 && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: '0.75rem' }}
                onClick={() => {
                  setImportHistory([]);
                  localStorage.removeItem(IMPORT_HISTORY_KEY);
                  toast.success('Import history cleared');
                }}
              >
                Clear History
              </button>
            )}
          </div>
        )}
      </div>

      {supplierModal && (
        <div className="modal-overlay" onClick={() => setSupplierModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h3>Register Supplier</h3>
            <div className="form-group">
              <label>Supplier Name *</label>
              <input className="form-control" value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} />
            </div>
            <div className="form-group"><label>Contact Person</label><input className="form-control" value={supplierForm.contact_person} onChange={(e) => setSupplierForm({ ...supplierForm, contact_person: e.target.value })} /></div>
            <div className="form-group"><label>Phone</label><input className="form-control" value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} /></div>
            <div className="form-group"><label>Address</label><input className="form-control" value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} /></div>
            <div className="form-group"><label>Email</label><input className="form-control" type="email" value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} /></div>
            <div className="confirm-actions">
              <button className="btn btn-secondary" onClick={() => setSupplierModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveSupplier} disabled={savingSupplier}>
                {savingSupplier ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Save Supplier
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};