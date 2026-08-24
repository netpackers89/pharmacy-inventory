import axios from 'axios';

let configuredApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
configuredApiUrl = configuredApiUrl.trim().replace(/^\[+|\]+$/g, '');
if (!/^https?:\/\//i.test(configuredApiUrl)) configuredApiUrl = `https://${configuredApiUrl}`;
const API_BASE = `${configuredApiUrl.replace(/\/$/, '')}/api`;

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pharm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const authAPI = {
  login: (data) => api.post('/auth/login', data),
  signup: (data) => api.post('/auth/signup', data)
};

export const medicinesAPI = {
  getAll: (params) => api.get('/medicines', { params }),
  getById: (id) => api.get(`/medicines/${id}`),
  create: (data) => api.post('/medicines', data),
  update: (id, data) => api.put(`/medicines/${id}`, data),
  delete: (id) => api.delete(`/medicines/${id}`),
  import: (medicines) => api.post('/medicines/import', { medicines }),
  previewImport: (medicines) => api.post('/medicines/import/preview', { medicines }),
  confirmImport: (medicines) => api.post('/medicines/import/confirm', { medicines })
};

export const inventoryAPI = {
  getStock: (params) => api.get('/inventory/stock', { params }),
  addStock: (data) => api.post('/inventory/stock', data),
  getBinCard: () => api.get('/inventory/bincard'),
  getBinCardIndex: (params) => api.get('/inventory/bincard-index', { params }),
  getBinCardDetail: (medicine_id) => api.get(`/inventory/bincard/${medicine_id}`),
  getWhatToBuy: () => api.get('/inventory/what-to-buy'),
  getMovements: () => api.get('/inventory/movements'),
  adjustStock: (data) => api.post('/inventory/adjust', data),
  adjustStockBulk: (data) => api.post('/inventory/adjust-bulk', data),
  getAlerts: () => api.get('/inventory/alerts')
};

export const salesAPI = {
  getAll: () => api.get('/sales'),
  getById: (id) => api.get(`/sales/${id}`),
  create: (data) => api.post('/sales', data),
  getDashboardStats: () => api.get('/sales/stats/dashboard')
};

export const suppliersAPI = {
  getAll: () => api.get('/suppliers'),
  getById: (id) => api.get(`/suppliers/${id}`),
  create: (data) => api.post('/suppliers', data),
  update: (id, data) => api.put(`/suppliers/${id}`, data)
};

export const usersAPI = {
  getAll: () => api.get('/users'),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  changeStatus: (id, status) => api.put(`/users/${id}/status`, { status }),
  resetPassword: (id, new_password) => api.put(`/users/${id}/reset-password`, { new_password })
};

export const categoriesAPI = {
  getAll: () => api.get('/categories'),
  create: (data) => api.post('/categories', data),
  update: (id, data) => api.put(`/categories/${id}`, data),
  addSubcategory: (category_id, data) => api.post(`/categories/${category_id}/subcategories`, data),
  updateSubcategory: (id, data) => api.put(`/categories/subcategories/${id}`, data)
};

export const settingsAPI = {
  getAll: () => api.get('/settings'),
  update: (key, value) => api.put(`/settings/${key}`, { value }),
  updateBatch: (settings) => api.post('/settings/batch', { settings })
};

export const reportsAPI = {
  getOverview: () => api.get('/reports/overview'),
  getSales: (params) => api.get('/reports/sales', { params }),
  getInventory: () => api.get('/reports/inventory'),
  getProfit: (params) => api.get('/reports/profit', { params }),
  getExpiry: (window) => api.get('/reports/expiry', { params: { window } }),
  getMovements: (params) => api.get('/reports/movements', { params }),
  getMoving: () => api.get('/reports/moving'),
  getUsers: () => api.get('/reports/users'),
  getAuditLogs: (params) => api.get('/audit-logs', { params })
};

export const aiAPI = {
  autofill: (name, dosage_form) => api.post('/ai/autofill', { name, dosage_form }),
  checkInteractions: (medicines) => api.post('/ai/check-interactions', { medicines }),
  generateCounseling: (items) => api.post('/ai/counseling', { items })
};

export const dataAPI = {
  seed: () => api.post('/data/seed'),
  clear: () => api.post('/data/clear')
};

export default api;
