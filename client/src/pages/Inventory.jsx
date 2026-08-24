import React, { useState, useEffect } from 'react';
import './Inventory.css';
import { Boxes, FileText, Activity, Plus, Edit, CheckSquare, Download, Search, ArrowLeft, Printer, ShoppingCart } from 'lucide-react';
import { inventoryAPI, medicinesAPI, suppliersAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

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
    ].join('\n');
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
  const { toast, withLoading } = useToast();
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
  const [stockBinCardView, setStockBinCardView] = useState(false);
  const [fullStockCountModalOpen, setFullStockCountModalOpen] = useState(false);
  const [fullStockCountRows, setFullStockCountRows] = useState([]);

  const [stockForm, setStockForm] = useState({
    medicine_id: '',
    supplier_id: '',
    batch_number: '',
    barcode: '',
    qr_code: '',
    abc_category: '',
    ven_category: '',
    expiry_date: '',
    quantity: '',
    buy_price: '',
    sell_price: ''
  });

  const [selectedBatchFilter, setSelectedBatchFilter] = useState('ALL');

  // Bin Card States
  const [selectedBinCardMedicine, setSelectedBinCardMedicine] = useState(null);
  const [binCardDetail, setBinCardDetail] = useState(null);

  const loadData = () => {
    setLoading(true);
    if (activeTab === 'stock') {
      if (stockBinCardView && selectedBinCardMedicine) {
        inventoryAPI.getBinCardDetail(selectedBinCardMedicine.medicine_id)
          .then(res => { setBinCardDetail(res.data); setLoading(false); })
          .catch((err) => {
            toast.error('Failed to load bin card: ' + (err.response?.data?.error || err.message));
            setSelectedBinCardMedicine(null);
            setStockBinCardView(false);
            setLoading(false);
          });
      } else {
        inventoryAPI.getStock().then(res => { setStockList(res.data); setLoading(false); }).catch(() => setLoading(false));
      }
    } else if (activeTab === 'movements') {
      inventoryAPI.getMovements().then(res => { setMovements(res.data); setLoading(false); }).catch(() => setLoading(false));
    } else if (activeTab === 'whatToBuy') {
      inventoryAPI.getWhatToBuy().then(res => { setWhatToBuy(res.data); setLoading(false); }).catch(() => setLoading(false));
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab, selectedBinCardMedicine, stockBinCardView]);

  useEffect(() => {
    medicinesAPI.getAll().then(res => setMedicines(res.data)).catch(() => {});
    suppliersAPI.getAll().then(res => setSuppliers(res.data)).catch(() => {});
  }, []);

  const handleAddStockSubmit = async (e) => {
    e.preventDefault();
    if (!stockForm.barcode && !stockForm.qr_code) {
      toast.warning('At least one of Barcode or QR Code is required.');
      return;
    }
    try {
      await withLoading(
        () => inventoryAPI.addStock({
          ...stockForm,
          user_id: user?.id || 1
        }),
        { loadingMsg: 'Adding stock...', successMsg: 'Stock added successfully' }
      );
      setIsAddStockModalOpen(false);
      loadData();
      setStockForm({
        medicine_id: '', supplier_id: '', batch_number: '', barcode: '', qr_code: '', abc_category: '', ven_category: '', expiry_date: '', quantity: '', buy_price: '', sell_price: ''
      });
    } catch (err) {
      toast.error('Failed to add stock: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleAdjustStockSubmit = async (e) => {
    e.preventDefault();
    try {
      await withLoading(
        () => inventoryAPI.adjustStock({
          batch_id: selectedBatch.batch_id,
          physical_count: parseInt(physicalCount, 10),
          user_id: user?.id || 1
        }),
        { loadingMsg: 'Adjusting stock...', successMsg: 'Stock adjusted successfully' }
      );
      setIsAdjustModalOpen(false);
      loadData();
    } catch (err) {
      toast.error('Failed to adjust stock: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleOpenFullStockCount = async () => {
    try {
      const res = await inventoryAPI.getBinCard();
      const rows = (res.data || []).map(batch => ({
        batch_id: batch.batch_id,
        medicine_name: batch.drug_name,
        batch_number: batch.batch_number,
        system_quantity: Number(batch.stock_quantity || 0),
        physical_quantity: Number(batch.stock_quantity || 0),
        difference: 0,
        status: 'MATCH'
      }));
      setFullStockCountRows(rows);
      setFullStockCountModalOpen(true);
    } catch (err) {
      toast.error('Failed to load full stock count: ' + (err.response?.data?.error || err.message));
    }
  };

  const updateFullStockCountRow = (batchId, value) => {
    const physicalQuantity = Number(value || 0);
    setFullStockCountRows(prev => prev.map(row => {
      if (row.batch_id !== batchId) return row;
      const difference = physicalQuantity - row.system_quantity;
      return {
        ...row,
        physical_quantity: physicalQuantity,
        difference,
        status: difference === 0 ? 'MATCH' : difference > 0 ? 'OVER' : 'DIFFERENCE'
      };
    }));
  };

  const handleFullStockCountSubmit = async (e) => {
    e.preventDefault();
    if (!fullStockCountRows.length) return;

    try {
      await withLoading(
        () => inventoryAPI.adjustStockBulk({
          adjustments: fullStockCountRows.map(row => ({
            batch_id: row.batch_id,
            physical_count: Number(row.physical_quantity)
          })),
          user_id: user?.id || 1
        }),
        { loadingMsg: 'Saving full stock count...', successMsg: 'Stock count saved as adjustment entries' }
      );
      setFullStockCountModalOpen(false);
      setFullStockCountRows([]);
      loadData();
    } catch (err) {
      toast.error('Failed to save full stock count: ' + (err.response?.data?.error || err.message));
    }
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '—';
  
  const tabs = [
    { id: 'stock', icon: <Boxes size={14} />, label: 'Stock List' },
    { id: 'movements', icon: <Activity size={14} />, label: 'Historys' },
    { id: 'whatToBuy', icon: <ShoppingCart size={14} />, label: 'What to Buy' },
  ];

  return (
    <div className="inventory-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Inventory</h1>
          <p>Manage physical stock, batches, and discrepancies</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn-scan" style={{ background: '#2563eb' }} onClick={() => setIsAddStockModalOpen(true)}>
            <Plus size={16} />
            <span className="btn-scan-label">Add Stock (New Batch)</span>
          </button>
          <button className="btn-scan" style={{ background: '#f59e0b', color: '#fff' }} onClick={handleOpenFullStockCount}>
            <CheckSquare size={16} />
            <span className="btn-scan-label">Full Stock Count</span>
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '2px solid #e2e8f0', marginBottom: '1.25rem', overflowX: 'auto' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => { setActiveTab(t.id); setSelectedBinCardMedicine(null); setStockBinCardView(false); }} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.6rem 0.9rem', border: 'none', background: 'none', cursor: 'pointer', borderBottom: activeTab === t.id ? '3px solid #2563eb' : '3px solid transparent', color: activeTab === t.id ? '#2563eb' : '#64748b', fontWeight: 700, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="table-container">
        {loading ? (
          <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Loading...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            {activeTab === 'stock' && !stockBinCardView && (
              <table className="custom-table">
                <thead>
                  <tr><th>Drug Name</th><th>Strength</th><th>Total Stock On Hand</th><th>Status</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {stockList.map(item => (
                    <tr key={item.medicine_id}>
                      <td><strong>{item.generic_name}</strong> {item.brand_name && `(${item.brand_name})`}</td>
                      <td>{item.strength}</td>
                      <td><span className={`badge ${item.stock_on_hand == 0 ? 'badge-danger' : 'badge-secondary'}`}>{item.stock_on_hand}</span></td>
                      <td>{item.status}</td>
                      <td>
                        <button
                          onClick={() => {
                            setSelectedBinCardMedicine({ medicine_id: item.medicine_id, generic_name: item.generic_name, brand_name: item.brand_name, strength: item.strength });
                            setStockBinCardView(true);
                            setSelectedBatchFilter('ALL');
                          }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.85rem', background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', transition: 'all 0.2s ease', boxShadow: '0 1px 3px rgba(37, 99, 235, 0.3)' }}
                          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.4)'; }}
                          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(37, 99, 235, 0.3)'; }}
                        >
                          <FileText size={14} /> See Bin Card
                        </button>
                      </td>
                    </tr>
                  ))}
                  {stockList.length === 0 && <tr><td colSpan="5" style={{ textAlign: 'center' }}>No stock data.</td></tr>}
                </tbody>
              </table>
            )}

            {activeTab === 'stock' && stockBinCardView && selectedBinCardMedicine && binCardDetail && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <button onClick={() => { setStockBinCardView(false); setSelectedBinCardMedicine(null); setBinCardDetail(null); }} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontWeight: 600 }}>
                    <ArrowLeft size={16} /> Back to Stock List
                  </button>
                  <button onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                    <Printer size={16} /> Print
                  </button>
                </div>

                <div style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)', padding: '1.25rem 1.5rem', borderRadius: '10px', marginBottom: '1rem', border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <FileText size={20} color="#2563eb" />
                  <span style={{ fontWeight: 700, color: '#1e40af', fontSize: '1.05rem' }}>Bin Card</span>
                  <span style={{ color: '#475569' }}>—</span>
                  <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '1.05rem' }}>{binCardDetail.medicine.generic_name} {binCardDetail.medicine.strength}</span>
                  {binCardDetail.medicine.brand_name && <span style={{ color: '#64748b', fontSize: '0.9rem' }}>({binCardDetail.medicine.brand_name})</span>}
                </div>
                
                <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a' }}>{binCardDetail.medicine.brand_name || binCardDetail.medicine.generic_name}</h2>
                    <div style={{ color: '#64748b', marginTop: '0.25rem' }}>
                      {binCardDetail.medicine.generic_name} • {binCardDetail.medicine.strength} • {binCardDetail.medicine.dosage_form} • {binCardDetail.medicine.category_name}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Reorder: {binCardDetail.medicine.reorder_level} | Max: {binCardDetail.medicine.max_level}</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Total Stock</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#0f172a' }}>{binCardDetail.medicine.total_stock || 0}</div>
                  </div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Available</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#10b981' }}>{binCardDetail.medicine.total_stock || 0}</div>
                  </div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Reserved</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#f59e0b' }}>0</div>
                  </div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Batches</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#3b82f6' }}>{binCardDetail.batches?.length || 0}</div>
                  </div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Avg Pur. Price</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#64748b' }}>
                      {binCardDetail.batches?.length ? (binCardDetail.batches.reduce((sum, b) => sum + parseFloat(b.buy_price || 0), 0) / binCardDetail.batches.length).toFixed(2) : '0.00'}
                    </div>
                  </div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Stock Value</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#64748b' }}>
                      {binCardDetail.batches?.reduce((sum, b) => sum + (parseFloat(b.buy_price || 0) * parseInt(b.quantity || 0)), 0).toFixed(2) || '0.00'}
                    </div>
                  </div>
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '1rem' }}>
                    <div style={{ fontSize: '0.8rem', color: '#dc2626' }}>Expiring Soon</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#dc2626' }}>
                      {binCardDetail.batches?.filter(b => new Date(b.expiry_date) <= new Date(new Date().setMonth(new Date().getMonth() + 3))).length || 0}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <label style={{ fontWeight: 'bold', color: '#475569' }}>Batch Selector:</label>
                    <select className="form-control" value={selectedBatchFilter} onChange={e => setSelectedBatchFilter(e.target.value)} style={{ maxWidth: '300px' }}>
                      <option value="ALL">All Batches</option>
                      {binCardDetail.batches?.map(b => (
                        <option key={b.batch_id} value={b.batch_number}>{b.batch_number}</option>
                      ))}
                    </select>
                  </div>
                  {selectedBatchFilter !== 'ALL' && binCardDetail.batches?.find(b => b.batch_number === selectedBatchFilter) && (
                    <div style={{ background: '#eff6ff', padding: '1rem', borderRadius: '8px', border: '1px solid #bfdbfe', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                      {(() => {
                        const b = binCardDetail.batches.find(b => b.batch_number === selectedBatchFilter);
                        return (
                          <>
                            <div><span style={{ fontSize: '0.8rem', color: '#64748b' }}>Barcode:</span> <strong>{b.barcode || '—'}</strong></div>
                            <div><span style={{ fontSize: '0.8rem', color: '#64748b' }}>QR:</span> <strong>{b.qr_code || '—'}</strong></div>
                            <div><span style={{ fontSize: '0.8rem', color: '#64748b' }}>ABC:</span> <strong>{b.abc_category || '—'}</strong></div>
                            <div><span style={{ fontSize: '0.8rem', color: '#64748b' }}>VEN:</span> <strong>{b.ven_category || '—'}</strong></div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>

                <table className="custom-table">
                  <thead>
                    <tr><th>Date</th><th>Type / Ref</th><th>Batch</th><th>Expiry Date</th><th>In (+)</th><th>Out (-)</th><th>Balance</th><th>Unit Price</th></tr>
                  </thead>
                  <tbody>
                    {binCardDetail.ledger.filter(row => selectedBatchFilter === 'ALL' || row.batch_number === selectedBatchFilter).map((row, i) => (
                      <tr key={i}>
                        <td>{row.movement_date ? new Date(row.movement_date).toLocaleDateString() : '—'}</td>
                        <td><span style={{ fontSize: '0.8rem', color: '#64748b' }}>{row.notes || row.movement_type}</span></td>
                        <td>{row.batch_number || '—'}</td>
                        <td>{row.expiry_date ? new Date(row.expiry_date).toLocaleDateString() : '—'}</td>
                        <td style={{ color: '#10b981', fontWeight: 'bold' }}>{row.stock_in > 0 ? row.stock_in : ''}</td>
                        <td style={{ color: '#ef4444', fontWeight: 'bold' }}>{row.stock_out > 0 ? row.stock_out : ''}</td>
                        <td><strong>{row.balance !== undefined ? row.balance : ''}</strong></td>
                        <td>{row.unit_price ? `ETB ${parseFloat(row.unit_price).toFixed(2)}` : '—'}</td>
                      </tr>
                    ))}
                    {binCardDetail.ledger.filter(row => selectedBatchFilter === 'ALL' || row.batch_number === selectedBatchFilter).length === 0 && <tr><td colSpan="8" style={{ textAlign: 'center' }}>No ledger records found.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'stock' && stockBinCardView && selectedBinCardMedicine && !binCardDetail && !loading && (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                <p>Loading bin card data...</p>
              </div>
            )}


            {activeTab === 'movements' && (
              <table className="custom-table">
                <thead>
                  <tr><th>Date</th><th>Type</th><th>Drug (Batch)</th><th>Qty</th><th>Previous</th><th>New</th><th>User</th><th>Reference</th></tr>
                </thead>
                <tbody>
                  {movements.map((m, i) => (
                    <tr key={i}>
                      <td>{new Date(m.movement_date).toLocaleString()}</td>
                      <td><span className={`badge ${m.movement_type === 'SALE' ? 'badge-primary' : m.movement_type === 'RESUPPLY' ? 'badge-secondary' : 'badge-warning'}`}>{m.movement_type}</span></td>
                      <td>{m.drug_name} ({m.batch_number})</td>
                      <td style={{ color: m.quantity < 0 ? '#ef4444' : '#10b981', fontWeight: 'bold' }}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td>
                      <td>{m.previous_stock}</td>
                      <td>{m.new_stock}</td>
                      <td>{m.user_name}</td>
                      <td style={{ fontSize: '0.75rem' }}>{m.reference}</td>
                    </tr>
                  ))}
                  {movements.length === 0 && <tr><td colSpan="8" style={{ textAlign: 'center' }}>No movements recorded.</td></tr>}
                </tbody>
              </table>
            )}

            {activeTab === 'whatToBuy' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                  {['CRITICAL', 'HIGH', 'MEDIUM', 'NORMAL'].map((p, i) => {
                     const count = whatToBuy.filter(w => w.priority === p).length;
                     const bg = p === 'CRITICAL' ? '#fef2f2' : p === 'HIGH' ? '#fff7ed' : p === 'MEDIUM' ? '#fefce8' : '#f8fafc';
                     const col = p === 'CRITICAL' ? '#dc2626' : p === 'HIGH' ? '#ea580c' : p === 'MEDIUM' ? '#ca8a04' : '#64748b';
                     return (
                       <div key={p} style={{ background: bg, border: `1px solid ${col}40`, borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
                         <div style={{ fontSize: '0.85rem', color: col, fontWeight: 700 }}>{p}</div>
                         <div style={{ fontSize: '1.5rem', fontWeight: 800, color: col }}>{count}</div>
                       </div>
                     );
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                  <ExportCSV data={whatToBuy} filename="what_to_buy.csv" />
                </div>
                <table className="custom-table">
                  <thead>
                    <tr><th>Priority</th><th>Medicine</th><th>Strength</th><th>Stock</th><th>Min</th><th>Max</th><th>Buy Qty</th><th>ABC</th><th>VEN</th><th>Last Supplier</th><th>Est. Cost</th></tr>
                  </thead>
                  <tbody>
                    {whatToBuy.map((w, i) => (
                      <tr key={i}>
                        <td>
                          {w.priority === 'CRITICAL' && <span style={{ color: '#dc2626', fontWeight: 'bold' }}>🔴 CRITICAL</span>}
                          {w.priority === 'HIGH' && <span style={{ color: '#ea580c', fontWeight: 'bold' }}>🟠 HIGH</span>}
                          {w.priority === 'MEDIUM' && <span style={{ color: '#ca8a04', fontWeight: 'bold' }}>🟡 MEDIUM</span>}
                          {w.priority === 'NORMAL' && <span style={{ color: '#16a34a', fontWeight: 'bold' }}>🟢 NORMAL</span>}
                        </td>
                        <td><strong>{w.generic_name}{w.brand_name ? ` (${w.brand_name})` : ''}</strong></td>
                        <td>{w.strength}</td>
                        <td>{w.current_stock}</td>
                        <td>{w.min_level}</td>
                        <td>{w.max_level}</td>
                        <td style={{ fontWeight: 'bold', color: '#2563eb' }}>{w.suggested_qty}</td>
                        <td>{w.abc_category || '—'}</td>
                        <td>{w.ven_category || '—'}</td>
                        <td>{w.last_supplier || '—'}</td>
                        <td>{(w.suggested_qty && w.last_buy_price) ? `ETB ${(Number(w.suggested_qty) * Number(w.last_buy_price)).toFixed(2)}` : '—'}</td>
                      </tr>
                    ))}
                    {whatToBuy.length === 0 && <tr><td colSpan="11" style={{ textAlign: 'center' }}>No items to buy.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {fullStockCountModalOpen && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-card" style={{ maxWidth: '1100px', maxHeight: '85vh', overflow: 'auto' }}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', margin: 0 }}>Full Stock Count</h2>
                <p style={{ margin: '0.4rem 0 0', color: '#64748b' }}>Difference = Physical Quantity - System Quantity</p>
              </div>
            </div>
            <form onSubmit={handleFullStockCountSubmit}>
              <div style={{ marginBottom: '1rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.9rem 1rem', color: '#475569' }}>
                Update the physical count for every batch. Each difference creates a stock adjustment transaction, preserving the bin card audit trail.
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th>Batch</th>
                      <th>System Qty</th>
                      <th>Physical Qty</th>
                      <th>Difference</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullStockCountRows.map((row) => (
                      <tr key={row.batch_id}>
                        <td><strong>{row.medicine_name}</strong></td>
                        <td>{row.batch_number}</td>
                        <td>{row.system_quantity}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            value={row.physical_quantity}
                            onChange={(e) => updateFullStockCountRow(row.batch_id, e.target.value)}
                            className="form-control"
                            style={{ minWidth: '120px' }}
                          />
                        </td>
                        <td style={{ color: row.difference === 0 ? '#475569' : row.difference > 0 ? '#16a34a' : '#dc2626', fontWeight: 'bold' }}>
                          {row.difference > 0 ? '+' : ''}{row.difference}
                        </td>
                        <td>
                          <span className={`badge ${row.status === 'MATCH' ? 'badge-secondary' : row.status === 'OVER' ? 'badge-success' : 'badge-warning'}`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', gap: '1rem' }}>
                <button type="button" onClick={() => setFullStockCountModalOpen(false)} style={{ padding: '0.65rem', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', background: 'white' }}>Cancel</button>
                <button type="submit" style={{ padding: '0.65rem', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Save Stock Count</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAddStockModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Add Stock (New Batch)</h2>
            </div>
            <form onSubmit={handleAddStockSubmit}>
              <div className="form-grid">
                <div className="form-group full-width">
                  <label>Select Medicine *</label>
                  <select required className="form-control" value={stockForm.medicine_id} onChange={e => setStockForm({...stockForm, medicine_id: e.target.value})}>
                    <option value="">-- Choose Medicine --</option>
                    {medicines.map(m => <option key={m.medicine_id} value={m.medicine_id}>{m.generic_name} {m.brand_name ? `(${m.brand_name})` : ''}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Select Supplier *</label>
                  <select required className="form-control" value={stockForm.supplier_id} onChange={e => setStockForm({...stockForm, supplier_id: e.target.value})}>
                    <option value="">-- Choose Supplier --</option>
                    {suppliers.map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Batch Number *</label>
                  <input required type="text" className="form-control" value={stockForm.batch_number} onChange={e => setStockForm({...stockForm, batch_number: e.target.value})} />
                </div>
                
                <div className="form-group full-width" style={{ marginTop: '1rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid #e2e8f0' }}>
                    Identification (Batch)
                  </h3>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Barcode <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}><CheckSquare size={12} color="#10b981"/></button></label>
                      <input type="text" className="form-control" value={stockForm.barcode} onChange={e => setStockForm({...stockForm, barcode: e.target.value})} />
                    </div>
                    <div className="form-group">
                      <label>QR Code <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}><CheckSquare size={12} color="#10b981"/></button></label>
                      <input type="text" className="form-control" value={stockForm.qr_code} onChange={e => setStockForm({...stockForm, qr_code: e.target.value})} />
                    </div>
                    <div className="form-group">
                      <label>ABC Category</label>
                      <select className="form-control" value={stockForm.abc_category} onChange={e => setStockForm({...stockForm, abc_category: e.target.value})}>
                        <option value="">— Select —</option>
                        <option value="A">A - High Value</option>
                        <option value="B">B - Medium Value</option>
                        <option value="C">C - Low Value</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>VEN Category</label>
                      <select className="form-control" value={stockForm.ven_category} onChange={e => setStockForm({...stockForm, ven_category: e.target.value})}>
                        <option value="">— Select —</option>
                        <option value="V">V - Vital</option>
                        <option value="E">E - Essential</option>
                        <option value="N">N - Non-Essential</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label>Expiry Date *</label>
                  <input required type="date" className="form-control" value={stockForm.expiry_date} onChange={e => setStockForm({...stockForm, expiry_date: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Quantity to Add *</label>
                  <input required type="number" className="form-control" value={stockForm.quantity} onChange={e => setStockForm({...stockForm, quantity: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Buy Price *</label>
                  <input required type="number" step="0.01" className="form-control" value={stockForm.buy_price} onChange={e => {
                    const bp = parseFloat(e.target.value) || 0;
                    setStockForm({...stockForm, buy_price: e.target.value, sell_price: (bp * 1.25).toFixed(2)});
                  }} />
                </div>
                <div className="form-group">
                  <label>Sell Price (Auto +25%)</label>
                  <input type="number" step="0.01" className="form-control" value={stockForm.sell_price} onChange={e => setStockForm({...stockForm, sell_price: e.target.value})} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', gap: '1rem' }}>
                <button type="button" onClick={() => setIsAddStockModalOpen(false)} style={{ padding: '0.65rem', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', background: 'white' }}>Cancel</button>
                <button type="submit" style={{ padding: '0.65rem', background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Save Stock Batch</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAdjustModalOpen && selectedBatch && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Adjust Physical Stock</h2>
            </div>
            <form onSubmit={handleAdjustStockSubmit}>
              <div style={{ marginBottom: '1rem', background: '#f8fafc', padding: '1rem', borderRadius: '8px' }}>
                <p><strong>Drug:</strong> {selectedBatch.drug_name}</p>
                <p><strong>Batch:</strong> {selectedBatch.batch_number}</p>
                <p><strong>System Stock:</strong> {selectedBatch.stock_quantity}</p>
              </div>
              <div className="form-group">
                <label>Actual Physical Count *</label>
                <input required type="number" className="form-control" value={physicalCount} onChange={e => setPhysicalCount(e.target.value)} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', gap: '1rem' }}>
                <button type="button" onClick={() => setIsAdjustModalOpen(false)} style={{ padding: '0.65rem', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', background: 'white' }}>Cancel</button>
                <button type="submit" style={{ padding: '0.65rem', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Confirm Adjustment</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
