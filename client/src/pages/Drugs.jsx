import React, { useState, useEffect, useMemo, useRef } from 'react';
import './Drugs.css';
import { Plus, Sparkles, Edit, Search, Check, Download, Pill as PillIcon, Loader2, BookOpen, LayoutGrid, List as ListIcon, Trash2, Filter, MoreVertical, Eye, ShoppingCart, Power, PowerOff, PackagePlus } from 'lucide-react';
import { medicinesAPI, suppliersAPI, aiAPI, categoriesAPI } from '../services/api';
import { MedicineLearnModal } from '../components/MedicineLearnModal';
import { MedicineDeleteModal } from '../components/MedicineDeleteModal';
import { MedicineImage } from '../components/MedicineImage';
import { PronunciationSpeaker } from '../components/PronunciationSpeaker';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useGuestGuard } from '../hooks/useGuestGuard';
import { downloadCsv } from '../utils/csv';
import { getStockStatus, fmtExpiry } from '../utils/stockStatus';
import { TableSkeleton, EmptyState, ErrorState } from '../components/Feedback';
import { Pagination } from '../components/ui';
import { socket } from '../services/socket';

const VIEW_PREF_KEY = 'pharm_drug_view';
const DOSAGE_FORMS = ['Solid', 'Liquid', 'Semi-solid', 'Other'];
const normalizeDosageForm = (value) => {
  const form = String(value || '').toLowerCase();
  if (/tablet|capsule|powder|patch|lozenge/.test(form)) return 'Solid';
  if (/syrup|solution|suspension|drops|spray/.test(form)) return 'Liquid';
  if (/cream|ointment|gel|lotion/.test(form)) return 'Semi-solid';
  return 'Other';
};

/*
 * Three-dot action menu used on medicine cards. Stops the card's own
 * click (which opens details) and closes on outside click / Escape.
 */
const CardMenu = ({ items }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="medicine-card__menu" ref={ref}>
      <button
        type="button"
        className="medicine-card__menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        title="More actions"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        <MoreVertical size={15} />
      </button>
      {open && (
        <div className="medicine-card__menu-pop" role="menu" onClick={(e) => e.stopPropagation()}>
          {items.filter(Boolean).map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={it.danger ? 'is-danger' : ''}
              onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick(); }}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const Drugs = ({ onOpenPOS, prefillCode, onConsumePrefill, onNavigateImport, editMedicineId, onConsumeEditMedicine }) => {
  const { user, isGuest } = useAuth();
  const isAdmin = String(user?.role || '').toUpperCase() === 'ADMIN';
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
  const [liveTick, setLiveTick] = useState(0);
  const [limit, setLimit] = useState(18);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState('generic_name');
  const [sortOrder, setSortOrder] = useState('asc');

  /* Card / table view preference persists per browser. */
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(VIEW_PREF_KEY) || 'cards');
  useEffect(() => { localStorage.setItem(VIEW_PREF_KEY, viewMode); }, [viewMode]);

  /* Server-side filters (combined: category + subcategory + route + rx + status) */
  const [filters, setFilters] = useState({ category_id: '', sub_category_id: '', dosage_form: '', route: '', prescription_type: '', status: '' });
  const dosageForms = DOSAGE_FORMS;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editId, setEditId] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNotice, setAiNotice] = useState(null);
  const [savingMedicine, setSavingMedicine] = useState(false);
  const [addInitialStock, setAddInitialStock] = useState(false);

  /* Extra filters popover toggle (category, subcategory, dosage, route, rx) */
  const [filtersOpen, setFiltersOpen] = useState(false);

  /* Medicine learning card (Learn More) */
  const [learnMedId, setLearnMedId] = useState(null);

  /* Permanent-delete flow (type-to-confirm modal). The actual delete is a
   * server-side safe transaction that blocks medicines with history. */
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  /* Debounce the search box → avoids a request per keystroke */
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filterParams = useMemo(() => {
    const p = {};
    if (searchQuery) p.search = searchQuery;
    if (filters.category_id) p.category_id = filters.category_id;
    if (filters.sub_category_id) p.sub_category_id = filters.sub_category_id;
      if (filters.dosage_form) p.dosage_form = filters.dosage_form;
    if (filters.route) p.route = filters.route;
    if (filters.prescription_type) p.prescription_type = filters.prescription_type;
    if (filters.status) p.status = filters.status;
    return p;
  }, [searchQuery, filters]);

  useEffect(() => {
    if (!socket.connected) socket.connect();
    const refresh = ({ topic } = {}) => {
      if (['medicines', 'stock', 'sales', 'inventory', 'general'].includes(topic)) setLiveTick((tick) => tick + 1);
    };
    socket.on('data_updated', refresh);
    return () => socket.off('data_updated', refresh);
  }, []);
  const initialForm = {
    generic_name: '',
    brand_name: '',
    strength: '',
    dosage_form: 'Solid',
    manufacturer: '',
    country: '',
    image_url: '',
    route: 'Oral',
    prescription_type: 'OTC',
    category_id: '',
    sub_category_id: '',
    mass: '',
    mass_unit: 'mg',
    pronunciation_english: '',
    pronunciation_amharic: '',
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
   * Server-side paginated fetching with race-condition protection:
   * only the LATEST request may update state; earlier responses
   * (e.g. a slow stale search) are discarded.
   */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);

    medicinesAPI.getAll({ ...filterParams, page, limit, sortBy, sortOrder })
      .then(res => {
        if (cancelled) return;
        const data = res.data;
        if (Array.isArray(data)) {
          // Backward compatibility: some deployments still return a plain array.
          setMedicines(data);
          setTotal(data.length);
          setTotalPages(Math.max(1, Math.ceil(data.length / limit)));
        } else {
          setMedicines(Array.isArray(data.medicines) ? data.medicines : []);
          setTotal(data.total ?? 0);
          setTotalPages(data.totalPages ?? 1);
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        setMedicines([]);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [filterParams, page, limit, sortBy, sortOrder, liveTick]);

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
      !list.some((c) => String(c.category_id) === String(assignedId))
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
    medicinesAPI.getAll({ ...filterParams, page, limit, sortBy, sortOrder })
      .then(res => {
        const data = res.data;
        if (Array.isArray(data)) {
          setMedicines(data);
          setTotal(data.length);
          setTotalPages(Math.max(1, Math.ceil(data.length / limit)));
        } else {
          setMedicines(Array.isArray(data.medicines) ? data.medicines : []);
          setTotal(data.total ?? 0);
          setTotalPages(data.totalPages ?? 1);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  /* Server-side pagination state */
  const safePage = Math.min(page, totalPages);

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
   * Cross-page intent: the Medicine Details view (opened from Inventory) asked
   * to edit a medicine. Fetch the fresh master record (the detail payload may
   * only carry the id) and open the very same Edit form used on this page.
   */
  useEffect(() => {
    if (!editMedicineId) return;
    if (isGuest) {
      toast.warning('Editing medicine details requires a pharmacy staff account.');
      if (onConsumeEditMedicine) onConsumeEditMedicine();
      return;
    }
    let cancelled = false;
    medicinesAPI.getById(editMedicineId)
      .then((res) => { if (!cancelled && res?.data) handleOpenEditModal(res.data); })
      .catch(() => { if (!cancelled) toast.error('Unable to load this medicine for editing.'); })
      .finally(() => { if (!cancelled && onConsumeEditMedicine) onConsumeEditMedicine(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMedicineId, isGuest]);

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
        storage_conditions: prev.storage_conditions || data.storage_condition_patient || '',
        // Pronunciation is an optional guide — AI only suggests it when
        // confidently known, and it NEVER overrides a value already entered.
        pronunciation_english: prev.pronunciation_english || data.pronunciation_english || '',
        pronunciation_amharic: prev.pronunciation_amharic || data.pronunciation_amharic || ''
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
      dosage_form: normalizeDosageForm(med.dosage_form),
      manufacturer: med.manufacturer || '',
      country: med.country || '',
      image_url: med.image_url || '',
      route: med.route || 'Oral',
      prescription_type: med.prescription_type || 'OTC',
      category_id: med.category_id || '',
      sub_category_id: med.sub_category_id || '',
      _assignedCategoryName: med.category_name || '',
      mass: med.mass ?? '',
      mass_unit: med.mass_unit || 'mg',
      pronunciation_english: med.pronunciation_english || '',
      pronunciation_amharic: med.pronunciation_amharic || '',
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

  /*
   * PERMANENT delete flow. The Details view's Delete action sets
   * deleteTarget; this runs the safe server transaction and surfaces the
   * backend's refusal (medicine has history → must deactivate instead).
   */
  /*
   * Quick activate / deactivate from the card's ⋮ menu (ADMIN only — the
   * backend enforces the same rule on the PATCH /status route).
   */
  const handleQuickStatus = async (med) => {
    const next = med.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await medicinesAPI.changeStatus(String(med.medicine_id), next);
      toast.success(`${next === 'ACTIVE' ? 'Activated' : 'Deactivated'} ${med.generic_name}.`);
      fetchMedicines();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Unable to change medicine status.');
    }
  };

  const handleRequestDelete = (med) => {
    if (!isAdmin) {
      toast.warning('Only administrators can permanently delete medicines.');
      return;
    }
    setDeleteTarget(med);
  };

  const confirmPermanentDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await medicinesAPI.delete(String(deleteTarget.medicine_id));
      toast.success(res?.data?.message || `${deleteTarget.generic_name || 'Medicine'} permanently deleted.`);
      setDeleteTarget(null);
      setLearnMedId(null);
      fetchMedicines();
    } catch (err) {
      const serverMsg = err.response?.data?.error;
      if (err.response?.status === 409) {
        // Historical pharmacy records exist — backend refuses destruction.
        toast.error(serverMsg || 'Cannot delete: this medicine has historical records.');
      } else if (err.response?.status === 403) {
        toast.error('Administrator permission required to delete medicines.');
      } else {
        toast.error(serverMsg || 'Unable to delete medicine.');
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmitForm = async (e) => {
    e.preventDefault();
    if (savingMedicine) return; // duplicate-submission guard

    // Frontend validation mirrors backend rules.
    if (!formData.generic_name.trim() || !formData.strength.trim()) {
      toast.warning('Generic name and strength are required.');
      return;
    }

    // Mass (weight) — optional, but when provided it must be a positive number
    // with a valid unit. Kept strictly inside the Add/Edit medicine form.
    const MASS_UNITS = ['mg', 'g', 'kg', 'mcg', 'μg', 'ug'];
    if (formData.mass !== '' && formData.mass !== null && formData.mass !== undefined) {
      const m = Number(formData.mass);
      if (!Number.isFinite(m) || m <= 0) {
        toast.warning('Mass (weight) must be a positive number.');
        return;
      }
      if (!MASS_UNITS.includes(formData.mass_unit)) {
        toast.warning('Please select a valid mass unit.');
        return;
      }
    }

    setSavingMedicine(true);
    try {
      const payload = { ...formData };
      // These fields are only UI state and must never be sent as medicine data.
      delete payload._assignedCategoryName;
      delete payload.user_id;
      payload.generic_name = formData.generic_name.trim();
      payload.strength = formData.strength.trim();
      payload.category_id = formData.category_id || null;
      payload.sub_category_id = formData.sub_category_id || null;

      if (isEditMode) {
        delete payload.initial_stock;
        await medicinesAPI.update(String(editId), payload);
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

  const routes = ['Oral', 'IV', 'IM', 'Subcutaneous', 'Topical', 'Inhalation', 'Sublingual', 'Rectal', 'Ophthalmic', 'Otic'];

  /* Subcategories for the FILTER row (independent from the form's list) */
  const filterSubcategories = useMemo(() => {
    if (!filters.category_id) return [];
    // Compare as STRINGS: PostgreSQL returns bigint IDs as strings ("3"),
    // the select sends string values too — strict number === string breaks.
    const cat = categories.find((c) => String(c.category_id) === String(filters.category_id));
    return cat?.sub_categories || [];
  }, [categories, filters.category_id]);

  const setFilter = (key, value) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      // Category changed → chained subcategory resets (they must work together).
      if (key === 'category_id') next.sub_category_id = '';
      return next;
    });
    setPage(1);
  };

  const anyFilter = filters.category_id || filters.sub_category_id || filters.dosage_form || filters.route || filters.prescription_type || filters.status;

  return (
    <div className="drugs-page">
      {/* ── Page header stays fixed; only the table scrolls horizontally ── */}
      <div className="page-header">
        <div className="page-title-group">
          <h1>Medicines</h1>
          <p>Permanent master records for every medicine in the pharmacy</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => (onNavigateImport ? onNavigateImport() : toast.info?.('Use the Import page in the sidebar.'))}>
            <Download size={15} />
            <span className="hide-sm">Import</span>
          </button>
          <button className="btn btn-primary" onClick={() => guard(handleOpenAddModal)}>
            <PackagePlus size={16} />
            Add New Drug
          </button>
        </div>
      </div>

      <div className="drugs-toolbar">
        <div className="smart-search-input-wrap" style={{ maxWidth: '380px' }}>
          <Search size={15} />
          <input
            type="text"
            placeholder="Search by generic, brand or strength…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search medicines"
          />
        </div>

        {/* ── VIEW TOGGLE: modern cards / compact table ── */}
        <div className="view-toggle" role="group" aria-label="View mode">
          <button
            type="button"
            className={`view-toggle__btn ${viewMode === 'cards' ? 'active' : ''}`}
            onClick={() => setViewMode('cards')}
            title="Card view"
            aria-pressed={viewMode === 'cards'}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            className={`view-toggle__btn ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
            title="Table view"
            aria-pressed={viewMode === 'table'}
          >
            <ListIcon size={15} />
          </button>
        </div>
      </div>

            {/* ── STATUS PILLS (inline, always visible) ── */}
      <div className="drugs-status-pills" role="group" aria-label="Filter by status">
        <button type="button" className={`status-pill ${filters.status === '' ? 'active' : ''}`} onClick={() => setFilter('status', '')}>All</button>
        <button type="button" className={`status-pill ${filters.status === 'ACTIVE' ? 'active' : ''}`} onClick={() => setFilter('status', 'ACTIVE')}>Active</button>
        <button type="button" className={`status-pill ${filters.status === 'INACTIVE' ? 'active' : ''}`} onClick={() => setFilter('status', 'INACTIVE')}>Inactive</button>
      </div>

      {/* ── MORE FILTERS (compact popover) ── */}
      <div className="drugs-extra-filters">
        <button type="button" className="drugs-filter-btn" onClick={() => setFiltersOpen((v) => !v)} aria-label="More filters">
          <Filter size={15} />
          <span>More filters</span>
        </button>

        {filtersOpen && (
          <div className="drugs-filters-popover" onMouseDown={(e) => e.stopPropagation()}>
            <div className="drugs-filters-grid">
              <select className="form-control form-control--sm" value={filters.category_id} onChange={(e) => setFilter('category_id', e.target.value)} aria-label="Filter by category">
                <option value="">All Categories</option>
                {categories.map((c) => <option key={`filter-category-${c.category_id}`} value={c.category_id}>{c.name}</option>)}
              </select>
              <select className="form-control form-control--sm" value={filters.sub_category_id} onChange={(e) => setFilter('sub_category_id', e.target.value)} disabled={!filters.category_id} aria-label="Filter by subcategory">
                <option value="">{filters.category_id ? 'All Subcategories' : 'All Subcategories'}</option>
                {filterSubcategories.map((s) => <option key={`filter-subcategory-${s.sub_category_id}`} value={s.sub_category_id}>{s.name}</option>)}
              </select>
              <select className="form-control form-control--sm" value={filters.dosage_form} onChange={(e) => setFilter('dosage_form', e.target.value)} aria-label="Filter by dosage form">
                <option value="">All Dosage Forms</option>
                {dosageForms.map((form) => <option key={form} value={form}>{form}</option>)}
              </select>
              <select className="form-control form-control--sm" value={filters.route} onChange={(e) => setFilter('route', e.target.value)} aria-label="Filter by route">
                <option value="">All Routes</option>
                {routes.map((r) => <option key={`filter-route-${r}`} value={r}>{r}</option>)}
              </select>
              <select className="form-control form-control--sm" value={filters.prescription_type} onChange={(e) => setFilter('prescription_type', e.target.value)} aria-label="Filter by prescription type">
                <option value="">All Types</option>
                {['OTC', 'PRESCRIPTION', 'CONTROLLED'].map((t) => <option key={`filter-rx-${t}`} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="drugs-filters-popover__foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFilters({ category_id: '', sub_category_id: '', dosage_form: '', route: '', prescription_type: '', status: '' }); setPage(1); setFiltersOpen(false); }}>
                Clear all filters
              </button>
            </div>
          </div>
        )}
        {filtersOpen && <div className="drugs-filters-overlay" onClick={() => setFiltersOpen(false)} />}
      </div>

      {/* ── SORT CONTROLS ── */}
      <div className="drugs-sort-row">
        <span className="sort-label">Sort by:</span>
        <select
          className="form-control sort-select"
          value={sortBy}
          onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
          aria-label="Sort medicines by"
        >
          <option value="generic_name">Name (A-Z)</option>
          <option value="brand_name">Brand Name</option>
          <option value="nearest_expiry">Expiry Date</option>
          <option value="created_date">Date Added</option>
          <option value="stock_on_hand">Stock Level</option>
        </select>
        <button
          type="button"
          className="btn btn-ghost btn-sm sort-order-btn"
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
          aria-label={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
        >
          {sortOrder === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>
        <span className="sort-info">{total} medicine{total === 1 ? '' : 's'} · 18 per page</span>
      </div>

      <div className="table-container">
        {loading && viewMode === 'cards' ? (
          <div className="medicine-card-grid" aria-busy="true">
            {Array.from({ length: limit > 12 ? 12 : limit }).map((_, i) => (
              <div key={`med-skeleton-${i}`} className="medicine-card medicine-card--skeleton">
                <div className="skeleton" style={{ height: 132 }} />
                <div style={{ padding: '0.9rem' }}>
                  <div className="skeleton" style={{ width: '60%', height: '0.95rem' }} />
                  <div className="skeleton" style={{ width: '45%', height: '0.7rem', marginTop: '0.5rem' }} />
                  <div className="skeleton" style={{ width: '85%', height: '0.7rem', marginTop: '0.9rem' }} />
                  <div className="skeleton" style={{ width: '50%', height: '1.4rem', marginTop: '0.9rem', borderRadius: 8 }} />
                </div>
              </div>
            ))}
          </div>
        ) : loading ? (
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
        ) : viewMode === 'cards' ? (
          <div className="medicine-card-grid">
            {medicines.map((med) => {
              const st = getStockStatus(med);
              const stock = parseInt(med.stock_on_hand, 10) || 0;
              const brandDiffers =
                med.brand_name &&
                med.brand_name.trim().toLowerCase() !== (med.generic_name || '').trim().toLowerCase();

              const sellBlocked = st.key === 'inactive' || st.key === 'out' || st.key === 'expired';
              return (
                <article
                  key={`medicine-${med.medicine_id}`}
                  className="medicine-card stagger-item"
                  role="button"
                  tabIndex={0}
                  aria-label={`View details for ${med.generic_name}${brandDiffers ? ` (${med.brand_name})` : ''}`}
                  onClick={() => setLearnMedId(med.medicine_id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setLearnMedId(med.medicine_id);
                    }
                  }}
                >
                  {/* ── A. IMAGE (hero area, zooms on hover) ── */}
                  <div className="medicine-card__media">
                    <MedicineImage className="medicine-card__image" src={med.image_url} alt={med.generic_name} />
                    <div className="medicine-card__scrim" aria-hidden="true" />
                    <span className={`medicine-card__badge tone-${st.tone}`} title={st.label}>
                      <span className="medicine-card__badge-icon" aria-hidden="true">{st.icon}</span>
                      {st.label}
                    </span>
                    <span className="medicine-card__hover-hint" aria-hidden="true">
                      <Eye size={13} /> View Details
                    </span>
                  </div>

                  {/* ── B. IDENTITY ── */}
                  <div className="medicine-card__body">
                    <h3 className="medicine-card__title">{med.generic_name}</h3>
                    {brandDiffers && <p className="medicine-card__brand">{med.brand_name}</p>}
                    <p className="medicine-card__meta">
                      {[med.strength, med.dosage_form, med.route].filter(Boolean).join(' • ') || '—'}
                    </p>
                    {(med.pronunciation_english || med.pronunciation_amharic) && (
                      <p className="medicine-card__pron">
                        {med.pronunciation_english && <PronunciationSpeaker text={med.pronunciation_english} language="en" label="En" />}
                        {med.pronunciation_english && med.pronunciation_amharic && ' · '}
                        {med.pronunciation_amharic && <PronunciationSpeaker text={med.pronunciation_amharic} language="am-ET" label="አማ" />}
                      </p>
                    )}

                    {/* ── C/D. STOCK SUMMARY + EXPIRY ── */}
                    <div className="medicine-card__facts">
                      <div className="medicine-card__fact">
                        <dt>Stock</dt>
                        <dd>
                          {stock} unit{stock === 1 ? '' : 's'}
                        </dd>
                      </div>
                      <div className="medicine-card__fact">
                        <dt>Batches</dt>
                        <dd>{med.active_batches || 0}</dd>
                      </div>
                      <div className="medicine-card__fact">
                        <dt>Expiry</dt>
                        <dd>{med.nearest_expiry ? fmtExpiry(med.nearest_expiry) : '—'}</dd>
                      </div>
                    </div>

                    {/* ── E. ACTIONS ── */}
                    <div className="medicine-card__actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={(e) => { e.stopPropagation(); setLearnMedId(med.medicine_id); }}
                      >
                        <BookOpen size={13} /> View Details
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        title={sellBlocked ? `Selling unavailable — ${st.label.toLowerCase()}` : 'Sell in POS'}
                        disabled={sellBlocked}
                        onClick={(e) => { e.stopPropagation(); guard(() => onOpenPOS && onOpenPOS()); }}
                      >
                        <ShoppingCart size={13} /> Sell
                      </button>
                      <CardMenu
                        items={[
                          { key: 'view', label: 'View Details', icon: <Eye size={14} />, onClick: () => setLearnMedId(med.medicine_id) },
                          { key: 'sell', label: 'Sell in POS', icon: <ShoppingCart size={14} />, onClick: () => guard(() => onOpenPOS && onOpenPOS(med)) },
                          { key: 'edit', label: 'Edit Medicine', icon: <Edit size={14} />, onClick: () => guard(() => handleOpenEditModal(med)) },
                          isAdmin && {
                            key: 'status',
                            label: med.status === 'ACTIVE' ? 'Deactivate' : 'Activate',
                            icon: med.status === 'ACTIVE' ? <PowerOff size={14} /> : <Power size={14} />,
                            onClick: () => handleQuickStatus(med),
                          },
                          isAdmin && {
                            key: 'delete',
                            label: 'Delete',
                            icon: <Trash2 size={14} />,
                            danger: true,
                            onClick: () => handleRequestDelete(med),
                          },
                        ]}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
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
                  {medicines.map((med) => (
                    <tr key={`table-medicine-${med.medicine_id}`}>
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
                        {(parseInt(med.expired_batches, 10) || 0) > 0 && <span className="badge badge-danger" title="Contains expired batches">× Expired</span>}
                        {(parseInt(med.expiring_soon, 10) || 0) > 0 && <span className="badge badge-warning" title="Batches expiring within 90 days">⚠ Expiring</span>}
                      </td>
                      <td><span className="badge badge-neutral">{med.prescription_type}</span></td>
                      <td>
                        <span className={`badge ${med.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>{med.status}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => setLearnMedId(med.medicine_id)}>
                          <BookOpen size={13} /> View
                        </button>
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
              {medicines.map((med) => (
                <div key={`mobile-medicine-${med.medicine_id}`} className="mobile-card stagger-item">
                  <div className="mobile-card-head">
                    <strong>{med.generic_name}{med.brand_name ? ` (${med.brand_name})` : ''}</strong>
                    <span className={`badge ${parseInt(med.stock_on_hand) === 0 ? 'badge-danger' : parseInt(med.stock_on_hand) < 10 ? 'badge-warning' : 'badge-secondary'}`}>
                      {med.stock_on_hand || 0}
                    </span>
                  </div>
                  <div className="mobile-card-meta">
                    <span>{med.strength} · {med.dosage_form}</span>
                    <span className={`badge ${parseInt(med.stock_on_hand) === 0 ? 'badge-danger' : parseInt(med.stock_on_hand) < 10 ? 'badge-warning' : 'badge-secondary'}`}>
                      {med.stock_on_hand || 0}
                    </span>
                  </div>
                  <div className="mobile-card-meta">
                    <span className="muted-line">{med.nearest_expiry ? `Exp: ${fmtExpiry(med.nearest_expiry)}` : 'No active expiry'}</span>
                    <span className={`badge ${med.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>{med.status}</span>
                  </div>
                  <div className="mobile-card-meta">
                    <span className="badge badge-neutral">{med.prescription_type}</span>
                    <span className="badge badge-primary">{med.category_name || 'Uncategorized'}</span>
                  </div>
                  <div className="mobile-card-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => setLearnMedId(med.medicine_id)}>
                      <BookOpen size={13} /> View
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => guard(() => handleOpenEditModal(med))}>
                      <Edit size={13} /> Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── SHARED PAGINATION (cards + table) ── */}
        {!loading && !loadError && medicines.length > 0 && (
          <div className="drugs-pagination-bar">
            <div className="drugs-per-page">
              <label htmlFor="drug-per-page">Per page</label>
              <select
                id="drug-per-page"
                className="form-control"
                style={{ maxWidth: 92, padding: '0.3rem 0.5rem' }}
                value={limit}
                onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                aria-label="Medicines per page"
              >
                {[18, 36, 72].map((n) => <option key={`limit-${n}`} value={n}>{n} / page</option>)}
              </select>
            </div>
            <Pagination
              page={safePage}
              totalPages={totalPages}
              total={total}
              label="medicines"
              onPageChange={(p) => setPage(Math.min(Math.max(1, p), totalPages))}
            />
            <button className="btn btn-ghost" onClick={handleExport}>
              <Download size={15} /> Export CSV
            </button>
          </div>
        )}
      </div>



      {/* ── PERMANENT-DELETE CONFIRMATION (type the name to confirm) ── */}
      <MedicineDeleteModal
        medicine={deleteTarget}
        loading={deleting}
        onConfirm={confirmPermanentDelete}
        onCancel={() => { if (!deleting) setDeleteTarget(null); }}
      />

      {/* ── MEDICINE DETAILS VIEW (single instance): full action set ── */}
      {learnMedId && (
        <MedicineLearnModal
          medicineId={learnMedId}
          onClose={() => setLearnMedId(null)}
          onEdit={(med) => { setLearnMedId(null); handleOpenEditModal(med); }}
          onDeleteRequest={(med) => { setLearnMedId(null); handleRequestDelete(med); }}
          onStatusChanged={() => fetchMedicines()}
          onSell={(med) => guard(() => onOpenPOS && onOpenPOS(med))}
          onResupply={() => { setLearnMedId(null); onNavigateImport && onNavigateImport(); }}
        />
      )}

      {/* ── ADD / EDIT MODAL ── */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '820px' }}>
            <div className="modal-header">
              <h2>{isEditMode ? 'Edit Medicine' : 'Register New Medicine'}</h2>
              <button type="button" className="modal-close-btn" onClick={() => !savingMedicine && setIsModalOpen(false)} disabled={savingMedicine} aria-label="Close">×</button>
            </div>

            <form onSubmit={handleSubmitForm}>
              {/* SECTION A – Basic Info */}
              <div className="drug-section">
                <h3 className="drug-section-title">Section A — Medicine Identification</h3>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Generic Name (Active Ingredient) *</label>
                    <input required type="text" className="form-control" value={formData.generic_name}
                      onChange={e => setFormData({ ...formData, generic_name: e.target.value })} placeholder="e.g. Paracetamol" />
                  </div>
                  <div className="form-group">
                    <label>Brand Name *</label>
                    <input required type="text" className="form-control" value={formData.brand_name}
                      onChange={e => setFormData({ ...formData, brand_name: e.target.value })} placeholder="e.g. Panadol" />
                                    </div>
                  <div className="form-group form-group--wide">
                    <label>Pronunciation</label>
                    <div className="pron-grid">
                      <div>
                        <input type="text" className="form-control" aria-label="English pronunciation" value={formData.pronunciation_english}
                          onChange={e => setFormData({ ...formData, pronunciation_english: e.target.value })} placeholder="Example: Nor-ETH-is-te-rone" />
                        <span className="form-hint">Optional. Write the pronunciation the way you want the system to read it.</span>
                      </div>
                      <div>
                        <input type="text" className="form-control" aria-label="Amharic pronunciation" value={formData.pronunciation_amharic}
                          onChange={e => setFormData({ ...formData, pronunciation_amharic: e.target.value })} placeholder="Example: ኖሬቲስቴሮን" />
                        <span className="form-hint">Optional. Enter the Amharic pronunciation you want the system to read.</span>
                      </div>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Strength / Concentration *</label>
                    <input required type="text" className="form-control" placeholder="e.g. 500 mg" value={formData.strength}
                      onChange={e => setFormData({ ...formData, strength: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Mass / Weight</label>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <input type="number" min="0" step="0.001" className="form-control" placeholder="e.g. 500"
                        value={formData.mass}
                        onChange={e => setFormData({ ...formData, mass: e.target.value })} />
                      <select className="form-control" style={{ maxWidth: '88px', flexShrink: 0 }} value={formData.mass_unit}
                        onChange={e => setFormData({ ...formData, mass_unit: e.target.value })}>
                        <option value="mg">mg</option>
                        <option value="g">g</option>
                        <option value="kg">kg</option>
                        <option value="mcg">mcg</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Dosage Form *</label>
                    <select required className="form-control" value={formData.dosage_form}
                      onChange={e => setFormData({ ...formData, dosage_form: e.target.value })}>
                      {DOSAGE_FORMS.map(f => <option key={`form-${f}`} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Manufacturer / Brand Owner *</label>
                    <input required type="text" className="form-control" value={formData.manufacturer}
                      onChange={e => setFormData({ ...formData, manufacturer: e.target.value })} placeholder="e.g. GSK" />
                  </div>
                  <div className="form-group">
                    <label>Country of Manufacture</label>
                    <input type="text" className="form-control" value={formData.country}
                      onChange={e => setFormData({ ...formData, country: e.target.value })} placeholder="e.g. Ethiopia" />
                  </div>
                  <div className="form-group">
                    <label>Medicine Image URL</label>
                    <input type="url" className="form-control" value={formData.image_url || ''}
                      onChange={e => setFormData({ ...formData, image_url: e.target.value })} placeholder="https://…/augmentin.jpg" />
                  </div>
                  <div className="form-group">
                    <label>Route of Administration</label>
                    <select className="form-control" value={formData.route}
                      onChange={e => setFormData({ ...formData, route: e.target.value })}>
                      {routes.map(r => <option key={`route-${r}`} value={r}>{r}</option>)}
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
                    <label>Drug Class / Category *</label>
                    <div className="category-picker" role="listbox" aria-label="Medicine category">
                      <button type="button" className={`category-tile category-tile--empty ${!formData.category_id ? 'selected' : ''}`}
                        onClick={() => setFormData({ ...formData, category_id: '', sub_category_id: '' })}>
                        <span className="category-tile__mark">+</span>
                        <span>Uncategorized</span>
                      </button>
                      {categoriesForForm.map(c => (
                        <button type="button" key={`form-category-${c.category_id}`}
                          className={`category-tile ${String(formData.category_id) === String(c.category_id) ? 'selected' : ''}`}
                          onClick={() => setFormData({ ...formData, category_id: String(c.category_id), sub_category_id: '' })}>
                          <span className="category-tile__mark">{c.name.charAt(0).toUpperCase()}</span>
                          <span>{c.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Subcategory (Optional)</label>
                    <select className="form-control" value={formData.sub_category_id}
                      onChange={e => setFormData({ ...formData, sub_category_id: e.target.value })}
                      disabled={!formData.category_id}>
                      <option value="">— No Subcategory —</option>
                      {subcategories.map(s => <option key={`form-subcategory-${s.sub_category_id}`} value={s.sub_category_id}>{s.name}</option>)}
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
                    <span className="form-hint">AI suggestions are pre-filled for review — nothing is saved until you confirm.</span>
                  </div>
                  <button type="button" onClick={handleAiAutofill} disabled={aiLoading} className="btn btn-secondary btn-sm">
                    <Sparkles size={14} /> {aiLoading ? 'Generating…' : 'AI Autofill'}
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
                            {suppliers.map(s => <option key={`form-supplier-${s.supplier_id}`} value={s.supplier_id}>{s.name}</option>)}
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
                    ? (isEditMode ? 'Saving Changes…' : 'Registering Medicine…')
                    : (isEditMode ? 'Save Changes' : (addInitialStock ? 'Review & Save Medicine' : 'Save Medicine'))}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MEDICINE DETAILS VIEW is rendered once, above (full action set) ── */}
    </div>
  );
};
