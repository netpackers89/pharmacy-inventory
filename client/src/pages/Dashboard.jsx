import React, { useState, useEffect } from 'react';
import './Dashboard.css';
import {
  DollarSign, Users, AlertTriangle, TrendingUp,
  ChevronRight, ChevronLeft, ArrowUpRight, Package, Truck
} from 'lucide-react';
import { salesAPI, inventoryAPI, usersAPI } from '../services/api';
import { SalesAnalytics } from '../components/SalesAnalytics';
import { socket } from '../services/socket';
import { useTheme } from '../context/ThemeContext';
import { SkeletonCards } from '../components/Feedback';

export const Dashboard = ({ onNavigate }) => {
  const { theme } = useTheme();
  const [revenue, setRevenue] = useState(null);
  const [userCount, setUserCount] = useState(null);
  const [alertCount, setAlertCount] = useState(0);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [alertsData, setAlertsData] = useState({ nearExpiryItems: [], outOfStockItems: [] });
  const [fastMoving, setFastMoving] = useState([]);
  const [fastIndex, setFastIndex] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    salesAPI.getAll()
      .then(res => { if (!cancelled) setRevenue(res.data?.total_revenue ?? '0.00'); })
      .catch(() => { if (!cancelled) setRevenue('0.00'); });
    usersAPI.getCount()
      .then(res => { if (!cancelled) setUserCount(Number(res.data?.count ?? 0)); })
      .catch(() => { if (!cancelled) setUserCount(0); });
    inventoryAPI.getAlerts()
      .then(res => {
        if (cancelled) return;
        const data = res.data || {};
        setAlertCount((data.nearExpiryCount || 0) + (data.outOfStockCount || 0));
        setAlertsData({
          nearExpiryItems: data.nearExpiryItems || [],
          outOfStockItems: data.outOfStockItems || [],
        });
        setFastMoving(data.fastMoving || []);
        setAlertsLoaded(true);
      })
      .catch(() => { if (!cancelled) setAlertsLoaded(true); });

    const refresh = () => {
      setRefreshTick((t) => t + 1);
      salesAPI.getAll().then(res => setRevenue(res.data?.total_revenue ?? '0.00')).catch(() => {});
      inventoryAPI.getAlerts().then(res => {
        const data = res.data || {};
        setAlertCount((data.nearExpiryCount || 0) + (data.outOfStockCount || 0));
        setAlertsData({
          nearExpiryItems: data.nearExpiryItems || [],
          outOfStockItems: data.outOfStockItems || [],
        });
        setFastMoving(data.fastMoving || []);
        setAlertsLoaded(true);
      }).catch(() => {});
    };

    socket.connect();
    socket.on('data_updated', refresh);
    return () => {
      cancelled = true;
      socket.off('data_updated');
      socket.disconnect();
    };
  }, []);

  const statsLoading = revenue === null && userCount === null;

  return (
    <div className="dashboard-page">

      {/* ── PAGE HEADER ── */}
      <div className="page-header">
        <div className="page-title-group">
          <h1>Pharmacy Overview</h1>
          <p>Real-time analytics, alerts &amp; products</p>
        </div>
      </div>

      {/* ── STAT CARDS ── */}
      {statsLoading ? (
        <SkeletonCards count={3} />
      ) : (
        <div className="dashboard-grid" style={{ marginBottom: '1.25rem' }}>
          {/* Revenue */}
          <div className="stat-card stagger-item">
            <div className="stat-info">
              <span className="stat-label">Total Revenue</span>
              <div className="stat-value">ETB {revenue ?? '0.00'}</div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '2px', marginTop: '4px' }}>
                <ArrowUpRight size={12} /> All recorded sales
              </span>
            </div>
            <div className="stat-icon-wrapper" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--text-secondary)' }}>
              <DollarSign size={24} />
            </div>
          </div>

          {/* Users */}
          <div className="stat-card stagger-item">
            <div className="stat-info">
              <span className="stat-label">Active Users</span>
              <div className="stat-value">{userCount ?? 0}</div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: '4px', display: 'block' }}>Pharmacists &amp; Admins</span>
            </div>
            <div className="stat-icon-wrapper" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--text-secondary)' }}>
              <Users size={24} />
            </div>
          </div>

          {/* Alerts */}
          <div
            className="stat-card stagger-item"
            style={{ cursor: 'pointer' }}
            onClick={() => onNavigate && onNavigate('inventory')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onNavigate && onNavigate('inventory')}
            aria-label="View inventory alerts"
          >
            <div className="stat-info">
              <span className="stat-label">Inventory Alerts</span>
              <div
                className="stat-value"
                style={{
                  color: alertCount > 0
                    ? (theme === 'dark' ? '#f87171' : '#b91c1c')
                    : 'var(--text-main)',
                }}
              >
                {alertCount}
              </div>
              <span style={{ fontSize: '0.72rem', color: alertCount > 0 ? 'var(--danger)' : 'var(--text-faint)', fontWeight: 600, marginTop: '4px', display: 'block' }}>
                {alertsData.nearExpiryItems.length} Expiry · {alertsData.outOfStockItems.length} Low Stock
              </span>
            </div>
            <div
              className="stat-icon-wrapper"
              style={{
                backgroundColor: alertCount > 0 ? 'var(--danger-bg)' : 'var(--accent-subtle)',
                color: alertCount > 0 ? 'var(--danger)' : 'var(--text-secondary)',
              }}
            >
              <AlertTriangle size={24} />
            </div>
          </div>
        </div>
      )}

      {/* ── CHART + FAST MOVING ── */}
      <div className="dash-main-grid" style={{ marginBottom: '1.25rem' }}>
        {/* Sales analytics: Day / Week / Month / Year revenue (ETB) */}
        <div className="dash-panel">
          <SalesAnalytics height={210} refreshSignal={refreshTick} />
        </div>

        {/* Fast moving */}
        <div className="dash-panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
              <h3 className="dash-panel-title" style={{ fontSize: 'clamp(0.9rem, 3vw, 1.05rem)' }}>Fast Moving</h3>
              <TrendingUp size={18} style={{ color: 'var(--success)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {fastMoving.slice(fastIndex * 5, (fastIndex + 1) * 5).map((prod, i) => (
                <div key={`${prod.brand_name || prod.generic_name || 'item'}-${(fastIndex * 5) + i}`} className="dash-list-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong className="cell-truncate">{prod.brand_name || prod.generic_name}</strong>
                    <span className="dash-row-sub">{prod.category || 'General'}</span>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span className="dash-row-value">{prod.total_sold || 0}</span>
                    <span className="dash-row-unit">sold</span>
                  </div>
                </div>
              ))}
              {alertsLoaded && fastMoving.length === 0 && (
                <div className="empty-state" style={{ padding: '1.5rem 0.5rem' }}>
                  <div className="empty-state__desc">No sales data yet.</div>
                </div>
              )}
              {!alertsLoaded && fastMoving.length === 0 && (
                <div className="dash-list-row"><span className="skeleton skeleton-line" style={{ width: '80%' }} /></div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem' }}>
            <button
              onClick={() => setFastIndex(p => Math.max(0, p - 1))}
              disabled={fastIndex === 0}
              className="btn btn-ghost"
              style={{ flex: 1, border: '1px solid var(--border)' }}
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              onClick={() => setFastIndex(p => (p + 1) * 5 < fastMoving.length ? p + 1 : p)}
              disabled={(fastIndex + 1) * 5 >= fastMoving.length}
              className="btn btn-primary"
              style={{ flex: 1 }}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── QUICK ACTIONS ── */}
      <div className="dash-quick-actions">
        {[
          { page: 'pos', Icon: Package, title: 'Point of Sale', desc: 'Process sales & check interactions' },
          { page: 'drugs', Icon: TrendingUp, title: 'Drug Directory', desc: 'Register & manage medicines' },
          { page: 'suppliers', Icon: Truck, title: 'Supplier Directory', desc: 'Manage distributors & contacts' },
        ].map(item => (
          <div
            key={item.page}
            className="dash-action-card stagger-item"
            onClick={() => onNavigate && onNavigate(item.page)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter') && onNavigate && onNavigate(item.page)}
          >
            <div className="dash-action-icon"><item.Icon size={20} /></div>
            <div style={{ minWidth: 0 }}>
              <h4>{item.title}</h4>
              <p>{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
