import React, { useState, useEffect } from 'react';
import './Suppliers.css';
import { Plus, Edit, Phone, MapPin, Truck, Download } from 'lucide-react';
import { suppliersAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useGuestGuard } from '../hooks/useGuestGuard';
import { downloadCsv } from '../utils/csv';
import { TableSkeleton, EmptyState, ErrorState } from '../components/Feedback';

export const Suppliers = () => {
  const { toast } = useToast();
  const guard = useGuestGuard();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ name: '', location: '', contact_info: '' });

  const fetchSuppliers = () => {
    setLoading(true);
    setLoadError(false);
    suppliersAPI.getAll()
      .then(res => {
        setSuppliers(Array.isArray(res.data) ? res.data : []);
        setLoading(false);
      })
      .catch(() => {
        setLoadError(true);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const handleOpenAdd = () => {
    setEditingId(null);
    setFormData({ name: '', location: '', contact_info: '' });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (sup) => {
    setEditingId(sup.supplier_id);
    setFormData({ name: sup.name, location: sup.location || '', contact_info: sup.contact_info || '' });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await suppliersAPI.update(editingId, formData);
      } else {
        await suppliersAPI.create(formData);
      }
      toast.success(editingId ? 'Supplier updated.' : 'Supplier added.');
      setIsModalOpen(false);
      fetchSuppliers();
    } catch (err) {
      toast.error('Failed to save supplier details');
    }
  };

  const handleExport = () => downloadCsv({
    rows: suppliers,
    columns: [
      { key: 'id', label: 'Supplier ID' },
      { key: 'name', label: 'Supplier Name' },
      { key: 'location', label: 'Location' },
      { key: 'contact_info', label: 'Contact Info' },
    ],
    dataset: 'suppliers',
    notify: toast,
  });

  return (
    <div className="suppliers-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Supplier Management</h1>
          <p>Distributors, medical suppliers, and contact directory</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" style={{ border: '1px solid var(--border)' }} onClick={handleExport}>
            <Download size={15} /> Export
          </button>
          <button className="btn btn-primary" onClick={() => guard(handleOpenAdd)}>
            <Plus size={16} /> Add New Supplier
          </button>
        </div>
      </div>

      <div className="table-container">
        {loading ? (
          <TableSkeleton rows={6} cols={[14, 26, 28, 24]} />
        ) : loadError ? (
          <ErrorState title="Unable to load suppliers" onRetry={fetchSuppliers} />
        ) : suppliers.length === 0 ? (
          <EmptyState
            icon={<Truck size={26} />}
            title="No suppliers registered"
            description="Add your first distributor to link batches and resupply records."
          />
        ) : (
          <>
            <div className="table-scroll-wrap">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Supplier ID</th><th>Supplier Name</th><th>Location / Address</th>
                    <th>Contact Info</th><th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map(sup => (
                    <tr key={sup.supplier_id}>
                      <td><span className="badge badge-neutral">SUP-{String(sup.supplier_id).padStart(3, '0')}</span></td>
                      <td><strong className="td-strong">{sup.name}</strong></td>
                      <td>
                        <span className="sup-cell"><MapPin size={14} /> {sup.location || 'N/A'}</span>
                      </td>
                      <td>
                        <span className="sup-cell"><Phone size={14} /> {sup.contact_info || 'N/A'}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="icon-btn" data-tip="Edit supplier" onClick={() => guard(() => handleOpenEdit(sup))} aria-label={`Edit ${sup.name}`}>
                          <Edit size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>{suppliers.length} supplier{suppliers.length === 1 ? '' : 's'}</span>
            </div>
          </>
        )}
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit Supplier' : 'Add Supplier'}</h2>
              <button type="button" className="modal-close-btn" onClick={() => setIsModalOpen(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label>Supplier Name *</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Location</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="e.g. Addis Ababa"
                />
              </div>
              <div className="form-group">
                <label>Contact Info</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.contact_info}
                  onChange={(e) => setFormData({ ...formData, contact_info: e.target.value })}
                  placeholder="Phone or email"
                />
              </div>
              <div className="confirm-actions" style={{ marginTop: '1rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">Save Supplier</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
