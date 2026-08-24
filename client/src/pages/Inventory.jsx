import React, { useState, useEffect, useMemo } from 'react';
import './Inventory.css';
import {
  Boxes, FileText, Activity, Plus, CheckSquare, Download, Search,
  ArrowLeft, Printer, ShoppingCart, AlertTriangle, PackageX, Loader2,
} from 'lucide-react';
import { inventoryAPI, medicinesAPI, suppliersAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useGuestGuard } from '../hooks/useGuestGuard';
import { downloadCsv } from '../utils/csv';
import { TableSkeleton, EmptyState, ErrorState } from '../components/Feedback';

const PRIORITY_META = {
  CRITICAL: { cls: 'badge-danger', label: 'Critical' },
  HIGH:     { cls: 'badge-warning', label: 'High' },
  MEDIUM:   { cls: 'badge-info',   label: 'Medium' },
  NORMAL:   { cls: 'badge-neutral', label: 'Normal' },
};

export const Inventory = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const guard = useGuestGuard();
  const [activeTab, setActiveTab] = useState('stock');

  const [stockList, setStockList] = useState([]);
  const [movements, setMovements] = useState([]);
  const [whatToBuy, setWhatToBuy] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [medicines, setMedicines] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  const [isAddStockModalOpen, setIsAddStockModalOpen] = useState(false);
  const [savingStock, setSavingStock] = useState(false);
  const [savingCount, setSavingCount] = useState(false);
  const [selectedBatchFilter, setSelectedBatchFilter] = useState('ALL');
  const [stockBinCardView, setStockBinCardView] = useState(false);
  const [fullStockCountModalOpen, setFullStockCountModalOpen] = useState(false);
  const [fullStockCountRows, setFullStockCountRows] = useState([]);

  const [stockForm, setStockForm] = useState({
    medicine_id: '', supplier_id: '', batch_number: '', barcode: '', qr_code: '',
    abc_category: '', ven_category: '', expiry_date: '',
    packaging_unit: 'STRIP', units_per_package: '10', quantity: '',
    buy_price: '', sell_price: ''
  });

  const emptyStockForm = {
    medicine_id: '', supplier_id: '', batch_number: '', barcode: '', qr_code: '',
    abc_category: '', ven_category: '', expiry_date: '',
    packaging_unit: 'STRIP', units_per_package: '10', quantity: '',
    buy_price: '', sell_price: ''
  };

  /* Live packaging calculations (single source of truth for the form preview). */
  const packagingCalc = useMemo(() => {
    const dosesPerUnit = Math.max(1, Math.floor(Number(stockForm.units_per_package) || 1));
    const units = Math.floor(Number(stockForm.quantity) || 0);
    const buy = parseFloat(stockForm.buy_price);
    const sell = parseFloat(stockForm.sell_price);
    return {
      dosesPerUnit,
      units,
      totalDoses: units > 0 ? units * dosesPerUnit : 0,
      buyPerDose: Number.isFinite(buy) && buy >= 0 ? buy / dosesPerUnit : null,
      sellPerDose: Number.isFinite(sell) && sell >= 0 ? sell / dosesPerUnit : null,
    };
  }, [stockForm.units_per_package, stockForm.quantity, stockForm.buy_price, stockForm.sell_price]);

  // Bin Card States
  const [selectedBinCardMedicine, setSelectedBinCardMedicine] = useState(null);
  const [binCardDetail, setBinCardDetail] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);

    if (activeTab === 'stock') {
      if (stockBinCardView && selectedBinCardMedicine) {
        inventoryAPI.getBinCardDetail(selectedBinCardMedicine.medicine_id)
          .then(res => { if (!cancelled) { setBinCardDetail(res.data); setLoading(false); } })
          .catch(() => {
            if (cancelled) return;
            toast.error('Unable to load this bin card.');
            setSelectedBinCardMedicine(null);
            setStockBinCardView(false);
            setLoading(false);
          });
      } else {
        inventoryAPI.getStock()
          .then(res => { if (!cancelled) { setStockList(Array.isArray(res.data) ? res.data : []); setLoading(false); } })
          .catch(() => { if (!cancelled) { setLoadError(true); setLoading(false); } });
      }
    } else if (activeTab === 'movements') {
      inventoryAPI.getMovements()
        .then(res => { if (!cancelled) { setMovements(Array.isArray(res.data) ? res.data : []); setLoading(false); } })
        .catch(() => { if (!cancelled) { setLoadError(true); setLoading(false); } });
    } else if (activeTab === 'whatToBuy') {
      inventoryAPI.getWhatToBuy()
        .then(res => { if (!cancelled) { setWhatToBuy(Array.isArray(res.data) ? res.data : []); setLoading(false); } })
        .catch(() => { if (!cancelled) { setLoadError(true); setLoading(false); } });
    }

    return () => { cancelled = true; };
  }, [activeTab, selectedBinCardMedicine, stockBinCardView]);

  useEffect(() => {
    medicinesAPI.getAll().then(res => setMedicines(Array.isArray(res.data) ? res.data : [])).catch(() => {});
    // Batch/resupply forms select ACTIVE suppliers only (server-filtered).
    suppliersAPI.getAll({ status: 'ACTIVE' }).then(res => setSuppliers(Array.isArray(res.data) ? res.data : [])).catch(() => {});
  }, []);

  /* Filtered datasets — CSV export respects these too */
  const filteredStock = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return stockList;
    return stockList.filter(item =>
      item.generic_name?.toLowerCase().includes(q) ||
      item.brand_name?.toLowerCase().includes(q) ||
      item.strength?.toLowerCase().includes(q)
    );
  }, [stockList, searchQuery]);

  const filteredMovements = useMemo(() => movements, [movements]);

  const handleAddStockSubmit = async (e) => {
    e.preventDefault();
    if (!stockForm.barcode && !stockForm.qr_code) {
      toast.warning('At least one of Barcode or QR Code is required.');
      return;
    }
    /* Packaging validation — mirror the server rules for instant feedback. */
    const dosesPerUnit = Math.floor(Number(stockForm.units_per_package));
    if (!Number.isFinite(dosesPerUnit) || dosesPerUnit < 1) {
      toast.warning('Single doses per selected unit must be at least 1.');
      return;
    }
    const units = Math.floor(Number(stockForm.quantity));
    if (!Number.isFinite(units) || units <= 0) {
      toast.warning('Units received must be a positive whole number.');
      return;
    }
    const buy = parseFloat(stockForm.buy_price);
    const sell = parseFloat(stockForm.sell_price);
    if (!Number.isFinite(buy) || buy <= 0 || !Number.isFinite(sell) || sell <= 0) {
      toast.warning('Enter the purchase and selling price per selected unit.');
      return;
    }

    if (savingStock) return; // duplicate-submission guard
    setSavingStock(true);
    try {
      // Backend performs receive → batch upsert → stock update → movement → audit
      // as ONE transaction; we surface exactly that with one honest message.
      await inventoryAPI.addStock({
        ...stockForm,
        packaging_unit: stockForm.packaging_unit.toUpperCase(),
        units_per_package: dosesPerUnit,
        quantity: units,
        user_id: user?.id || 1
      });
      toast.success(`Added ${units} × ${dosesPerUnit} dose(s) = ${packagingCalc.totalDoses} single doses`);
      setIsAddStockModalOpen(false);
      setStockForm(emptyStockForm);
      // reload current view
      setLoading(true);
      inventoryAPI.getStock()
        .then(res => { setStockList(Array.isArray(res.data) ? res.data : []); setLoading(false); })
        .catch(() => setLoading(false));
    } catch (err) {
      // Keep the modal open with values intact on failure.
      toast.error(err.response?.data?.error || 'Unable to save the resupply. Please try again.');
    } finally {
      setSavingStock(false);
    }
  };

  const handleOpenFullStockCount = async () => {
    try {
      const res = await inventoryAPI.getBinCard();
      const rows = (Array.isArray(res.data) ? res.data : []).map(batch => ({
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
    if (!fullStockCountRows.length || savingCount) return;

    setSavingCount(true);
    try {
      await inventoryAPI.adjustStockBulk({
        adjustments: fullStockCountRows.map(row => ({
          batch_id: row.batch_id,
          physical_count: Number(row.physical_quantity)
        })),
        user_id: user?.id || 1
      });
      toast.success('Stock count saved as adjustment entries');
      setFullStockCountModalOpen(false);
      setFullStockCountRows([]);
      setLoading(true);
      inventoryAPI.getStock()
        .then(res => { setStockList(Array.isArray(res.data) ? res.data : []); setLoading(false); })
        .catch(() => setLoading(false));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Unable to save the physical count. Please try again.');
    } finally {
      setSavingCount(false);
    }
  };

  const setIsAddStockCountOpenSafe = () => {
    if (!savingStock) setIsAddStockModalOpen(false);
  };

  const handleExport = () => {
    const dataset = activeTab === 'movements'
      ? 'medicine-history'
      : activeTab === 'whatToBuy' ? 'what-to-buy' : 'inventory';

    const rows = activeTab === 'movements' ? filteredMovements : activeTab === 'whatToBuy' ? whatToBuy : filteredStock;
    downloadCsv({ rows, dataset, notify: toast });
  };

  const tabs = [
    { id: 'stock', icon: <Boxes size={14} />, label: 'Stock List' },
    { id: 'movements', icon: <Activity size={14} />, label: 'History' },
    { id: 'whatToBuy', icon: <ShoppingCart size={14} />, label: 'What to Buy' },
  ];

  const ledgerRows = binCardDetail?.ledger?.filter(
    row => selectedBatchFilter === 'ALL' || row.batch_number === selectedBatchFilter
  ) || [];

  return (
    <div className="inventory-page">
      {/* ── Page header: NEVER scrolls horizontally with tables ── */}
      <div className="page-header">
        <div className="page-title-group">
          <h1>Inventory</h1>
          <p>Manage physical stock, batches, movement history and reorder recommendations</p>
        </div>
        {!stockBinCardView && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={() => guard(() => setIsAddStockModalOpen(true))}
            >
              <Plus size={16} />
              <span className="hide-sm">Add Stock (New Batch)</span>
            </button>
            <button
              className="btn btn-primary"
              onClick={() => guard(handleOpenFullStockCount)}
            >
              <CheckSquare size={16} />
              <span className="hide-sm">Full Stock Count</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      {!stockBinCardView && (
        <div className="tabs-row" role="tablist">
          {tabs.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => { setActiveTab(t.id); setSearchQuery(''); }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ══════════ STOCK TAB ══════════ */}
      {activeTab === 'stock' && !stockBinCardView && (
        <>
          <div className="inv-filters-row">
            <div className="smart-search-input-wrap inv-search">
              <Search size={15} />
              <input
                type="text"
                placeholder="Search medicines…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search stock"
              />
            </div>
            <button className="btn btn-ghost" onClick={handleExport}>
              <Download size={16} /> Export CSV
            </button>
          </div>

          <div className="table-container">
            {loading ? (
              <TableSkeleton rows={7} cols={[30, 18, 18, 16]} />
            ) : loadError ? (
              <ErrorState title="Unable to load stock" onRetry={() => setActiveTab('stock')} />
            ) : filteredStock.length === 0 ? (
              <EmptyState
                icon={<PackageX size={26} />}
                title={searchQuery ? 'No medicines match your search' : 'No stock data yet'}
                description={searchQuery ? 'Try changing your search or filters.' : 'Add a new batch or register a medicine with initial stock to see it here.'}
                actionLabel={searchQuery ? 'Clear Filters' : undefined}
                onAction={searchQuery ? () => setSearchQuery('') : undefined}
              />
            ) : (
              <>
                {/* Desktop / tablet table */}
                <div className="table-scroll-wrap hide-mobile-table">
                  <table className="custom-table">
                    <thead>
                      <tr>
                        <th>Drug Name</th><th>Strength</th><th>Packaging</th><th>Stock (doses)</th><th>Status</th><th style={{ textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStock.map(item => (
                        <tr key={item.medicine_id}>
                          <td><strong className="td-strong">{item.generic_name}</strong>{item.brand_name ? ` (${item.brand_name})` : ''}</td>
                          <td>{item.strength}</td>
                          <td><small className="muted-line">{(item.packaging_unit || 'SINGLE_DOSE').replace('_',' ')}{item.strip_size > 1 ? ` · ${item.strip_size}/unit` : ''}</small></td>
                          <td>
                            <span className={`badge ${Number(item.stock_on_hand) === 0 ? 'badge-danger' : Number(item.stock_on_hand) < 10 ? 'badge-warning' : 'badge-secondary'}`}>
                              {item.stock_on_hand}{item.strip_size > 1 ? ` ≈ ${Math.floor(item.stock_on_hand / item.strip_size)} ${item.packaging_unit === 'STRIP' ? 'strips' : 'units'}` : ''}
                            </span>
                          </td>
                          <td><span className="badge badge-neutral">{item.status}</span></td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setSelectedBinCardMedicine({
                                  medicine_id: item.medicine_id, generic_name: item.generic_name,
                                  brand_name: item.brand_name, strength: item.strength
                                });
                                setStockBinCardView(true);
                                setSelectedBatchFilter('ALL');
                              }}
                            >
                              <FileText size={14} /> Bin Card
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="mobile-card-list show-mobile-table">
                  {filteredStock.map(item => (
                    <div key={item.medicine_id} className="mobile-card stagger-item">
                      <div className="mobile-card-head">
                        <strong>{item.generic_name}{item.brand_name ? ` (${item.brand_name})` : ''}</strong>
                        <span className={`badge ${Number(item.stock_on_hand) === 0 ? 'badge-danger' : Number(item.stock_on_hand) < 10 ? 'badge-warning' : 'badge-secondary'}`}>
                          {item.stock_on_hand} units
                        </span>
                      </div>
                      <div className="mobile-card-meta">
                        <span>{item.strength} · {(item.packaging_unit || 'SINGLE_DOSE').replace('_',' ')}{item.strip_size > 1 ? ` (${item.strip_size}/unit)` : ''}</span>
                        <span className="badge badge-neutral">{item.status}</span>
                      </div>
                      <div className="mobile-card-actions">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setSelectedBinCardMedicine({
                              medicine_id: item.medicine_id, generic_name: item.generic_name,
                              brand_name: item.brand_name, strength: item.strength
                            });
                            setStockBinCardView(true);
                            setSelectedBatchFilter('ALL');
                          }}
                        >
                          <FileText size={14} /> View Bin Card
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="table-footer">
                  <span>{filteredStock.length} medicine{filteredStock.length === 1 ? '' : 's'}</span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ══════════ BIN CARD DETAIL VIEW ══════════ */}
      {activeTab === 'stock' && stockBinCardView && selectedBinCardMedicine && (
        <div className="table-container bincard-wrap fade-in">
          {loading ? (
            <TableSkeleton rows={8} cols={[16, 24, 16, 16, 12, 12]} />
          ) : !binCardDetail ? (
            <EmptyState icon={<FileText size={26} />} title="Loading bin card…" description="Retrieving ledger data." />
          ) : (
            <div style={{ padding: '1.1rem' }}>
              <div className="bincard-toolbar">
                <button
                  className="btn btn-ghost"
                  onClick={() => { setStockBinCardView(false); setSelectedBinCardMedicine(null); setBinCardDetail(null); }}
                >
                  <ArrowLeft size={16} /> Back to Stock List
                </button>
                <button className="btn btn-secondary" onClick={() => window.print()}>
                  <Printer size={16} /> Print
                </button>
              </div>

              <div className="bincard-title dot-grid">
                <FileText size={20} />
                <strong>Bin Card</strong>
                <span>—</span>
                <span className="bincard-med-name">
                  {binCardDetail.medicine.generic_name} {binCardDetail.medicine.strength}
                </span>
                {binCardDetail.medicine.brand_name && (
                  <span className="muted-line">({binCardDetail.medicine.brand_name})</span>
                )}
              </div>

              {/* Summary cards */}
              <div className="bincard-stats">
                {[
                  { label: 'Total Stock', value: binCardDetail.medicine.total_stock || 0 },
                  { label: 'Available', value: binCardDetail.medicine.total_stock || 0 },
                  { label: 'Reserved', value: 0 },
                  { label: 'Batches', value: binCardDetail.batches?.length || 0 },
                  {
                    label: 'Avg Pur. Price',
                    value: binCardDetail.batches?.length
                      ? (binCardDetail.batches.reduce((sum, b) => sum + parseFloat(b.buy_price || 0), 0) / binCardDetail.batches.length).toFixed(2)
                      : '0.00',
                  },
                  {
                    label: 'Stock Value',
                    value: binCardDetail.batches?.reduce((sum, b) => sum + (parseFloat(b.buy_price || 0) * parseInt(b.quantity || 0)), 0).toFixed(2) || '0.00',
                  },
                  {
                    label: 'Expiring Soon', danger: true,
                    value: binCardDetail.batches?.filter(b => new Date(b.expiry_date) <= new Date(new Date().setMonth(new Date().getMonth() + 3))).length || 0,
                  },
                ].map(stat => (
                  <div key={stat.label} className={`bincard-stat ${stat.danger ? 'danger' : ''}`}>
                    <span>{stat.label}</span>
                    <strong>{stat.value}</strong>
                  </div>
                ))}
              </div>

              <div className="bincard-batch-row">
                <label className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.6rem' }}>
                  Batch:
                  <select
                    className="form-control"
                    style={{ minWidth: '220px' }}
                    value={selectedBatchFilter}
                    onChange={e => setSelectedBatchFilter(e.target.value)}
                  >
                    <option value="ALL">All Batches</option>
                    {binCardDetail.batches?.map(b => (
                      <option key={b.batch_id} value={b.batch_number}>{b.batch_number}</option>
                    ))}
                  </select>
                </label>

                {selectedBatchFilter !== 'ALL' && binCardDetail.batches?.find(b => b.batch_number === selectedBatchFilter) && (() => {
                  const b = binCardDetail.batches.find(x => x.batch_number === selectedBatchFilter);
                  return (
                    <div className="batch-chips">
                      <span className="chip">Barcode: <strong>{b.barcode || '—'}</strong></span>
                      <span className="chip">QR: <strong>{b.qr_code || '—'}</strong></span>
                      <span className="chip">ABC: <strong>{b.abc_category || '—'}</strong></span>
                      <span className="chip">VEN: <strong>{b.ven_category || '—'}</strong></span>
                      {(b.packaging_unit || b.units_available !== undefined) && (
                        <span className="chip">
                          Packaging: <strong>{(b.packaging_unit || 'SINGLE_DOSE').replace('_',' ')}{b.units_per_package > 1 ? ` ×${b.units_per_package}` : ''} · {b.units_available ?? Math.floor((b.stock_quantity||0) / (b.units_per_package||1))} left</strong>
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Ledger */}
              <div className="table-scroll-wrap">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>Date</th><th>Type / Ref</th><th>Batch</th><th>Expiry Date</th>
                      <th>In (+)</th><th>Out (-)</th><th>Balance</th><th>Unit Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRows.map((row, i) => (
                      <tr key={i}>
                        <td>{row.movement_date ? new Date(row.movement_date).toLocaleDateString() : '—'}</td>
                        <td><small className="muted-line">{row.notes || row.movement_type}</small></td>
                        <td>{row.batch_number || '—'}</td>
                        <td>{row.expiry_date ? new Date(row.expiry_date).toLocaleDateString() : '—'}</td>
                        <td className="in-cell">{row.stock_in > 0 ? row.stock_in : ''}</td>
                        <td className="out-cell">{row.stock_out > 0 ? row.stock_out : ''}</td>
                        <td><strong className="td-strong">{row.balance !== undefined ? row.balance : ''}</strong></td>
                        <td>{row.unit_price ? `ETB ${parseFloat(row.unit_price).toFixed(2)}` : '—'}</td>
                      </tr>
                    ))}
                    {ledgerRows.length === 0 && (
                      <tr><td colSpan="8"><EmptyState title="No ledger records" description="This batch has no recorded movements yet." /></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════ MOVEMENTS TAB ══════════ */}
      {activeTab === 'movements' && (
        <div className="table-container">
          {loading ? (
            <TableSkeleton rows={8} cols={[18, 14, 22, 10, 10, 10, 12]} />
          ) : loadError ? (
            <ErrorState title="Unable to load history" onRetry={() => setActiveTab('movements')} />
          ) : filteredMovements.length === 0 ? (
            <EmptyState icon={<Activity size={26} />} title="No movements recorded yet" description="Sales and resupply transactions will appear here." />
          ) : (
            <>
              <div className="inv-filters-row" style={{ borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)', padding: '0 0.25rem' }}>
                  Complete stock in/out history across all medicines.
                </span>
                <button className="btn btn-ghost" onClick={handleExport}>
                  <Download size={16} /> Export CSV
                </button>
              </div>
              <div className="table-scroll-wrap">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>Date</th><th>Type</th><th>Drug (Batch)</th><th>Qty</th>
                      <th>Previous</th><th>New</th><th>User</th><th>Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMovements.map((m) => (
                      <tr key={m.movement_id ?? `${m.movement_date}-${m.drug_name}-${m.batch_number}`}>
                        <td>{new Date(m.movement_date).toLocaleString()}</td>
                        <td>
                          <span className={`badge ${m.movement_type === 'SALE' ? 'badge-primary' : m.movement_type === 'RESUPPLY' ? 'badge-secondary' : 'badge-warning'}`}>
                            {m.movement_type}
                          </span>
                        </td>
                        <td className="cell-truncate">{m.drug_name} ({m.batch_number})</td>
                        <td className={m.quantity < 0 ? 'out-cell' : 'in-cell'}>
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                        </td>
                        <td>{m.previous_stock}</td>
                        <td>{m.new_stock}</td>
                        <td>{m.user_name}</td>
                        <td><small className="muted-line">{m.reference}</small></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-footer">
                <span>{filteredMovements.length} movements</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════ WHAT TO BUY TAB ══════════ */}
      {activeTab === 'whatToBuy' && (
        <>
          <div className="wtb-priority-grid">
            {['CRITICAL', 'HIGH', 'MEDIUM', 'NORMAL'].map(p => {
              const count = whatToBuy.filter(w => w.priority === p).length;
              const meta = PRIORITY_META[p];
              return (
                <div key={p} className="wtb-priority-card stagger-item">
                  <span className={`badge ${meta.cls}`}>{meta.label}</span>
                  <strong>{count}</strong>
                </div>
              );
            })}
          </div>

          <div className="table-container">
            {loading ? (
              <TableSkeleton rows={6} cols={[16, 24, 12, 10, 10, 12, 12]} />
            ) : loadError ? (
              <ErrorState title="Unable to load recommendations" onRetry={() => setActiveTab('whatToBuy')} />
            ) : whatToBuy.length === 0 ? (
              <EmptyState
                icon={<CheckSquare size={26} />}
                title="Nothing to buy right now"
                description="All tracked medicines are above their minimum levels."
              />
            ) : (
              <>
                <div className="inv-filters-row" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)', padding: '0 0.25rem' }}>
                    Suggested reorder quantities based on min/max levels and consumption.
                  </span>
                  <button className="btn btn-ghost" onClick={handleExport}>
                    <Download size={16} /> Export CSV
                  </button>
                </div>

                {/* Desktop table */}
                <div className="table-scroll-wrap hide-mobile-table">
                  <table className="custom-table">
                    <thead>
                      <tr>
                        <th>Priority</th><th>Medicine</th><th>Strength</th><th>Stock</th>
                        <th>Min</th><th>Max</th><th>Buy Qty</th><th>ABC</th><th>VEN</th>
                        <th>Last Supplier</th><th>Est. Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {whatToBuy.map((w) => (
                        <tr key={w.medicine_id ?? w.generic_name}>
                          <td><span className={`badge ${PRIORITY_META[w.priority]?.cls || 'badge-neutral'}`}>{PRIORITY_META[w.priority]?.label || w.priority}</span></td>
                          <td className="cell-truncate"><strong className="td-strong">{w.generic_name}{w.brand_name ? ` (${w.brand_name})` : ''}</strong></td>
                          <td>{w.strength}</td>
                          <td>{w.current_stock}</td>
                          <td>{w.min_level}</td>
                          <td>{w.max_level}</td>
                          <td><strong className="buy-qty">{w.suggested_qty}</strong></td>
                          <td>{w.abc_category || '—'}</td>
                          <td>{w.ven_category || '—'}</td>
                          <td className="cell-truncate">{w.last_supplier || '—'}</td>
                          <td>{(w.suggested_qty && w.last_buy_price) ? `ETB ${(Number(w.suggested_qty) * Number(w.last_buy_price)).toFixed(2)}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="mobile-card-list show-mobile-table">
                  {whatToBuy.map((w) => (
                    <div key={w.medicine_id ?? w.generic_name} className="mobile-card stagger-item">
                      <div className="mobile-card-head">
                        <strong className="cell-truncate">{w.generic_name}{w.brand_name ? ` (${w.brand_name})` : ''}</strong>
                        <span className={`badge ${PRIORITY_META[w.priority]?.cls || 'badge-neutral'}`}>
                          {PRIORITY_META[w.priority]?.label || w.priority}
                        </span>
                      </div>
                      <div className="wtb-card-grid">
                        <span>Stock <strong>{w.current_stock}</strong></span>
                        <span>Min <strong>{w.min_level}</strong></span>
                        <span>Max <strong>{w.max_level}</strong></span>
                        <span>Buy Qty <strong className="buy-qty">{w.suggested_qty}</strong></span>
                        {(w.suggested_qty && w.last_buy_price) && (
                          <span>Est. Cost <strong>ETB {(Number(w.suggested_qty) * Number(w.last_buy_price)).toFixed(2)}</strong></span>
                        )}
                      </div>
                      <small className="muted-line">
                        {[w.strength, w.last_supplier, w.abc_category && `ABC ${w.abc_category}`, w.ven_category && `VEN ${w.ven_category}`].filter(Boolean).join(' · ')}
                      </small>
                    </div>
                  ))}
                </div>

                <div className="table-footer">
                  <span>{whatToBuy.length} recommendation{whatToBuy.length === 1 ? '' : 's'}</span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ── FULL STOCK COUNT MODAL ── */}
      {fullStockCountModalOpen && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-card" style={{ maxWidth: '1100px' }}>
            <div className="modal-header">
              <div>
                <h2>Full Stock Count</h2>
                <p className="form-hint">Difference = Physical Quantity − System Quantity</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => !savingCount && setFullStockCountModalOpen(false)} disabled={savingCount} aria-label="Close">×</button>
            </div>
            <form onSubmit={handleFullStockCountSubmit}>
              <div className="guest-notice" style={{ background: 'var(--surface-alt)' }}>
                Update the physical count for every batch. Each difference creates a stock adjustment transaction, preserving the bin card audit trail.
              </div>
              <div className="table-scroll-wrap">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>Medicine</th><th>Batch</th><th>System Qty</th>
                      <th>Physical Qty</th><th>Difference</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullStockCountRows.map((row) => (
                      <tr key={row.batch_id}>
                        <td className="cell-truncate"><strong className="td-strong">{row.medicine_name}</strong></td>
                        <td>{row.batch_number}</td>
                        <td>{row.system_quantity}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            className="form-control"
                            style={{ minWidth: '110px' }}
                            value={row.physical_quantity}
                            onChange={(e) => updateFullStockCountRow(row.batch_id, e.target.value)}
                          />
                        </td>
                        <td style={{ color: row.difference === 0 ? 'var(--text-muted)' : row.difference > 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
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
              {savingCount && (
                <p className="form-hint" role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  <Loader2 size={14} className="spin" /> Saving Physical Count…
                </p>
              )}
              <div className="confirm-actions" style={{ marginTop: '1.25rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => !savingCount && setFullStockCountModalOpen(false)} disabled={savingCount}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={savingCount} aria-busy={savingCount}>
                  {savingCount ? (<><Loader2 size={15} className="spin" /> Saving Physical Count…</>) : 'Save Physical Count'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── ADD STOCK MODAL ── */}
      {isAddStockModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2>Receive Stock (Resupply)</h2>
              <button type="button" className="modal-close-btn" onClick={() => !savingStock && setIsAddStockModalOpen(false)} disabled={savingStock} aria-label="Close">×</button>
            </div>
            <form onSubmit={handleAddStockSubmit}>
              <fieldset disabled={savingStock} style={{ border: 'none', margin: 0, padding: 0 }}>
              <div className="form-grid">
                <div className="form-group full-width">
                  <label>Select Medicine *</label>
                  <select required className="form-control" value={stockForm.medicine_id} onChange={e => setStockForm({...stockForm, medicine_id: e.target.value})}>
                    <option value="">— Choose Medicine —</option>
                    {medicines.map(m => <option key={m.medicine_id} value={m.medicine_id}>{m.generic_name} {m.brand_name ? `(${m.brand_name})` : ''}</option>)}
                  </select>
                </div>
                <div className="form-group full-width">
                  <label>Select Supplier *</label>
                  <select required className="form-control" value={stockForm.supplier_id} onChange={e => setStockForm({...stockForm, supplier_id: e.target.value})}>
                    <option value="">— Choose Supplier —</option>
                    {suppliers.map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Batch Number *</label>
                  <input required type="text" className="form-control" value={stockForm.batch_number} onChange={e => setStockForm({...stockForm, batch_number: e.target.value})} placeholder="e.g. B-2026-001" />
                </div>
                <div className="form-group">
                  <label>Expiry Date *</label>
                  <input required type="date" className="form-control" value={stockForm.expiry_date} onChange={e => setStockForm({...stockForm, expiry_date: e.target.value})} />
                </div>

                {/* ── PACKAGING UNIT SYSTEM ── */}
                <div className="form-group full-width packaging-section">
                  <h3 className="drug-section-title">Packaging &amp; Pricing</h3>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Packaging Unit *</label>
                      <select
                        className="form-control"
                        value={stockForm.packaging_unit}
                        onChange={e => {
                          const unit = e.target.value;
                          const defaults = { SINGLE_DOSE: 1, STRIP: 10, INNER_BOX: 100, OUTER_BOX: 1000 };
                          setStockForm({
                            ...stockForm,
                            packaging_unit: unit,
                            // Suggest the reference conversion; user confirms/edits it.
                            units_per_package: String(defaults[unit] || 1),
                          });
                        }}
                      >
                        <option value="SINGLE_DOSE">Single Dose (bottle, tube, puff, unit)</option>
                        <option value="STRIP">Strip</option>
                        <option value="INNER_BOX">Inner Box</option>
                        <option value="OUTER_BOX">Outer Box</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Units Received *</label>
                      <input
                        required type="number" min="1" step="1"
                        className="form-control"
                        value={stockForm.quantity}
                        onChange={e => setStockForm({...stockForm, quantity: e.target.value})}
                        placeholder="How many of this unit"
                      />
                    </div>
                    <div className="form-group">
                      <label>Single doses per selected unit *</label>
                      <input
                        required type="number" min="1" step="1"
                        className="form-control"
                        value={stockForm.units_per_package}
                        onChange={e => setStockForm({...stockForm, units_per_package: e.target.value})}
                        title="Confirm the conversion — real packaging can vary"
                      />
                      <span className="form-hint">Reference default — confirm for this medicine.</span>
                    </div>
                    <div className="form-group">
                      <label>Total single doses</label>
                      <div className="packaging-total">{packagingCalc.totalDoses.toLocaleString()}</div>
                    </div>

                    <div className="form-group">
                      <label>Purchase price per selected unit (ETB) *</label>
                      <input
                        required type="number" min="0" step="0.01"
                        className="form-control"
                        value={stockForm.buy_price}
                        onChange={e => setStockForm({...stockForm, buy_price: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>Selling price per selected unit (ETB) *</label>
                      <input
                        required type="number" min="0" step="0.01"
                        className="form-control"
                        value={stockForm.sell_price}
                        onChange={e => setStockForm({...stockForm, sell_price: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>= Purchase price per single dose</label>
                      <div className="packaging-total">
                        {packagingCalc.buyPerDose !== null ? `ETB ${packagingCalc.buyPerDose.toFixed(4)}` : '—'}
                      </div>
                    </div>
                    <div className="form-group">
                      <label>= Selling price per single dose</label>
                      <div className="packaging-total">
                        {packagingCalc.sellPerDose !== null ? `ETB ${packagingCalc.sellPerDose.toFixed(4)}` : '—'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label>Barcode *</label>
                  <input type="text" className="form-control" value={stockForm.barcode} onChange={e => setStockForm({...stockForm, barcode: e.target.value})} placeholder="Scan or enter barcode" />
                </div>
                <div className="form-group">
                  <label>QR Code</label>
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
              </fieldset>
              {savingStock && (
                <p className="form-hint" role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  <Loader2 size={14} className="spin" /> Saving Resupply — creating batch and updating inventory…
                </p>
              )}
              <div className="confirm-actions" style={{ marginTop: '1.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => !savingStock && setIsAddStockCountOpenSafe()} disabled={savingStock}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={savingStock} aria-busy={savingStock}>
                  {savingStock ? (<><Loader2 size={15} className="spin" /> Saving Resupply…</>) : 'Save Stock Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
