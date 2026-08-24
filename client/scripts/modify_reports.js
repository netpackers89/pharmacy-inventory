const fs = require('fs');

const file = '/home/netsanetdesta/Downloads/pharmacy-inventory-main/pharmacy-inventory-main/client/src/pages/Reports.jsx';
let content = fs.readFileSync(file, 'utf8');

// Add Shield to imports
content = content.replace(
  "AlertTriangle, Activity, BarChart2, Users, Download, RefreshCw",
  "AlertTriangle, Activity, BarChart2, Users, Download, RefreshCw, Shield"
);

// Add to TABS array
content = content.replace(
  "{ id: 'users', icon: <Users size={14}/>, label: 'Performance' },",
  "{ id: 'users', icon: <Users size={14}/>, label: 'Performance' },\n  { id: 'audit', icon: <Shield size={14}/>, label: 'Audit Log' },"
);

// Add rendering
content = content.replace(
  "{activeTab === 'users' && <UsersTab />}",
  "{activeTab === 'users' && <UsersTab />}\n        {activeTab === 'audit' && <AuditTab from={dateFrom} to={dateTo} />}"
);

// Add AuditTab component
const auditTabCode = `
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
`;

content += auditTabCode;

fs.writeFileSync(file, content, 'utf8');
console.log('Done Reports.jsx');
