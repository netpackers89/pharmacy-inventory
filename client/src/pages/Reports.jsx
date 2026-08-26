import React, { useState, useEffect } from 'react';
import './Reports.css';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import { reportsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  TrendingUp, Package, DollarSign, ShoppingBag,
  AlertTriangle, Activity, BarChart2, Users, Download, RefreshCw, Shield
} from 'lucide-react';

const TABS = [
  { id: 'overview', icon: <BarChart2 size={14}/>, label: 'Overview' },
  { id: 'sales', icon: <ShoppingBag size={14}/>, label: 'Sales' },
  { id: 'inventory', icon: <Package size={14}/>, label: 'Inventory' },
  { id: 'profit', icon: <DollarSign size={14}/>, label: 'Profit' },
  { id: 'expiry', icon: <AlertTriangle size={14}/>, label: 'Expiry' },
  { id: 'movements', icon: <Activity size={14}/>, label: 'Stock Movement' },
  { id: 'moving', icon: <TrendingUp size={14}/>, label: 'Fast / Slow' },
  { id: 'users', icon: <Users size={14}/>, label: 'Performance' },
  { id: 'audit', icon: <Shield size={14}/>, label: 'Audit Log' },
];

const fmt = (n) => parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '—';

export const Reports = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [activeTab, setActiveTab] = useState('overview');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));

  return (
    <div className="reports-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Reports</h1>
          <p>Detailed analytics, exports, and historical data</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="form-control" style={{ maxWidth: 170 }} aria-label="From date" />
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="form-control" style={{ maxWidth: 170 }} aria-label="To date" />
        </div>
      </div>

      {/* Tab Nav — Audit Log is ADMIN-only (enforced server-side too) */}
      <div className="reports-tabs">
        {TABS.filter(t => t.id !== 'audit' || isAdmin).map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`report-tab-btn ${activeTab === t.id ? 'active' : ''}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="reports-content">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'sales' && <SalesTab from={dateFrom} to={dateTo} />}
        {activeTab === 'inventory' && <InventoryTab />}
        {activeTab === 'profit' && <ProfitTab from={dateFrom} to={dateTo} />}
        {activeTab === 'expiry' && <ExpiryTab />}
        {activeTab === 'movements' && <MovementsTab from={dateFrom} to={dateTo} />}
        {activeTab === 'moving' && <MovingTab />}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'audit' && <AuditTab from={dateFrom} to={dateTo} />}
      </div>
    </div>
  );
};

// ─── SHARED ───────────────────────────────────────────────────────────────────
const KPICard = ({ icon, label, value, sub }) => (
  <div className="kpi-card">
    <div className="kpi-icon">{icon}</div>
    <div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  </div>
);

const Loading = () => (
  <div style={{ padding: '1.5rem 0' }} aria-busy="true">
    {[...Array(6)].map((_, i) => (
      <div key={i} style={{ display: 'flex', gap: '1rem', padding: '0.85rem 0', borderBottom: '1px solid var(--border)' }}>
        <span className="skeleton" style={{ width: '18%', height: '0.8rem' }} />
        <span className="skeleton" style={{ width: '30%', height: '0.8rem' }} />
        <span className="skeleton" style={{ width: '14%', height: '0.8rem', marginLeft: 'auto' }} />
      </div>
    ))}
  </div>
);

const ExportCSV = ({ data, filename }) => {
  const handleExport = () => {
    if (!data || !data.length) return;
    const keys = Object.keys(data[0]);
    const csv = [keys.join(','), ...data.map(row => keys.map(k => {
      const v = row[k] ?? '';
      return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
    }).join(','))].join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `net-pharma-${filename.replace(/\.csv$/, '')}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  return (
    <button onClick={handleExport} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}>
      <Download size={14} /> Export CSV
    </button>
  );
};

// Muted chart palette — readable on light and dark surfaces
const COLORS = ['#5b6472', '#15803d', '#a16207', '#b91c1c', '#334155'];
const OverviewTab = () => {
  const [data, setData] = useState(null);
  useEffect(() => { reportsAPI.getOverview().then(r => setData(r.data)).catch(() => {}); }, []);
  if (!data) return <Loading />;

  const statusData = [
    { name: 'Healthy', value: parseInt(data.inventory_status.healthy) },
    { name: 'Low Stock', value: parseInt(data.inventory_status.low_stock) },
    { name: 'Out of Stock', value: parseInt(data.inventory_status.out_of_stock) },
    { name: 'Expiring', value: data.inventory_status.expiring_soon },
    { name: 'Expired', value: data.inventory_status.expired },
  ].filter(d => d.value > 0);

  return (
    <div>
      <div className="kpi-grid">
        <KPICard icon={<DollarSign size={20}/>} label="Total Revenue" value={`ETB ${fmt(data.revenue)}`} />
        <KPICard icon={<TrendingUp size={20}/>} label="Gross Profit" value={`ETB ${fmt(data.gross_profit)}`} sub={`Margin: ${data.gross_margin}%`} />
        <KPICard icon={<ShoppingBag size={20}/>} label="Units Sold" value={data.units_sold?.toLocaleString()} color="#f59e0b" />
        <KPICard icon={<Package size={20}/>} label="Stock Value" value={`ETB ${fmt(data.stock_value)}`} color="#8b5cf6" />
      </div>

      <div className="reports-two-col">
        <div className="report-card">
          <h3 className="report-card-title">Top Selling Medicines</h3>
          <div>
            {data.top_medicines.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: COLORS[i] + '20', color: COLORS[i], fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem' }}>{i + 1}</span>
                <span style={{ flex: 1, fontWeight: 600, color: 'var(--text-main)' }}>{m.generic_name}</span>
                <span className="badge badge-primary">{m.units_sold} units</span>
              </div>
            ))}
            {data.top_medicines.length === 0 && <p style={{ color: '#94a3b8', textAlign: 'center', padding: '1.5rem' }}>No sales data yet.</p>}
          </div>
        </div>

        <div className="report-card">
          <h3 className="report-card-title">Inventory Health</h3>
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                  {statusData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p style={{ color: '#94a3b8', textAlign: 'center', padding: '2rem' }}>No inventory data.</p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
            {[
              { label: '🟢 Healthy', val: data.inventory_status.healthy },
              { label: '🟡 Low Stock', val: data.inventory_status.low_stock },
              { label: '🔴 Out of Stock', val: data.inventory_status.out_of_stock },
              { label: '🟠 Expiring Soon', val: data.inventory_status.expiring_soon },
              { label: '⚫ Expired', val: data.inventory_status.expired },
            ].map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#475569' }}>
                <span>{s.label}</span><strong>{s.val || 0}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── SALES ────────────────────────────────────────────────────────────────────
const SalesTab = ({ from, to }) => {
  const [data, setData] = useState(null);
  useEffect(() => { reportsAPI.getSales({ from, to }).then(r => setData(r.data)).catch(() => {}); }, [from, to]);
  if (!data) return <Loading />;
  const { summary, items } = data;

  return (
    <div>
      <div className="kpi-grid">
        <KPICard icon={<DollarSign size={20}/>} label="Total Revenue" value={`ETB ${fmt(summary.total_revenue)}`} />
        <KPICard icon={<ShoppingBag size={20}/>} label="Transactions" value={summary.transactions?.toString()} />
        <KPICard icon={<Package size={20}/>} label="Units Sold" value={summary.units_sold?.toString()} color="#f59e0b" />
        <KPICard icon={<TrendingUp size={20}/>} label="Avg. Sale" value={`ETB ${fmt(summary.avg_sale)}`} color="#8b5cf6" />
      </div>
      <div className="report-card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 className="report-card-title">Sales Detail</h3>
          <ExportCSV data={items} filename={`sales_${from}_${to}.csv`} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="custom-table">
            <thead><tr><th>Date</th><th>Medicine</th><th>Qty</th><th>Unit Price</th><th>Discount</th><th>Total</th><th>Pharmacist</th></tr></thead>
            <tbody>
              {items.slice(0, 100).map((row, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(row.sale_date)}</td>
                  <td><strong>{row.generic_name}</strong> {row.brand_name && <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>({row.brand_name})</span>}</td>
                  <td>{row.quantity}</td>
                  <td>ETB {fmt(row.sell_price)}</td>
                  <td>{fmt(row.discount)}</td>
                  <td><strong>ETB {fmt(row.total_price)}</strong></td>
                  <td>{row.pharmacist}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No sales data for this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── INVENTORY ────────────────────────────────────────────────────────────────
const InventoryTab = () => {
  const [data, setData] = useState(null);
  useEffect(() => { reportsAPI.getInventory().then(r => setData(r.data)).catch(() => {}); }, []);
  if (!data) return <Loading />;
  const { summary, items } = data;

  return (
    <div>
      <div className="kpi-grid">
        <KPICard icon={<Package size={20}/>} label="Total Medicines" value={summary.total_medicines?.toString()} />
        <KPICard icon={<DollarSign size={20}/>} label="Buy Value" value={`ETB ${fmt(summary.total_buy_value)}`} />
        <KPICard icon={<TrendingUp size={20}/>} label="Sell Value" value={`ETB ${fmt(summary.total_sell_value)}`} color="#f59e0b" />
      </div>
      <div className="report-card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 className="report-card-title">Inventory Details</h3>
          <ExportCSV data={items} filename="inventory_report.csv" />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="custom-table">
            <thead><tr><th>Medicine</th><th>Category</th><th>Batches</th><th>Stock</th><th>Buy Value</th><th>Sell Value</th><th>Status</th></tr></thead>
            <tbody>
              {items.map((row, i) => {
                const stock = parseInt(row.total_stock);
                const statusLabel = stock === 0 ? '🔴 Out' : stock <= 10 ? '🟡 Low' : '🟢 OK';
                return (
                  <tr key={i}>
                    <td><strong>{row.generic_name}</strong> {row.brand_name && <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>({row.brand_name})</span>}<br/><span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{row.strength}</span></td>
                    <td>{row.category || '—'}</td>
                    <td>{row.batches}</td>
                    <td><strong>{stock}</strong></td>
                    <td>ETB {fmt(row.buy_value)}</td>
                    <td>ETB {fmt(row.sell_value)}</td>
                    <td>{statusLabel}</td>
                  </tr>
                );
              })}
              {items.length === 0 && <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No data.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── PROFIT ───────────────────────────────────────────────────────────────────
const ProfitTab = ({ from, to }) => {
  const [data, setData] = useState(null);
  useEffect(() => { reportsAPI.getProfit({ from, to }).then(r => setData(r.data)).catch(() => {}); }, [from, to]);
  if (!data) return <Loading />;

  const chartData = [
    { name: 'Revenue', value: parseFloat(data.revenue) },
    { name: 'COGS', value: parseFloat(data.cogs) },
    { name: 'Gross Profit', value: parseFloat(data.gross_profit) },
  ];

  return (
    <div>
      <div className="kpi-grid">
        <KPICard icon={<DollarSign size={20}/>} label="Revenue" value={`ETB ${fmt(data.revenue)}`} />
        <KPICard icon={<DollarSign size={20}/>} label="Cost of Goods Sold" value={`ETB ${fmt(data.cogs)}`} />
        <KPICard icon={<TrendingUp size={20}/>} label="Gross Profit" value={`ETB ${fmt(data.gross_profit)}`} />
        <KPICard icon={<BarChart2 size={20}/>} label="Gross Margin" value={`${data.gross_margin}%`} color="#8b5cf6" />
      </div>

      <div className="reports-two-col" style={{ marginTop: '1.5rem' }}>
        <div className="report-card">
          <h3 className="report-card-title">Revenue vs Cost vs Profit</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={v => `ETB ${fmt(v)}`} />
              <Bar dataKey="value" fill="var(--text-main, #16181d)" radius={[4,4,0,0]}>
                {chartData.map((_, i) => <Cell key={i} fill={[COLORS[0], COLORS[3], COLORS[1]][i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="report-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 className="report-card-title">Most Profitable Medicines</h3>
            <ExportCSV data={data.by_medicine} filename={`profit_${from}_${to}.csv`} />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table">
              <thead><tr><th>Medicine</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th></tr></thead>
              <tbody>
                {data.by_medicine.map((row, i) => {
                  const margin = parseFloat(row.revenue) > 0 ? ((parseFloat(row.profit) / parseFloat(row.revenue)) * 100).toFixed(1) : 0;
                  return (
                    <tr key={i}>
                      <td><strong>{row.generic_name}</strong></td>
                      <td>{fmt(row.revenue)}</td>
                      <td>{fmt(row.cost)}</td>
                      <td><strong style={{ color: 'var(--success)' }}>{fmt(row.profit)}</strong></td>
                      <td><span className="badge badge-secondary">{margin}%</span></td>
                    </tr>
                  );
                })}
                {data.by_medicine.length === 0 && <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No data yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── EXPIRY ───────────────────────────────────────────────────────────────────
const ExpiryTab = () => {
  const [window, setWindow] = useState('90');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = (w) => {
    setLoading(true);
    reportsAPI.getExpiry(w).then(r => { setItems(r.data); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(() => { load(window); }, [window]);

  const getStatus = (days) => {
    if (days < 0) return { label: '🔴 Expired', color: 'var(--danger)' };
    if (days <= 30) return { label: '🟠 < 30 days', color: '#f97316' };
    if (days <= 90) return { label: '🟡 < 90 days', color: '#f59e0b' };
    return { label: '🟢 Safe', color: 'var(--success)' };
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {[{ v: 'expired', l: 'Expired' }, { v: '30', l: '< 30 Days' }, { v: '60', l: '< 60 Days' }, { v: '90', l: '< 90 Days' }, { v: 'all', l: 'All Batches' }].map(o => (
          <button key={o.v} onClick={() => setWindow(o.v)}
            className={`pill-toggle ${window === o.v ? 'active' : ''}`}>
            {o.l}
          </button>
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <ExportCSV data={items} filename={`expiry_${window}.csv`} />
        </div>
      </div>
      {loading ? <Loading /> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="custom-table">
            <thead><tr><th>Medicine</th><th>Batch No</th><th>Supplier</th><th>Expiry Date</th><th>Days Left</th><th>Stock Qty</th><th>Value</th><th>Status</th></tr></thead>
            <tbody>
              {items.map((row, i) => {
                const s = getStatus(parseInt(row.days_left));
                return (
                  <tr key={i}>
                    <td><strong>{row.generic_name}</strong></td>
                    <td><span className="badge badge-info">{row.batch_number}</span></td>
                    <td>{row.supplier || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', color: parseInt(row.days_left) < 0 ? 'var(--danger)' : 'inherit' }}>{fmtDate(row.expiry_date)}</td>
                    <td><strong style={{ color: s.color }}>{parseInt(row.days_left) < 0 ? `${Math.abs(row.days_left)} days ago` : `${row.days_left} days`}</strong></td>
                    <td>{row.stock_quantity}</td>
                    <td>ETB {fmt(row.value)}</td>
                    <td><span style={{ color: s.color, fontWeight: 700 }}>{s.label}</span></td>
                  </tr>
                );
              })}
              {items.length === 0 && <tr><td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No batches in this range.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── MOVEMENTS ────────────────────────────────────────────────────────────────
const MovementsTab = ({ from, to }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    reportsAPI.getMovements({ from, to }).then(r => { setItems(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, [from, to]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <ExportCSV data={items} filename={`movements_${from}_${to}.csv`} />
      </div>
      {loading ? <Loading /> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="custom-table">
            <thead><tr><th>Date</th><th>Type</th><th>Medicine (Batch)</th><th>In</th><th>Out</th><th>Balance</th><th>User</th><th>Notes</th></tr></thead>
            <tbody>
              {items.map((row, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{new Date(row.movement_date).toLocaleString()}</td>
                  <td><span className={`badge ${row.movement_type === 'SALE' ? 'badge-primary' : row.movement_type === 'RESUPPLY' ? 'badge-success' : 'badge-warning'}`}>{row.movement_type}</span></td>
                  <td>{row.generic_name} <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>({row.batch_number})</span></td>
                  <td><strong style={{ color: 'var(--success)' }}>{row.stock_in > 0 ? `+${row.stock_in}` : '—'}</strong></td>
                  <td><strong style={{ color: 'var(--danger)' }}>{row.stock_out > 0 ? `-${row.stock_out}` : '—'}</strong></td>
                  <td>{row.balance}</td>
                  <td>{row.user_name}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{row.notes}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No movements in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── FAST / SLOW MOVING ───────────────────────────────────────────────────────
const MovingTab = () => {
  const [data, setData] = useState(null);
  const [subTab, setSubTab] = useState('fast');
  useEffect(() => { reportsAPI.getMoving().then(r => setData(r.data)).catch(() => {}); }, []);
  if (!data) return <Loading />;

  const list = data[subTab] || [];

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {[{ v: 'fast', l: '🚀 Fast Moving' }, { v: 'slow', l: '🐌 Slow Moving' }, { v: 'dead', l: '⚫ Dead Stock' }].map(o => (
          <button key={o.v} onClick={() => setSubTab(o.v)}
            className={`pill-toggle ${subTab === o.v ? 'active' : ''}`}>
            {o.l}
          </button>
        ))}
        <div style={{ marginLeft: 'auto' }}><ExportCSV data={list} filename={`${subTab}_moving.csv`} /></div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="custom-table">
          <thead><tr><th>Rank</th><th>Medicine</th><th>Units Sold</th><th>Current Stock</th><th>Last Sale</th><th>Days Since Sale</th></tr></thead>
          <tbody>
            {list.map((row, i) => (
              <tr key={i}>
                <td><span style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--accent-subtle)', color: 'var(--text-secondary)', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem' }}>{i+1}</span></td>
                <td><strong>{row.generic_name}</strong> {row.brand_name && <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>({row.brand_name})</span>}</td>
                <td><strong>{row.units_sold}</strong></td>
                <td>{row.current_stock}</td>
                <td>{row.last_sale_date ? fmtDate(row.last_sale_date) : '—'}</td>
                <td>{row.days_since_sale != null ? `${row.days_since_sale} days` : '—'}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No data for this category.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── USER PERFORMANCE ─────────────────────────────────────────────────────────
const UsersTab = () => {
  const [users, setUsers] = useState([]);
  useEffect(() => { reportsAPI.getUsers().then(r => setUsers(r.data)).catch(() => {}); }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontWeight: 800 }}>Employee Sales Performance</h3>
        <ExportCSV data={users} filename="employee_performance.csv" />
      </div>
      {users.length > 0 && (
        <div className="report-card" style={{ marginBottom: '1.5rem' }}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={users} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="full_name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={v => `ETB ${fmt(v)}`} />
              <Bar dataKey="revenue" fill="var(--text-main, #16181d)" radius={[4,4,0,0]} name="Revenue (ETB)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="custom-table">
          <thead><tr><th>Employee</th><th>Username</th><th>Role</th><th>Transactions</th><th>Units Sold</th><th>Revenue (ETB)</th></tr></thead>
          <tbody>
            {users.map((row, i) => (
              <tr key={i}>
                <td><strong>{row.full_name}</strong></td>
                <td style={{ color: 'var(--text-muted)' }}>{row.username}</td>
                <td><span className={`badge ${row.role === 'ADMIN' ? 'badge-primary' : 'badge-secondary'}`}>{row.role}</span></td>
                <td>{row.transactions}</td>
                <td>{row.units_sold}</td>
                <td><strong>ETB {fmt(row.revenue)}</strong></td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No data.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────
const AuditTab = ({ from, to }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState('');
  
  const load = () => {
    setLoading(true);
    reportsAPI.getAuditLogs({ from, to, action: actionFilter || undefined })
      .then(r => {
        // Structured response: { success, data, pagination }
        setItems(Array.isArray(r.data?.data) ? r.data.data : Array.isArray(r.data) ? r.data : []);
        setLoading(false);
      })
      .catch(() => { setItems([]); setLoading(false); });
  };
  
  useEffect(() => { load(); }, [from, to, actionFilter]);
  
  const ACTION_COLORS = {
    CREATE: '#15803d',
    MEDICINE_CREATED: '#15803d',
    STOCK_RECEIVED: '#8b5cf6',
    UPDATE: '#f59e0b',
    MEDICINE_UPDATED: '#f59e0b',
    DELETE: '#b91c1c',
    SALE: '#5b6472',
    SALE_CREATED: '#5b6472',
    SALE_FAILED: '#b91c1c',
    CONTROLLED_SALE: '#b91c1c',
    RESUPPLY: '#8b5cf6',
    ADJUSTMENT: '#f97316',
    PHYSICAL_COUNT: '#f97316',
    LOGIN: '#64748b',
    LOGOUT: '#64748b',
    LOGIN_BLOCKED: '#b91c1c',
    ACCOUNT_LOCKED: '#b91c1c',
    AUTHZ_DENIED: '#b91c1c',
    SESSION_REVOKED: '#b91c1c',
  };
  
  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
          style={{ padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }}>
          <option value=''>All Actions</option>
          <option value='CREATE'>CREATE</option>
          <option value='UPDATE'>UPDATE</option>
          <option value='DELETE'>DELETE</option>
          <option value='SALE'>SALE</option>
          <option value='RESUPPLY'>RESUPPLY</option>
          <option value='ADJUSTMENT'>ADJUSTMENT</option>
        </select>
        <div style={{ marginLeft: 'auto' }}><ExportCSV data={items} filename={`audit_log_${from}_${to}.csv`} /></div>
      </div>
      {loading ? <Loading /> : (
        <div style={{ overflowX: 'auto' }}>
          <table className='custom-table'>
            <thead><tr><th>Date / Time</th><th>User</th><th>Action</th><th>Entity</th><th>ID</th><th>Description</th></tr></thead>
            <tbody>
              {items.map((row, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{new Date(row.timestamp).toLocaleString()}</td>
                  <td><strong>{row.full_name || row.username || 'System'}</strong><br/><span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{row.username}</span></td>
                  <td><span style={{ padding: '0.25rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, background: (ACTION_COLORS[row.action] || '#64748b') + '20', color: ACTION_COLORS[row.action] || '#64748b' }}>{row.action}</span></td>
                  <td>{row.entity_type}</td>
                  <td>{row.entity_id || '—'}</td>
                  <td style={{ maxWidth: '300px', fontSize: '0.82rem', color: '#475569' }}>{row.description || '—'}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan='6' style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No audit events in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
