import React, { useState, useEffect } from 'react';
import './Drugs.css';
import { Plus, Sparkles, Edit, Search, Check } from 'lucide-react';
import { medicinesAPI, suppliersAPI, aiAPI, categoriesAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export const Drugs = ({ onOpenPOS }) => {
  const { user } = useAuth();
  const { toast, withLoading } = useToast();
  const [medicines, setMedicines] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [subcategories, setSubcategories] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editId, setEditId] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
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
        toast.error('Preview failed');
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
      toast.error('Import failed');
    }
    setImportLoading(false);
  };

  const closeImportModal = () => {
    setIsImportModalOpen(false);
    setImportPreview(null);
    setImportResults(null);
  };


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

  const fetchMedicines = () => {
    setLoading(true);
    medicinesAPI.getAll({ search: searchQuery })
      .then(res => { setMedicines(res.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchMedicines();
    suppliersAPI.getAll().then(res => setSuppliers(res.data || [])).catch(() => {});
    categoriesAPI.getAll().then(res => {
      setCategories(res.data || []);
    }).catch(() => {});
  }, [searchQuery]);

  // When category changes, filter subcategories
  useEffect(() => {
    if (formData.category_id) {
      const cat = categories.find(c => c.category_id == formData.category_id);
      setSubcategories(cat?.sub_categories || []);
      setFormData(prev => ({ ...prev, sub_category_id: '' }));
    } else {
      setSubcategories([]);
    }
  }, [formData.category_id, categories]);

  const handleAiAutofill = async () => {
    const term = formData.generic_name || formData.brand_name;
    if (!term) { toast.warning('Please enter Generic Name or Brand Name first!'); return; }
    setAiLoading(true);
    try {
      const res = await aiAPI.autofill(term, formData.dosage_form);
      if (res.data) {
        setFormData(prev => ({
          ...prev,
          description: res.data.description || prev.description,
          indications: res.data.indication || prev.indications,
          contraindications: res.data.contraindication || prev.contraindications,
          side_effects: res.data.side_effects || prev.side_effects,
          warnings: res.data.warnings || prev.warnings,
          storage_conditions: res.data.storage_condition_patient || prev.storage_conditions
        }));
      }
    } catch (err) { console.error(err); }
    finally { setAiLoading(false); }
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
    try {
      const payload = { ...formData };
      // category_id null if not selected (allowed, FK is nullable)
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
      toast.error('Failed to save drug: ' + (err.response?.data?.details || err.response?.data?.error || err.message));
    }
  };

  const dosageForms = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Cream', 'Ointment', 'Drops', 'Inhaler', 'Suppository', 'Powder', 'Patch'];
  const routes = ['Oral', 'IV', 'IM', 'Subcutaneous', 'Topical', 'Inhalation', 'Sublingual', 'Rectal', 'Ophthalmic', 'Otic'];

  return (
    <div className="drugs-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Drugs</h1>
          <p>Permanent master records for medicines</p>
        </div>
        <button className="btn-scan" style={{ background: '#10b981', marginRight: '10px' }} onClick={() => setIsImportModalOpen(true)}>
          <span className="btn-scan-label">Import</span>
        </button>
        <button className="btn-scan" style={{ background: '#2563eb' }} onClick={handleOpenAddModal}>
          <Plus size={16} />
          <span className="btn-scan-label">Add New Drug</span>
        </button>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <div className="smart-search-input-wrap" style={{ backgroundColor: '#fff' }}>
          <Search size={16} color="#64748b" />
          <input
            type="text"
            placeholder="Search drugs by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="table-container">
        <div style={{ overflowX: 'auto' }}>
          <table className="custom-table">
            <thead>
              <tr>
                <th>Drug Name</th>
                <th>Strength / Form</th>
                <th>Category</th>
                <th>Stock</th>
                <th>Type</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Loading drugs...</td></tr>
              ) : medicines.length === 0 ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>No drugs registered yet. Click "Add New Drug" to start.</td></tr>
              ) : (
                medicines.map((med) => (
                  <tr key={med.medicine_id}>
                    <td>
                      <strong style={{ color: '#0f172a', display: 'block' }}>{med.generic_name}</strong>
                      {med.brand_name && <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{med.brand_name}</span>}
                    </td>
                    <td>{med.strength} · {med.dosage_form}</td>
                    <td>
                      <span className="badge badge-primary">{med.category_name || 'Uncategorized'}</span>
                    </td>
                    <td>
                      <span className={`badge ${parseInt(med.stock_on_hand) === 0 ? 'badge-danger' : parseInt(med.stock_on_hand) < 10 ? 'badge-warning' : 'badge-secondary'}`}>
                        {med.stock_on_hand || 0}
                      </span>
                    </td>
                    <td><span className="badge">{med.prescription_type}</span></td>
                    <td>
                      <span className={`badge ${med.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>{med.status}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => handleOpenEditModal(med)}
                        style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#2563eb', padding: '0.35rem 0.75rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}
                      >
                        <Edit size={13} style={{ verticalAlign: 'middle', marginRight: '3px' }} /> Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      
      {isImportModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Import Medicines</h2>
              <button onClick={closeImportModal} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' }}>×</button>
            </div>
            {!importPreview && !importResults && (
              <div style={{ padding: '2rem', textAlign: 'center', border: '2px dashed #cbd5e1', borderRadius: '10px', marginTop: '1rem' }}>
                <p>Upload CSV File</p>
                <input type="file" accept=".csv" onChange={handleFileUpload} />
              </div>
            )}
            {importLoading && <p style={{ textAlign: 'center', padding: '1rem' }}>Loading...</p>}
            {importPreview && !importResults && !importLoading && (
              <div>
                <table className="custom-table" style={{ marginTop: '1rem' }}>
                  <thead>
                    <tr><th>Row</th><th>Medicine</th><th>Batch</th><th>Qty</th><th>Decision</th></tr>
                  </thead>
                  <tbody>
                    {importPreview.map((row, i) => (
                      <tr key={i}>
                        <td>{row.Row || i+1}</td>
                        <td>{row.Medicine}</td>
                        <td>{row.Batch}</td>
                        <td>{row.Qty}</td>
                        <td>
                          {row.Decision && row.Decision.includes('Existing medicine + existing batch') && '🟢 '}
                          {row.Decision && row.Decision.includes('Existing medicine + new batch') && '🔵 '}
                          {row.Decision && row.Decision.includes('New medicine + new batch') && '🆕 '}
                          {row.Decision}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                  <button onClick={handleConfirmImport} style={{ padding: '0.7rem 1.5rem', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Confirm Import</button>
                </div>
              </div>
            )}
            {importResults && (
              <div style={{ padding: '2rem', textAlign: 'center' }}>
                <h3 style={{ color: '#10b981' }}>Import Successful!</h3>
                <p>{importResults.message || 'Records imported.'}</p>
                <button onClick={closeImportModal} style={{ padding: '0.5rem 1rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', marginTop: '1rem' }}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '820px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>{isEditMode ? 'Edit Drug' : 'Register New Drug'}</h2>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' }}>×</button>
            </div>

            <form onSubmit={handleSubmitForm}>
              {/* SECTION A – Basic Info */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid #e2e8f0' }}>
                  Section A — Basic Drug Information
                </h3>
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
                      {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
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
              <div style={{ marginBottom: '1.5rem', background: '#f8fafc', padding: '1.25rem', borderRadius: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                    Section B — Clinical Information
                  </h3>
                  <button type="button" onClick={handleAiAutofill} disabled={aiLoading}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' }}>
                    <Sparkles size={14} /> {aiLoading ? 'Filling...' : '✨ AI Autofill'}
                  </button>
                </div>
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
                <div style={{ marginBottom: '1.5rem', border: '1.5px solid #e2e8f0', padding: '1.25rem', borderRadius: '10px' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                    Section C — Initial Stock
                  </h3>
                  <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
                    Do you have stock for this drug right now?
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', marginBottom: addInitialStock ? '1.5rem' : 0 }}>
                    <button type="button" onClick={() => setAddInitialStock(true)}
                      style={{ flex: 1, padding: '0.75rem', border: addInitialStock ? '2px solid #10b981' : '1px solid #cbd5e1', borderRadius: '8px', background: addInitialStock ? '#f0fdf4' : '#fff', fontWeight: 700, color: addInitialStock ? '#065f46' : '#475569', cursor: 'pointer' }}>
                      ✅ Yes, Add Initial Stock
                    </button>
                    <button type="button" onClick={() => setAddInitialStock(false)}
                      style={{ flex: 1, padding: '0.75rem', border: !addInitialStock ? '2px solid #2563eb' : '1px solid #cbd5e1', borderRadius: '8px', background: !addInitialStock ? '#eff6ff' : '#fff', fontWeight: 700, color: !addInitialStock ? '#1d4ed8' : '#475569', cursor: 'pointer' }}>
                      📋 No, Register Drug Only
                    </button>
                  </div>

                  {addInitialStock && (
                    <div style={{ borderLeft: '4px solid #10b981', paddingLeft: '1rem' }}>
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
                            onChange={e => setFormData({ ...formData, initial_stock: { ...formData.initial_stock, barcode: e.target.value } })} />
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
                          <input required type="number" step="0.01" className="form-control" value={formData.initial_stock.buy_price}
                            onChange={e => {
                              const bp = parseFloat(e.target.value) || 0;
                              setFormData({ ...formData, initial_stock: { ...formData.initial_stock, buy_price: e.target.value, sell_price: (bp * 1.25).toFixed(2) } });
                            }} />
                        </div>
                        <div className="form-group">
                          <label>Sell Price (Auto +25%)</label>
                          <input type="number" step="0.01" className="form-control" value={formData.initial_stock.sell_price}
                            onChange={e => setFormData({ ...formData, initial_stock: { ...formData.initial_stock, sell_price: e.target.value } })} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                <button type="button" onClick={() => setIsModalOpen(false)}
                  style={{ padding: '0.7rem 1.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                  Cancel
                </button>
                <button type="submit"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.7rem 1.5rem', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                  <Check size={16} /> {isEditMode ? 'Save Changes' : (addInitialStock ? 'Register Drug & Stock' : 'Register Drug')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
