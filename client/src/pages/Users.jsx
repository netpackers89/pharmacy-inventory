import React, { useState, useEffect } from 'react';
import './Users.css';
import { Users as UsersIcon, Plus, Edit, ShieldCheck, UserCheck } from 'lucide-react';
import { usersAPI } from '../services/api';
import { useToast } from '../context/ToastContext';

export const Users = () => {
  const { toast, withLoading } = useToast();
  const [usersList, setUsersList] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ username: '', password: '', role: 'pharmacist' });

  const fetchUsers = () => {
    usersAPI.getAll()
      .then(res => setUsersList(res.data || []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleOpenAdd = () => {
    setEditingId(null);
    setFormData({ username: '', password: '', role: 'pharmacist' });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (user) => {
    setEditingId(user.id);
    setFormData({ username: user.username, password: '', role: user.role });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await usersAPI.update(editingId, formData);
      } else {
        await usersAPI.create(formData);
      }
      setIsModalOpen(false);
      fetchUsers();
    } catch (err) {
      toast.error('Failed to save user account');
    }
  };

  return (
    <div className="users-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Staff User Accounts & Access Control</h1>
          <p>Manage system access for Admin and Pharmacist roles</p>
        </div>
        <button className="btn-scan" style={{ background: '#2563eb' }} onClick={handleOpenAdd}>
          <Plus size={18} /> Add New User
        </button>
      </div>

      <div className="table-container">
        <table className="custom-table">
          <thead>
            <tr>
              <th>User ID</th>
              <th>Username</th>
              <th>System Access Role</th>
              <th>Account Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {usersList.map(u => (
              <tr key={u.id}>
                <td><span className="badge badge-info">USR-00{u.id}</span></td>
                <td><strong style={{ color: '#0f172a' }}>{u.username}</strong></td>
                <td>
                  <span className={`badge ${u.role === 'admin' ? 'badge-primary' : 'badge-secondary'}`}>
                    <ShieldCheck size={14} /> {u.role ? u.role.toUpperCase() : 'PHARMACIST'}
                  </span>
                </td>
                <td>
                  <span style={{ fontSize: '0.85rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                    <UserCheck size={16} /> Active Staff Account
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button onClick={() => handleOpenEdit(u)} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer' }}>
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
          <div className="modal-card" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>{editingId ? 'Edit User Role' : 'Create User Account'}</h2>
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label>Username *</label>
                <input
                  type="text"
                  className="form-control"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Password {editingId ? '(Leave blank to keep unchanged)' : '*'}</label>
                <input
                  type="password"
                  className="form-control"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required={!editingId}
                />
              </div>
              <div className="form-group">
                <label>System Role *</label>
                <select
                  className="form-control"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                >
                  <option value="pharmacist">Pharmacist</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setIsModalOpen(false)} style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#fff', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" className="btn-scan" style={{ background: '#2563eb' }}>
                  Save User Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
