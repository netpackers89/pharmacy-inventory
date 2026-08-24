import React, { useState, useEffect } from 'react';
import './Reports.css';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import { reportsAPI } from '../services/api';
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
            style={{ padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }} />
          <span style={{ color: '#64748b', fontWeight: 600 }}>to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={{ padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }} />
        </div>
      </div>

      {/* Tab Nav */}
      <div className="reports-tabs">
        {TABS.map(t => (
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
const KPICard = ({ icon, label, value, sub, color }) => (
  <div className="kpi-card" style={{ borderTop: `3px solid ${color}` }}>
    <div className="kpi-icon" style={{ background: color + '20', color }}>{icon}</div>
    <div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  </div>
);

const Loading = () => <div style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}><RefreshCw size={24} style={{ animation: 'spin 1s linear infinite' }} /><p>Loading...</p></div>;

const ExportCSV = ({ data, filename }) => {
  const handleExport = () => {
    if (!data || !data.length) return;
    const keys = Object.keys(data[0]);
    const csv = [keys.join(','), ...data.map(row => keys.map(k => `"${row[k] ?? ''}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.5rem 0.9rem', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700 }}>
      <Download size={14} /> Export CSV
    </button>
  );
};

// ─── OVERVIEW ─────────────────────────────────────────────────────────────────
const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
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
        <KPICard icon={<DollarSign size={20}/>} label="Total Revenue" value={`ETB ${fmt(data.revenue)}`} color="#2563eb" />
        <KPICard icon={<TrendingUp size={20}/>} label="Gross Profit" value={`ETB ${fmt(data.gross_profit)}`} sub={`Margin: ${data.gross_margin}%`} color="#10b981" />
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
                <span style={{ flex: 1, fontWeight: 600, color: '#0f172a' }}>{m.generic_name}</span>
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
        <KPICard icon={<DollarSign size={20}/>} label="Total Revenue" value={`ETB ${fmt(summary.total_revenue)}`} color="#2563eb" />
        <KPICard icon={<ShoppingBag size={20}/>} label="Transactions" value={summary.transactions?.toString()} color="#10b981" />
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
        <KPICard icon={<Package size={20}/>} label="Total Medicines" value={summary.total_medicines?.toString()} color="#2563eb" />
        <KPICard icon={<DollarSign size={20}/>} label="Buy Value" value={`ETB ${fmt(summary.total_buy_value)}`} color="#10b981" />
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
                    <td><strong>{row.generic_name}</strong> {row.brand_name && <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>({row.brand_name})</span>}<br/><span style={{ fontSize: '0.75rem', color: '#64748b' }}>{row.strength}</span></td>
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
        <KPICard icon={<DollarSign size={20}/>} label="Revenue" value={`ETB ${fmt(data.revenue)}`} color="#2563eb" />
        <KPICard icon={<DollarSign size={20}/>} label="Cost of Goods Sold" value={`ETB ${fmt(data.cogs)}`} color="#ef4444" />
        <KPICard icon={<TrendingUp size={20}/>} label="Gross Profit" value={`ETB ${fmt(data.gross_profit)}`} color="#10b981" />
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
              <Bar dataKey="value" fill="#2563eb" radius={[4,4,0,0]}>
                {chartData.map((_, i) => <Cell key={i} fill={['#2563eb','#ef4444','#10b981'][i]} />)}
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
                      <td><strong style={{ color: '#10b981' }}>{fmt(row.profit)}</strong></td>
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
    if (days < 0) return { label: '🔴 Expired', color: '#ef4444' };
    if (days <= 30) return { label: '🟠 < 30 days', color: '#f97316' };
    if (days <= 90) return { label: '🟡 < 90 days', color: '#f59e0b' };
    return { label: '🟢 Safe', color: '#10b981' };
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {[{ v: 'expired', l: 'Expired' }, { v: '30', l: '< 30 Days' }, { v: '60', l: '< 60 Days' }, { v: '90', l: '< 90 Days' }, { v: 'all', l: 'All Batches' }].map(o => (
          <button key={o.v} onClick={() => setWindow(o.v)}
            style={{ padding: '0.5rem 1rem', borderRadius: '20px', border: '1px solid', borderColor: window === o.v ? '#2563eb' : '#e2e8f0', background: window === o.v ? '#2563eb' : 'white', color: window === o.v ? 'white' : '#64748b', fontWeight: 700, cursor: 'pointer', fontSize: '0.82rem' }}>
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
                    <td style={{ whiteSpace: 'nowrap', color: parseInt(row.days_left) < 0 ? '#ef4444' : 'inherit' }}>{fmtDate(row.expiry_date)}</td>
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
                  <td><strong style={{ color: '#10b981' }}>{row.stock_in > 0 ? `+${row.stock_in}` : '—'}</strong></td>
                  <td><strong style={{ color: '#ef4444' }}>{row.stock_out > 0 ? `-${row.stock_out}` : '—'}</strong></td>
                  <td>{row.balance}</td>
                  <td>{row.user_name}</td>
                  <td style={{ fontSize: '0.78rem', color: '#64748b' }}>{row.notes}</td>
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
            style={{ padding: '0.55rem 1rem', borderRadius: '20px', border: '1px solid', borderColor: subTab === o.v ? '#2563eb' : '#e2e8f0', background: subTab === o.v ? '#2563eb' : 'white', color: subTab === o.v ? 'white' : '#64748b', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}>
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
                <td><span style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#eff6ff', color: '#2563eb', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem' }}>{i+1}</span></td>
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
              <Bar dataKey="revenue" fill="#2563eb" radius={[4,4,0,0]} name="Revenue (ETB)" />
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
                <td style={{ color: '#64748b' }}>{row.username}</td>
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
      .then(r => { setItems(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  };
  
  useEffect(() => { load(); }, [from, to, actionFilter]);
  
  const ACTION_COLORS = {
    CREATE: '#10b981',
    UPDATE: '#f59e0b',
    DELETE: '#ef4444',
    SALE: '#2563eb',
    RESUPPLY: '#8b5cf6',
    ADJUSTMENT: '#f97316',
    LOGIN: '#64748b',
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
