import React, { useState, useEffect } from 'react';
import './Suppliers.css';
import { Truck, Plus, Edit, Phone, MapPin } from 'lucide-react';
import { suppliersAPI } from '../services/api';
import { useToast } from '../context/ToastContext';

export const Suppliers = () => {
  const { toast, withLoading } = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ name: '', location: '', contact_info: '' });

  const fetchSuppliers = () => {
    setLoading(true);
    suppliersAPI.getAll()
      .then(res => {
        setSuppliers(res.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
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
    setEditingId(sup.id);
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
      setIsModalOpen(false);
      fetchSuppliers();
    } catch (err) {
      toast.error('Failed to save supplier details');
    }
  };

  return (
    <div className="suppliers-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Supplier Management</h1>
          <p>Distributors, medical suppliers, and contact directory</p>
        </div>
        <button className="btn-scan" style={{ background: '#2563eb' }} onClick={handleOpenAdd}>
          <Plus size={18} /> Add New Supplier
        </button>
      </div>

      <div className="table-container">
        <table className="custom-table">
          <thead>
            <tr>
              <th>Supplier ID</th>
              <th>Supplier Name</th>
              <th>Location / Address</th>
              <th>Contact Info</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map(sup => (
              <tr key={sup.id}>
                <td><span className="badge badge-info">SUP-00{sup.id}</span></td>
                <td><strong style={{ color: '#0f172a' }}>{sup.name}</strong></td>
                <td>
                  <span style={{ fontSize: '0.85rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <MapPin size={14} color="#2563eb" /> {sup.location || 'N/A'}
                  </span>
                </td>
                <td>
                  <span style={{ fontSize: '0.85rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Phone size={14} color="#10b981" /> {sup.contact_info || 'N/A'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button onClick={() => handleOpenEdit(sup)} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer' }}>
                    <Edit size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>{editingId ? 'Edit Supplier' : 'Add Supplier'}</h2>
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
                />
              </div>
              <div className="form-group">
                <label>Contact Info</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.contact_info}
                  onChange={(e) => setFormData({ ...formData, contact_info: e.target.value })}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setIsModalOpen(false)} style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#fff', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" className="btn-scan" style={{ background: '#2563eb' }}>
                  Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
