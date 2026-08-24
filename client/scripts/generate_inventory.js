const fs = require('fs');

const output = `import React, { useState, useEffect } from 'react';
import './Inventory.css';
import { Boxes, FileText, Activity, Plus, Edit, CheckSquare, Download, Search, ArrowLeft, Printer, ShoppingCart } from 'lucide-react';
import { inventoryAPI, medicinesAPI, suppliersAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const ExportCSV = ({ data, filename }) => {
  const handleExport = () => {
    if (!data || !data.length) return;
    const keys = Object.keys(data[0]);
    const csvContent = [
      keys.join(','),
      ...data.map(row => keys.map(k => {
        let val = row[k] === null || row[k] === undefined ? '' : row[k];
        return '"' + String(val).replace(/"/g, '""') + '"';
      }).join(','))
    ].join('\\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename || 'export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  return (
    <button onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, color: '#475569' }}>
      <Download size={16} /> Export
    </button>
  );
};

export const Inventory = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('stock'); 
  
  const [stockList, setStockList] = useState([]);
  const [movements, setMovements] = useState([]);
  const [binCardIndex, setBinCardIndex] = useState([]);
  const [whatToBuy, setWhatToBuy] = useState([]);
  const [loading, setLoading] = useState(false);
  const [medicines, setMedicines] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  
  const [isAddStockModalOpen, setIsAddStockModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [physicalCount, setPhysicalCount] = useState('');

  const [stockForm, setStockForm] = useState({
    medicine_id: '',
    supplier_id: '',
    batch_number: '',
    batch_barcode: '',
    batch_qr_code: '',
    expiry_date: '',
    quantity: '',
    buy_price: '',
    sell_price: ''
  });

  // Bin Card States
  const [selectedBinCardMedicine, setSelectedBinCardMedicine] = useState(null);
  const [binCardDetail, setBinCardDetail] = useState(null);
  const [binSearch, setBinSearch] = useState('');
  const [binFilter, setBinFilter] = useState('ALL');

  const loadData = () => {
    setLoading(true);
    if (activeTab === 'stock') {
      inventoryAPI.getStock().then(res => { setStockList(res.data); setLoading(false); }).catch(() => setLoading(false));
    } else if (activeTab === 'bincard') {
      if (!selectedBinCardMedicine) {
        inventoryAPI.getBinCardIndex({ search: binSearch, filter: binFilter }).then(res => { setBinCardIndex(res.data); setLoading(false); }).catch(() => setLoading(false));
      } else {
        inventoryAPI.getBinCardDetail(selectedBinCardMedicine.medicine_id).then(res => { setBinCardDetail(res.data); setLoading(false); }).catch(() => setLoading(false));
      }
    } else if (activeTab === 'movements') {
      inventoryAPI.getMovements().then(res => { setMovements(res.data); setLoading(false); }).catch(() => setLoading(false));
    } else if (activeTab === 'whatToBuy') {
      inventoryAPI.getWhatToBuy().then(res => { setWhatToBuy(res.data); setLoading(false); }).catch(() => setLoading(false));
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab, binSearch, binFilter, selectedBinCardMedicine]);

  useEffect(() => {
    medicinesAPI.getAll().then(res => setMedicines(res.data)).catch(() => {});
    suppliersAPI.getAll().then(res => setSuppliers(res.data)).catch(() => {});
  }, []);

  const handleAddStockSubmit = async (e) => {
    e.preventDefault();
    try {
      await inventoryAPI.addStock({
        ...stockForm,
        user_id: user?.id || 1
      });
      setIsAddStockModalOpen(false);
      alert('Stock added successfully');
      loadData();
      setStockForm({
        medicine_id: '', supplier_id: '', batch_number: '', batch_barcode: '', batch_qr_code: '', expiry_date: '', quantity: '', buy_price: '', sell_price: ''
      });
    } catch (err) {
      alert('Failed to add stock: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleAdjustStockSubmit = async (e) => {
    e.preventDefault();
    try {
      await inventoryAPI.adjustStock({
        batch_id: selectedBatch.batch_id,
        physical_count: parseInt(physicalCount, 10),
        user_id: user?.id || 1
      });
      setIsAdjustModalOpen(false);
      alert('Stock adjusted successfully');
      loadData();
    } catch (err) {
      alert('Failed to adjust stock: ' + (err.response?.data?.error || err.message));
    }
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '—';
  
  const tabs = [
    { id: 'stock', icon: <Boxes size={14} />, label: 'Stock List' },
    { id: 'bincard', icon: <FileText size={14} />, label: 'Bin Cards' },
    { id: 'movements', icon: <Activity size={14} />, label: 'Movements History' },
    { id: 'whatToBuy', icon: <ShoppingCart size={14} />, label: '🛒 What to Buy' },
  ];

  return (
    <div className="inventory-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Inventory</h1>
          <p>Manage physical stock, batches, and discrepancies</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-scan" style={{ background: '#2563eb' }} onClick={() => setIsAddStockModalOpen(true)}>
            <Plus size={16} />
            <span className="btn-scan-label">Add Stock (New Batch)</span>
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '2px solid #e2e8f0', marginBottom: '1.25rem', overflowX: 'auto' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => { setActiveTab(t.id); setSelectedBinCardMedicine(null); }} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.6rem 0.9rem', border: 'none', background: 'none', cursor: 'pointer', borderBottom: activeTab === t.id ? '3px solid #2563eb' : '3px solid transparent', color: activeTab === t.id ? '#2563eb' : '#64748b', fontWeight: 700, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="table-container">
        {loading ? (
          <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Loading...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            {activeTab === 'stock' && (
              <table className="custom-table">
                <thead>
                  <tr><th>Drug Name</th><th>Strength</th><th>Total Stock On Hand</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {stockList.map(item => (
                    <tr key={item.medicine_id}>
                      <td><strong>{item.generic_name}</strong> {item.brand_name && \`(\${item.brand_name})\`}</td>
                      <td>{item.strength}</td>
                      <td><span className={\`badge \${item.stock_on_hand == 0 ? 'badge-danger' : 'badge-secondary'}\`}>{item.stock_on_hand}</span></td>
                      <td>{item.status}</td>
                    </tr>
                  ))}
                  {stockList.length === 0 && <tr><td colSpan="4" style={{ textAlign: 'center' }}>No stock data.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
`;

fs.writeFileSync('/home/netsanetdesta/Downloads/pharmacy-inventory-main/pharmacy-inventory-main/client/src/pages/Inventory.jsx', output);
console.log('Done Inventory.jsx');