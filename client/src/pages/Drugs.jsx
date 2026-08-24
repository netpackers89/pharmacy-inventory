import React, { useState, useEffect, useMemo } from 'react';
import './Drugs.css';
import { Plus, Sparkles, Edit, Search, Check, Download, Pill as PillIcon, PackagePlus, Loader2 } from 'lucide-react';
import { medicinesAPI, suppliersAPI, aiAPI, categoriesAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useGuestGuard } from '../hooks/useGuestGuard';
import { downloadCsv } from '../utils/csv';
import { TableSkeleton, EmptyState, ErrorState } from '../components/Feedback';

const PAGE_SIZE = 10;

export const Drugs = ({ onOpenPOS, prefillCode, onConsumePrefill }) => {
  const { user, isGuest } = useAuth();
  const { toast } = useToast();
  const guard = useGuestGuard();

  const [medicines, setMedicines] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [subcategories, setSubcategories] = useState([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editId, setEditId] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNotice, setAiNotice] = useState(null);
  const [savingMedicine, setSavingMedicine] = useState(false);
  const [addInitialStock, setAddInitialStock] = useState(false);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importResults, setImportResults] = useState(null);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target.result;
      const lines = text.split('\n').filter(l => l.trim() !== '');
      if (lines.length < 2) return;
      const headers = lines[0].split(',').map(h => h.trim());
      const data = lines.slice(1).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((h, i) => obj[h] = values[i]?.trim());
        return obj;
      });

      setImportLoading(true);
      try {
        const res = await medicinesAPI.previewImport(data);
        setImportPreview(res.data);
      } catch (err) {
        toast.error('Unable to preview the import file.');
      }
      setImportLoading(false);
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async () => {
    setImportLoading(true);
    try {
      const res = await medicinesAPI.confirmImport(importPreview);
      setImportResults(res.data);
      fetchMedicines();
    } catch (err) {
      toast.error('Import failed. Please check the file and try again.');
    }
    setImportLoading(false);
  };

  const closeImportModal = () => {
    setIsImportModalOpen(false);
    setImportPreview(null);
    setImportResults(null);
  };

  /* Debounce the search box → avoids a request per keystroke */
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const initialForm = {
    generic_name: '',
    brand_name: '',
    strength: '',
    dosage_form: 'Tablet',
    manufacturer: '',
    country: '',
    route: 'Oral',
    prescription_type: 'OTC',
    category_id: '',
    sub_category_id: '',
    description: '',
    indications: '',
    contraindications: '',
    side_effects: '',
    warnings: '',
    storage_conditions: '',
    initial_stock: {
      supplier_id: '',
      batch_number: '',
      expiry_date: '',
      quantity: '',
      buy_price: '',
      sell_price: '',
      barcode: '',
      qr_code: '',
      abc_category: '',
      ven_category: '',
      user_id: user?.id || 1
    }
  };

  const [formData, setFormData] = useState(initialForm);

  /*
   * Medicine list fetching with race-condition protection:
   * only the LATEST request may update state; earlier responses
   * (e.g. a slow stale search) are discarded.
   */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);

    medicinesAPI.getAll({ search: searchQuery })
      .then(res => {
        if (cancelled) return;
        const rows = res.data;
        // Guard against non-array payloads so rendering never crashes.
        setMedicines(Array.isArray(rows) ? rows : []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        if (!cancelled) {
          setLoadError(true);
          setMedicines([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [searchQuery]);

  useEffect(() => {
    // Operational dropdowns: ACTIVE suppliers and ACTIVE categories only.
    // (Inactive master records must not be selectable for new transactions;
    // historical records keep their real references in the database.)
    suppliersAPI.getAll({ status: 'ACTIVE' }).then(res => setSuppliers(Array.isArray(res.data) ? res.data : [])).catch(() => {});
    // getActive returns ACTIVE categories each containing ONLY their ACTIVE
    // subcategories — the composite availability rule is enforced server-side.
    categoriesAPI.getActive().then(res => setCategories(Array.isArray(res.data) ? res.data : [])).catch(() => {});
  }, []);

  /*
   * Edit-mode safeguard: if a medicine's existing category/subcategory is
   * inactive, keep it visible (labelled) so saving an unrelated edit does not
   * silently erase the historical classification. New records can only pick
   * active options.
   */
  const categoriesForForm = useMemo(() => {
    const list = [...categories];
    const assignedId = formData.category_id ? Number(formData.category_id) : null;
    if (
      isEditMode &&
      assignedId &&
      !list.some((c) => c.category_id === assignedId)
    ) {
      list.push({
        category_id: assignedId,
        name: `${formData._assignedCategoryName || `Category #${assignedId}`} (inactive — historical)`,
        sub_categories: [],
        _historical: true,
      });
    }
    return list;
  }, [categories, formData.category_id, formData._assignedCategoryName, isEditMode]);

  const fetchMedicines = () => {
    setLoading(true);
    medicinesAPI.getAll({ search: searchQuery })
      .then(res => {
        setMedicines(Array.isArray(res.data) ? res.data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  // When category changes, filter subcategories
  useEffect(() => {
    if (formData.category_id) {
      const cat = categories.find(c => c.category_id == formData.category_id);
      setSubcategories(cat?.sub_categories || []);
      setFormData(prev => ({ ...prev, sub_category_id: '' }));
    } else {
      setSubcategories([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.category_id, categories]);

  /*
   * Scanner hand-off: an unregistered scanned code opens the
   * registration modal with the code pre-filled in the batch barcode.
   */
  useEffect(() => {
    if (!prefillCode) return;
    // Guests are read-only — registration is a staff action.
    if (isGuest) {
      toast.warning('This code is not registered. Sign in with a pharmacy account to register this medicine.');
      if (onConsumePrefill) onConsumePrefill();
      return;
    }
    setFormData(prev => ({
      ...initialForm,
      generic_name: prev.generic_name,
      initial_stock: {
        ...initialForm.initial_stock,
        barcode: prefillCode,
        qr_code: prefillCode,
      },
    }));
    setAddInitialStock(true);
    setIsEditMode(false);
    setEditId(null);
    setIsModalOpen(true);
    if (onConsumePrefill) onConsumePrefill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillCode, isGuest]);

  /*
   * AI autofill: suggestions are populated into the form for review.
   * The response is labelled (Gemini vs local template) and NEVER silently
   * overwrites fields the user has already filled in.
   */
  const handleAiAutofill = async () => {
    const term = formData.generic_name || formData.brand_name;
    if (!term) { toast.warning('Please enter Generic Name or Brand Name first!'); return; }
    setAiLoading(true);
    setAiNotice(null);
    try {
      const res = await aiAPI.autofill(term, formData.dosage_form);
      const data = res.data || {};
      // Merge only into EMPTY fields — never overwrite user-entered info.
      setFormData(prev => ({
        ...prev,
        description: prev.description || data.description || '',
        indications: prev.indications || data.indication || '',
        contraindications: prev.contraindications || data.contraindication || '',
        side_effects: prev.side_effects || data.side_effects || '',
        warnings: prev.warnings || data.interactions || '',
        storage_conditions: prev.storage_conditions || data.storage_condition_patient || ''
      }));

      if (data.ai_available === false) {
        setAiNotice(
          (data.fallback_reason || 'AI autofill is temporarily unavailable.') +
          ' A generic safety template was used instead — please fill in the clinical details manually.'
        );
      } else if (data.source === 'GOOGLE_GEMINI') {
        setAiNotice('AI-assisted information generated. Verify before saving or clinical use.');
      }
    } catch (err) {
      const msg = err.response?.status === 503
        ? 'AI autofill is temporarily unavailable. Please continue filling the form manually.'
        : err.response?.data?.error || 'AI autofill failed. You can continue manually.';
      setAiNotice(msg);
    } finally { setAiLoading(false); }
  };

  const handleOpenAddModal = () => {
    setFormData(initialForm);
    setAddInitialStock(false);
    setIsEditMode(false);
    setEditId(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (med) => {
    setFormData({
      generic_name: med.generic_name || '',
      brand_name: med.brand_name || '',
      strength: med.strength || '',
      dosage_form: med.dosage_form || 'Tablet',
      manufacturer: med.manufacturer || '',
      country: med.country || '',
      route: med.route || 'Oral',
      prescription_type: med.prescription_type || 'OTC',
      category_id: med.category_id || '',
      sub_category_id: med.sub_category_id || '',
      _assignedCategoryName: med.category_name || '',
      description: med.description || '',
      indications: med.indications || '',
      contraindications: med.contraindications || '',
      side_effects: med.side_effects || '',
      warnings: med.warnings || '',
      storage_conditions: med.storage_conditions || '',
      initial_stock: { supplier_id: '', batch_number: '', expiry_date: '', quantity: '', buy_price: '', sell_price: '', barcode: '', qr_code: '', abc_category: '', ven_category: '', user_id: user?.id || 1 }
    });
    setAddInitialStock(false);
    setIsEditMode(true);
    setEditId(med.medicine_id);
    setIsModalOpen(true);
  };

  const handleSubmitForm = async (e) => {
    e.preventDefault();
    if (savingMedicine) return; // duplicate-submission guard

    // Frontend validation mirrors backend rules.
    if (!formData.generic_name.trim() || !formData.strength.trim()) {
      toast.warning('Generic name and strength are required.');
      return;
    }

    setSavingMedicine(true);
    try {
      const payload = { ...formData };
      payload.category_id = formData.category_id || null;
      payload.sub_category_id = formData.sub_category_id || null;

      if (isEditMode) {
        delete payload.initial_stock;
        await medicinesAPI.update(editId, payload);
        toast.success('Drug updated successfully.');
      } else {
        if (!addInitialStock) {
          delete payload.initial_stock;
        } else {
          payload.initial_stock.user_id = user?.id || 1;
        }
        await medicinesAPI.create(payload);
        toast.success('Drug registered successfully.');
      }
      setIsModalOpen(false);
      fetchMedicines();
    } catch (err) {
      // Keep the form open with values intact; show what went wrong.
      toast.error('Unable to save drug: ' + (err.response?.data?.details || err.response?.data?.error || err.message));
    } finally {
      setSavingMedicine(false);
    }
  };

  /* Client-side pagination over the filtered list */
  const totalPages = Math.max(1, Math.ceil(medicines.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedMedicines = useMemo(
    () => medicines.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [medicines, safePage]
  );

  const handleExport = () => downloadCsv({
    rows: medicines,
    columns: [
      { key: 'generic_name', label: 'Generic Name' },
      { key: 'brand_name', label: 'Brand Name' },
      { key: 'strength', label: 'Strength' },
      { key: 'dosage_form', label: 'Dosage Form' },
      { key: 'manufacturer', label: 'Manufacturer' },
      { key: 'prescription_type', label: 'Prescription Type' },
      { key: 'category_name', label: 'Category' },
      { key: 'stock_on_hand', label: 'Stock On Hand' },
      { key: 'status', label: 'Status' },
    ],
    dataset: 'medicine-list',
    notify: toast,
  });

  const dosageForms = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Cream', 'Ointment', 'Drops', 'Inhaler', 'Suppository', 'Powder', 'Patch'];
  const routes = ['Oral', 'IV', 'IM', 'Subcutaneous', 'Topical', 'Inhalation', 'Sublingual', 'Rectal', 'Ophthalmic', 'Otic'];

  return (
    <div className="drugs-page">
      {/* ── Page header stays fixed; only the table scrolls horizontally ── */}
      <div className="page-header">
        <div className="page-title-group">
          <h1>Medicines</h1>
          <p>Permanent master records for every medicine in the pharmacy</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => guard(() => setIsImportModalOpen(true))}>
            <Download size={15} />
            <span className="hide-sm">Import</span>
          </button>
          <button className="btn btn-primary" onClick={() => guard(handleOpenAddModal)}>
            <PackagePlus size={16} />
            Add New Drug
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <div className="smart-search-input-wrap" style={{ maxWidth: '380px' }}>
          <Search size={15} />
          <input
            type="text"
            placeholder="Search drugs by name…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search drugs"
          />
        </div>
      </div>

      <div className="table-container">
        {loading ? (
          <TableSkeleton rows={8} cols={[26, 18, 16, 12, 12, 12]} />
        ) : loadError ? (
          <ErrorState
            title="Unable to load medicines"
            description="Something went wrong while retrieving the medicine list."
            onRetry={fetchMedicines}
          />
        ) : medicines.length === 0 ? (
          <EmptyState
            icon={<PillIcon size={26} />}
            title={searchQuery ? 'No medicines match your search' : 'No drugs registered yet'}
            description={searchQuery ? 'Try changing your search or filters.' : 'Register your first medicine to start building the directory.'}
            actionLabel={searchQuery ? 'Clear Filters' : undefined}
            onAction={searchQuery ? () => setSearchInput('') : undefined}
          />
        ) : (
          <>
            {/* Desktop / tablet table */}
            <div className="table-scroll-wrap hide-mobile-table">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Drug Name</th><th>Strength / Form</th><th>Category</th>
                    <th>Stock</th><th>Type</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedMedicines.map((med) => (
                    <tr key={med.medicine_id}>
                      <td>
                        <strong className="td-strong">{med.generic_name}</strong>
                        {med.brand_name && <small className="muted-line">{med.brand_name}</small>}
                      </td>
                      <td>{med.strength} · {med.dosage_form}</td>
                      <td><span className="badge badge-primary">{med.category_name || 'Uncategorized'}</span></td>
                      <td>
                        <span className={`badge ${parseInt(med.stock_on_hand) === 0 ? 'badge-danger' : parseInt(med.stock_on_hand) < 10 ? 'badge-warning' : 'badge-secondary'}`}>
                          {med.stock_on_hand || 0}
                        </span>
                      </td>
                      <td><span className="badge badge-neutral">{med.prescription_type}</span></td>
                      <td>
                        <span className={`badge ${med.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>{med.status}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => guard(() => handleOpenEditModal(med))}>
                          <Edit size={13} /> Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="mobile-card-list show-mobile-table">
              {pagedMedicines.map((med) => (
                <div key={med.medicine_id} className="mobile-card stagger-item">
                  <div className="mobile-card-head">
                    <strong>{med.generic_name}{med.brand_name ? ` (${med.brand_name})` : ''}</strong>
                    <span className={`badge ${parseInt(med.stock_on_hand) === 0 ? 'badge-danger' : parseInt(med.stock_on_hand) < 10 ? 'badge-warning' : 'badge-secondary'}`}>
                      {med.stock_on_hand || 0}
                    </span>
                  </div>
                  <div className="mobile-card-meta">
                    <span>{med.strength} · {med.dosage_form}</span>
                    <span className={`badge ${med.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>{med.status}</span>
                  </div>
                  <div className="mobile-card-meta">
                    <span className="badge badge-neutral">{med.prescription_type}</span>
                    <span className="badge badge-primary">{med.category_name || 'Uncategorized'}</span>
                  </div>
                  <div className="mobile-card-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => guard(() => handleOpenEditModal(med))}>
                      <Edit size={13} /> Edit Drug
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="table-footer">
              <span>
                {medicines.length} medicine{medicines.length === 1 ? '' : 's'} · page {safePage} of {totalPages}
              </span>
              <div className="pagination">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}>‹ Prev</button>
                {Array.from({ length: totalPages }).slice(0, 7).map((_, i) => (
                  <button key={i} className={safePage === i + 1 ? 'active' : ''} onClick={() => setPage(i + 1)}>
                    {i + 1}
                  </button>
                ))}
                {totalPages > 7 && <span style={{ padding: '0 4px', alignSelf: 'center' }}>…</span>}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>Next ›</button>
              </div>
              <button className="btn btn-ghost" onClick={handleExport}>
                <Download size={15} /> Export CSV
              </button>
            </div>
          </>
        )}
      </div>


      {/* ── IMPORT MODAL ── */}
      {isImportModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h2>Import Medicines</h2>
              <button className="modal-close-btn" onClick={closeImportModal}>×</button>
            </div>
            {!importPreview && !importResults && (
              <div className="import-dropzone dot-grid">
                <p>Upload CSV File</p>
                <input type="file" accept=".csv" onChange={handleFileUpload} aria-label="CSV file" />
              </div>
            )}
            {importLoading && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading preview…</div>
            )}
            {importPreview && !importResults && !importLoading && (
              <div>
                <div className="table-scroll-wrap">
                  <table className="custom-table" style={{ minWidth: 480 }}>
                    <thead>
                      <tr><th>Row</th><th>Medicine</th><th>Batch</th><th>Qty</th><th>Decision</th></tr>
                    </thead>
                    <tbody>
                      {importPreview.map((row, i) => (
                        <tr key={i}>
                          <td>{row.Row || i+1}</td>
                          <td className="cell-truncate">{row.Medicine}</td>
                          <td>{row.Batch}</td>
                          <td>{row.Qty}</td>
                          <td><small className="muted-line">{row.Decision}</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="confirm-actions" style={{ marginTop: '1.25rem' }}>
                  <button className="btn btn-primary" onClick={handleConfirmImport}>Confirm Import</button>
                </div>
              </div>
            )}
            {importResults && (
              <div className="empty-state">
                <div className="empty-state__icon" style={{ color: 'var(--success)', borderColor: 'var(--success-border)' }}>
                  <Check size={26} />
                </div>
                <div className="empty-state__title">Import Successful</div>
                <div className="empty-state__desc">{importResults.message || 'Records imported.'}</div>
                <div className="empty-state__action">
                  <button className="btn btn-secondary" onClick={closeImportModal}>Close</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ADD / EDIT MODAL ── */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '820px' }}>
            <div className="modal-header">
              <h2>{isEditMode ? 'Edit Drug' : 'Register New Drug'}</h2>
              <button type="button" className="modal-close-btn" onClick={() => !savingMedicine && setIsModalOpen(false)} disabled={savingMedicine} aria-label="Close">×</button>
            </div>

            <form onSubmit={handleSubmitForm}>
              {/* SECTION A – Basic Info */}
              <div className="drug-section">
                <h3 className="drug-section-title">Section A — Basic Drug Information</h3>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Generic Name *</label>
                    <input required type="text" className="form-control" value={formData.generic_name}
                      onChange={e => setFormData({ ...formData, generic_name: e.target.value })} placeholder="e.g. Paracetamol" />
                  </div>
                  <div className="form-group">
                    <label>Brand Name</label>
                    <input type="text" className="form-control" value={formData.brand_name}
                      onChange={e => setFormData({ ...formData, brand_name: e.target.value })} placeholder="e.g. Panadol" />
                  </div>
                  <div className="form-group">
                    <label>Strength *</label>
                    <input required type="text" className="form-control" placeholder="e.g. 500 mg" value={formData.strength}
                      onChange={e => setFormData({ ...formData, strength: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Dosage Form *</label>
                    <select required className="form-control" value={formData.dosage_form}
                      onChange={e => setFormData({ ...formData, dosage_form: e.target.value })}>
                      {dosageForms.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Manufacturer</label>
                    <input type="text" className="form-control" value={formData.manufacturer}
                      onChange={e => setFormData({ ...formData, manufacturer: e.target.value })} placeholder="e.g. GSK" />
                  </div>
                  <div className="form-group">
                    <label>Country</label>
                    <input type="text" className="form-control" value={formData.country}
                      onChange={e => setFormData({ ...formData, country: e.target.value })} placeholder="e.g. Ethiopia" />
                  </div>
                  <div className="form-group">
                    <label>Route of Administration</label>
                    <select className="form-control" value={formData.route}
                      onChange={e => setFormData({ ...formData, route: e.target.value })}>
                      {routes.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Prescription Type</label>
                    <select className="form-control" value={formData.prescription_type}
                      onChange={e => setFormData({ ...formData, prescription_type: e.target.value })}>
                      <option value="OTC">OTC (Over-the-counter)</option>
                      <option value="PRESCRIPTION">PRESCRIPTION</option>
                      <option value="CONTROLLED">CONTROLLED</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Category</label>
                    <select className="form-control" value={formData.category_id}
                      onChange={e => setFormData({ ...formData, category_id: e.target.value })}>
                      <option value="">— No Category —</option>
                      {categoriesForForm.map(c => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Subcategory</label>
                    <select className="form-control" value={formData.sub_category_id}
                      onChange={e => setFormData({ ...formData, sub_category_id: e.target.value })}
                      disabled={!formData.category_id}>
                      <option value="">— No Subcategory —</option>
                      {subcategories.map(s => <option key={s.sub_category_id} value={s.sub_category_id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* SECTION B – Clinical Info */}
              <div className="drug-section tinted">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h3 className="drug-section-title" style={{ margin: 0, borderBottom: 'none', paddingBottom: 0 }}>
                      Section B — Clinical Information
                    </h3>
                    <span className="form-hint">AI-assisted information — verify before saving/clinical use.</span>
                  </div>
                  <button type="button" onClick={handleAiAutofill} disabled={aiLoading} className="btn btn-secondary btn-sm">
                    <Sparkles size={14} /> {aiLoading ? 'Generating…' : 'Generate with AI'}
                  </button>
                </div>
                {aiNotice && (
                  <div className="auth-alert auth-alert--info" role="note" style={{ marginBottom: '1rem' }}>{aiNotice}</div>
                )}
                <div className="form-grid">
                  <div className="form-group full-width">
                    <label>Description</label>
                    <textarea rows="2" className="form-control" value={formData.description}
                      onChange={e => setFormData({ ...formData, description: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Indications (What it treats)</label>
                    <input type="text" className="form-control" value={formData.indications}
                      onChange={e => setFormData({ ...formData, indications: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Contraindications</label>
                    <input type="text" className="form-control" value={formData.contraindications}
                      onChange={e => setFormData({ ...formData, contraindications: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Side Effects</label>
                    <input type="text" className="form-control" value={formData.side_effects}
                      onChange={e => setFormData({ ...formData, side_effects: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Warnings</label>
                    <input type="text" className="form-control" value={formData.warnings}
                      onChange={e => setFormData({ ...formData, warnings: e.target.value })} />
                  </div>
                  <div className="form-group full-width">
                    <label>Storage Conditions</label>
                    <input type="text" className="form-control" value={formData.storage_conditions}
                      onChange={e => setFormData({ ...formData, storage_conditions: e.target.value })} />
                  </div>
                </div>
              </div>

              {/* SECTION C – Initial Stock (Add only) */}
              {!isEditMode && (
                <div className="drug-section outlined">
                  <h3 className="drug-section-title">Section C — Initial Stock</h3>
                  <p className="form-hint" style={{ marginBottom: '0.9rem' }}>
                    Do you have stock for this drug right now?
                  </p>
                  <div className="stock-choice-row">
                    <button type="button" onClick={() => setAddInitialStock(true)}
                      className={`choice-btn ${addInitialStock ? 'selected' : ''}`}>
                      Yes, Add Initial Stock
                    </button>
                    <button type="button" onClick={() => setAddInitialStock(false)}
                      className={`choice-btn ${!addInitialStock ? 'selected' : ''}`}>
                      No, Register Drug Only
                    </button>
                  </div>

                  {addInitialStock && (
                    <div className="initial-stock-panel fade-in">
                      <div className="form-grid">
                        <div className="form-group">
                          <label>Supplier *</label>
                          <select required className="form-control" value={formData.initial_stock.supplier_id}
                            onChange={e => setFormData({ ...formData, initial_stock: { ...formData.initial_stock, supplier_id: e.target.value } })}>
                            <option value="">— Select Supplier —</option>
                            {suppliers.map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Batch Number *</label>
                          <input required type="text" className="form-control" value={formData.initial_stock.batch_number}
                            onChange={e => setFormData({ ...formData, initial_stock: { ...formData.initial_stock, batch_number: e.target.value } })} />
                        </div>
                        <div className="form-group">
                          <label>Expiry Date *</label>
                          <input required type="date" className="form-control" value={formData.initial_stock.expiry_date}
                            onChange={e => setFormData({ ...formData, initial_stock: { ...formData.initial_stock, expiry_date: e.target.value } })} />
                        </div>
                        <div className="form-group">
                          <label>Quantity *</label>
                          <input required type="number" min="1" className="form-control" value={formData.initial_stock.quantity}
                            onChange={e => setFormData({ ...formData, initial_stock: { ...formData.initial_stock, quantity: e.target.value } })} />
                        </div>
                        <div className="form-group">
                          <label>Barcode</label>
                          <input type="text" className="form-control" value={formData.initial_stock.barcode}
                            onChange={e => setFormData({ ...formData, initial_stock: { ...formData.initial_stock, barcode: e.target.value } })}
                            placeholder="Scanned codes land here" />
                        </div>
                        <div className="form-group">
                          <label>QR Code</label>
                          <input type="text" className="form-control" value={formData.initial_stock.qr_code}
                            onChange={e => setFormData({ ...formData, initial_stock: { ...formData.initial_stock, qr_code: e.target.value } })} />
                        </div>
                        <div className="form-group">
                          <label>ABC Category</label>
                          <select className="form-control" value={formData.initial_stock.abc_category}
                            onChange={e => setFormData({ ...formData, initial_stock: { ...formData.initial_stock, abc_category: e.target.value } })}>
                            <option value="">— Select —</option>
                            <option value="A">A</option>
                            <option value="B">B</option>
                            <option value="C">C</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>VEN Category</label>
                          <select className="form-control" value={formData.initial_stock.ven_category}
                            onChange={e => setFormData({ ...formData, initial_stock: { ...formData.initial_stock, ven_category: e.target.value } })}>
                            <option value="">— Select —</option>
                            <option value="V">V</option>
                            <option value="E">E</option>
                            <option value="N">N</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Buy Price (ETB) *</label>
                          <input required type="number" step="0.01" min="0" className="form-control" value={formData.initial_stock.buy_price}
                            onChange={e => {
                              const bp = parseFloat(e.target.value) || 0;
                              setFormData({ ...formData, initial_stock: { ...formData.initial_stock, buy_price: e.target.value, sell_price: (bp * 1.25).toFixed(2) } });
                            }} />
                        </div>
                        <div className="form-group">
                          <label>Sell Price (Auto +25%)</label>
                          <input type="number" step="0.01" min="0" className="form-control" value={formData.initial_stock.sell_price}
                            onChange={e => setFormData({ ...formData, initial_stock: { ...formData.initial_stock, sell_price: e.target.value } })} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="confirm-actions" style={{ marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => !savingMedicine && setIsModalOpen(false)} disabled={savingMedicine}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingMedicine} aria-busy={savingMedicine}>
                  {savingMedicine ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                  {savingMedicine
                    ? (isEditMode ? 'Saving Changes…' : 'Registering Drug…')
                    : (isEditMode ? 'Save Changes' : (addInitialStock ? 'Register Drug & Stock' : 'Register Drug'))}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
