import React, { useState, useEffect } from 'react';
import './Dashboard.css';
import {
  DollarSign, Users, AlertTriangle, TrendingUp,
  ChevronRight, ChevronLeft, ArrowUpRight, Package, Truck
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { salesAPI, inventoryAPI, usersAPI, dataAPI } from '../services/api';
import { socket } from '../services/socket';
import { useToast } from '../context/ToastContext';

export const Dashboard = ({ onNavigate }) => {
  const [revenue, setRevenue] = useState('0.00');
  const [userCount, setUserCount] = useState(3);
  const [alertCount, setAlertCount] = useState(0);
  const [alertsData, setAlertsData] = useState({ nearExpiryItems: [], outOfStockItems: [] });
  const [fastMoving, setFastMoving] = useState([]);
  const [fastIndex, setFastIndex] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);
  const { toast, withLoading } = useToast();

  const [chartData, setChartData] = useState([
    { day: 'Mon', sales: 0 }, { day: 'Tue', sales: 0 }, { day: 'Wed', sales: 0 },
    { day: 'Thu', sales: 0 }, { day: 'Fri', sales: 0 }, { day: 'Sat', sales: 0 }, { day: 'Sun', sales: 0 },
  ]);

  const fetchDashboardData = () => {
    salesAPI.getDashboardStats().then(res => setChartData(res.data?.chartData || chartData)).catch(() => {});
    salesAPI.getAll().then(res => setRevenue(res.data?.total_revenue || '0.00')).catch(() => {});
    usersAPI.getAll().then(res => setUserCount(res.data?.length || 0)).catch(() => {});
    inventoryAPI.getAlerts().then(res => {
      const data = res.data || {};
      setAlertCount((data.nearExpiryCount || 0) + (data.outOfStockCount || 0));
      setAlertsData({ nearExpiryItems: data.nearExpiryItems || [], outOfStockItems: data.outOfStockItems || [] });
      setFastMoving(data.fastMoving || [{ brand_name: 'Paracetamol', category: 'Analgesic', total_sold: 142 }]);
    }).catch(() => {});
  };

  useEffect(() => {
    fetchDashboardData();
    socket.connect();
    socket.on('data_updated', () => fetchDashboardData());
    return () => { socket.off('data_updated'); socket.disconnect(); };
  }, []);

  const handleSeed = async () => {
    setDataLoading(true);
    try { await dataAPI.seed(); toast.success('Data seeded!'); } catch { toast.error('Seeding failed.'); }
    setDataLoading(false);
  };

  const handleClear = async () => {
    setDataLoading(true);
    try { await dataAPI.clear(); toast.success('Data cleared!'); } catch { toast.error('Clearing failed.'); }
    setDataLoading(false);
  };

  return (
    <div className="dashboard-page" style={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>

      {/* ── PAGE HEADER ── */}
      <div className="page-header">
        <div className="page-title-group">
          <h1>Pharmacy Overview</h1>
          <p>Real-time analytics, alerts &amp; products</p>
        </div>
      </div>

      {/* ── 3 STAT CARDS — 1 col on mobile, 3 col on desktop ── */}
      <div className="dashboard-grid" style={{ marginBottom: '1.25rem' }}>
        {/* Revenue */}
        <div className="stat-card">
          <div className="stat-info">
            <span className="stat-label">Total Revenue</span>
            <div className="stat-value">${revenue}</div>
            <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '2px', marginTop: '4px' }}>
              <ArrowUpRight size={12} /> +12.4% vs last week
            </span>
          </div>
          <div className="stat-icon-wrapper" style={{ backgroundColor: '#dbeafe', color: '#2563eb' }}>
            <DollarSign size={24} />
          </div>
        </div>

        {/* Users */}
        <div className="stat-card">
          <div className="stat-info">
            <span className="stat-label">Active Users</span>
            <div className="stat-value">{userCount}</div>
            <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>Pharmacist &amp; Admin</span>
          </div>
          <div className="stat-icon-wrapper" style={{ backgroundColor: '#d1fae5', color: '#10b981' }}>
            <Users size={24} />
          </div>
        </div>

        {/* Alerts */}
        <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('inventory')}>
          <div className="stat-info">
            <span className="stat-label">Inventory Alerts</span>
            <div className="stat-value" style={{ color: alertCount > 0 ? '#ef4444' : '#1e293b' }}>
              {alertCount}
            </div>
            <span style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 600, marginTop: '4px', display: 'block' }}>
              {alertsData.nearExpiryItems.length} Expiry · {alertsData.outOfStockItems.length} Low Stock
            </span>
          </div>
          <div className="stat-icon-wrapper" style={{ backgroundColor: '#fee2e2', color: '#ef4444' }}>
            <AlertTriangle size={24} />
          </div>
        </div>
      </div>

      {/* ── SALES CHART — full width, stacks vertically on mobile ── */}
      <div className="dash-main-grid" style={{ marginBottom: '1.25rem' }}>
        {/* Chart */}
        <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontSize: 'clamp(0.95rem, 3vw, 1.1rem)', fontWeight: 800, color: '#0f172a' }}>Weekly Sales</h3>
              <p style={{ fontSize: '0.75rem', color: '#64748b' }}>Daily revenue tracking</p>
            </div>
            <span className="badge badge-primary">7-Day</span>
          </div>
          <div style={{ width: '100%', height: '200px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="day" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', border: 'none', color: '#fff', fontSize: '0.8rem' }}
                  formatter={val => [`$${val}`, 'Sales']}
                />
                <Line type="monotone" dataKey="sales" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4, fill: '#2563eb' }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Fast Moving */}
        <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
              <h3 style={{ fontSize: 'clamp(0.9rem, 3vw, 1.05rem)', fontWeight: 800, color: '#0f172a' }}>Fast Moving</h3>
              <TrendingUp size={18} color="#10b981" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {fastMoving.slice(fastIndex * 5, (fastIndex + 1) * 5).map((prod, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong style={{ display: 'block', fontSize: '0.85rem', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prod.brand_name || prod.generic_name}</strong>
                    <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{prod.category || 'General'}</span>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#2563eb' }}>{prod.total_sold || 0}</span>
                    <span style={{ fontSize: '0.62rem', display: 'block', color: '#64748b' }}>sold</span>
                  </div>
                </div>
              ))}
              {fastMoving.length === 0 && (
                <div style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>No data yet.</div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem' }}>
            <button
              onClick={() => setFastIndex(p => Math.max(0, p - 1))}
              disabled={fastIndex === 0}
              style={{ flex: 1, padding: '0.5rem', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: fastIndex === 0 ? 'not-allowed' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', opacity: fastIndex === 0 ? 0.5 : 1, fontSize: '0.82rem' }}
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              onClick={() => setFastIndex(p => (p + 1) * 5 < fastMoving.length ? p + 1 : p)}
              disabled={(fastIndex + 1) * 5 >= fastMoving.length}
              style={{ flex: 1, padding: '0.5rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', cursor: (fastIndex + 1) * 5 >= fastMoving.length ? 'not-allowed' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', opacity: (fastIndex + 1) * 5 >= fastMoving.length ? 0.5 : 1, fontSize: '0.82rem' }}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── QUICK ACTIONS — 1 col on mobile, 3 col on desktop ── */}
      <div className="dash-quick-actions">
        {[
          { page: 'pos', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', titleColor: '#1e3a8a', descColor: '#3b82f6', Icon: Package, title: 'Point of Sale', desc: 'Process sales & AI interactions' },
          { page: 'drugs', color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0', titleColor: '#065f46', descColor: '#059669', Icon: TrendingUp, title: 'Drug Directory', desc: '2-Step Add & AI auto-fill' },
          { page: 'suppliers', color: '#f97316', bg: '#fff7ed', border: '#fed7aa', titleColor: '#7c2d12', descColor: '#ea580c', Icon: Truck, title: 'Supplier Directory', desc: 'Manage distributors & imports' },
        ].map(item => (
          <div
            key={item.page}
            onClick={() => onNavigate && onNavigate(item.page)}
            style={{ padding: '1rem', backgroundColor: item.bg, border: `1px solid ${item.border}`, borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.85rem', transition: 'opacity 0.15s ease' }}
          >
            <div style={{ width: '42px', height: '42px', flexShrink: 0, borderRadius: '10px', backgroundColor: item.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <item.Icon size={20} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h4 style={{ fontWeight: 800, color: item.titleColor, fontSize: '0.9rem' }}>{item.title}</h4>
              <p style={{ fontSize: '0.76rem', color: item.descColor, marginTop: '1px' }}>{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
