import React, { useState, useEffect, useRef } from 'react';
import './MedicineLearnModal.css';
import {
  ArrowLeft, Stethoscope, ShieldAlert, MessageCircle,
  Package, Boxes, CalendarClock, AlertCircle,
  Edit, Trash2, Power, PowerOff, ChevronDown, Truck, DollarSign,
  Layers, PackageCheck, FileClock, CircleDot, ShoppingCart, Loader2,
  Settings, MoreVertical, Info, Volume2,
} from 'lucide-react';
import { medicinesAPI } from '../services/api';
import { MedicineImage } from './MedicineImage';
import { PronunciationSpeaker } from './PronunciationSpeaker';
import { getStockStatus, fmtExpiry } from '../utils/stockStatus';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

/* ─── shared formatting ─── */
const fmtDate = (d) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch (_) { return d; }
};

const fmtMoney = (v) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? `ETB ${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
};

/* A value counts as "recorded" only when it is not null / undefined / blank. */
const hasValue = (v) => v !== null && v !== undefined && String(v).trim() !== '';

/* ─── building blocks for the expandable medical cards ─── */
const InfoText = ({ text, fallback = 'Not recorded yet.' }) => {
  const value = typeof text === 'string' ? text.trim() : text;
  return <p className="lm-acc__text">{value || fallback}</p>;
};

const InfoRows = ({ rows = [], empty = 'Not recorded yet.' }) => {
  const visible = rows.filter(([, v]) => hasValue(v));
  if (!visible.length) return <p className="lm-acc__text">{empty}</p>;
  return (
    <dl className="lm__kv">
      {visible.map(([label, value]) => (
        <div className="lm__kv-row" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
};
/**
 * MedicineDetails (MedicineLearnModal)
 *
 * The dedicated Medicine Details view. Opened by clicking a medicine row,
 * card or the View action anywhere in the app. Shows the complete master
 * record, current inventory/valuation, batch table, suppliers and clinical
 * information — with an Actions menu and a sticky action bar that surface the
 * full Edit / Deactivate-Activate / Delete-from-database set. Edit is offered
 * to every staff session (the backend allows PUT for pharmacists); Deactivate
 * and permanent Delete are ADMIN-only and hidden for everyone else — the
 * Express routes enforce the exact same rule on every mutation.
 *
 * RESPONSIVE CONTRACT — one markup, three intentionally different layouts:
 *   • Phone   (≤ 480px)    compact native-app sheet: centred hero, 2-column
 *                          quick stats, single-column expandable medical cards,
 *                          Sell/Resupply bar pinned to the bottom edge.
 *   • Tablet  (600–1024px) centred card: medicine image beside the identity
 *                          block, 4-column stat strip, 2-column card grid.
 *   • Desktop (≥ 1025px)   hero column beside the medical-information column,
 *                          full-width bin card and detail panels.
 * Every grid track is `minmax(0, …)`, every flex/grid child may shrink and all
 * long text wraps, so no viewport width produces horizontal page scrolling.
 */
export const MedicineLearnModal = ({
  medicineId,
  onClose,
  onEdit,
  onStatusChanged,
  onDeleteRequest,
  onSell,
  onResupply,
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = String(user?.role || '').toUpperCase() === 'ADMIN';

  const [med, setMed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [descExpanded, setDescExpanded] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /* Only the two most important cards start expanded; the rest open on tap. */
  const [openSections, setOpenSections] = useState({ basic: true, indications: true });
  const menuRef = useRef(null);

  /* Stop any in-flight speech when the modal closes / unmounts. */
  useEffect(() => () => {
    try { window.speechSynthesis?.cancel?.(); } catch (_) { /* ignore */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDescExpanded(false);
    setMenuOpen(false);
    medicinesAPI.getById(medicineId)
      .then((res) => { if (!cancelled) setMed(res.data); })
      .catch(() => { if (!cancelled) setMed(null); toast?.error('Unable to load medicine details.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [medicineId]);

  /* Close the Actions menu on outside click / Escape. */
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  /* ESC closes the whole modal (desktop convenience) — but never while the
     Actions menu is open, where ESC closes the menu only. */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !menuOpen) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen, onClose]);

  const toggleStatus = async () => {
    if (!med || statusBusy) return;
    const next = med.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setStatusBusy(true);
    try {
      await medicinesAPI.changeStatus(medicineId, next);
      toast.success(`${next === 'ACTIVE' ? 'Activated' : 'Deactivated'} ${med.generic_name}.`);
      const fresh = await medicinesAPI.getById(medicineId);
      setMed(fresh.data);
      onStatusChanged?.(fresh.data);
    } catch (err) {
      toast.error(err.response?.data?.error || `Unable to ${next === 'ACTIVE' ? 'activate' : 'deactivate'} this medicine.`);
    } finally {
      setStatusBusy(false);
      setMenuOpen(false);
    }
  };
  const batches = Array.isArray(med?.batches) ? med.batches : [];
  const suppliers = Array.isArray(med?.suppliers) ? med.suppliers : [];

  /* Administrative + stock status as one icon+label pair (never colour alone). */
  const stockStatus = getStockStatus(med);
  const isActive = med?.status === 'ACTIVE';

  /* The brand line is only useful when it differs from the generic name. */
  const brandDiffers = hasValue(med?.brand_name)
    && (med.brand_name || '').trim().toLowerCase() !== (med.generic_name || '').trim().toLowerCase();

  /* Packaging facts live on the batch rows, so the first batch is the sample. */
  const sampleBatch = batches[0] || {};

  /* Nearest-expiry urgency: × Expired / ⚠ Expiring Soon / ● date */
  const expiryUrgency = (m) => {
    if (!m?.nearest_expiry) return null;
    const days = Math.ceil((new Date(m.nearest_expiry) - new Date()) / 86400000);
    if (days < 0) return { tone: 'danger', icon: '×', text: `Expired — ${fmtExpiry(m.nearest_expiry)}` };
    if (days <= 90) return { tone: 'warning', icon: '⚠', text: `${fmtExpiry(m.nearest_expiry)} (${days}d)` };
    return { tone: 'success', icon: '●', text: fmtExpiry(m.nearest_expiry) };
  };

  /*
   * Which actions this viewer may perform — the detail view always shows the
   * full action set, but each entry is only rendered when the caller wired a
   * handler AND the signed-in role is allowed. The Express routes are the
   * source of truth: Edit = any staff session (PUT /medicines/:id),
   * Deactivate + Delete from database = ADMIN only (requireAdmin).
   */
  const canEdit = Boolean(onEdit);
  const canToggleStatus = isAdmin;
  const canDelete = isAdmin && Boolean(onDeleteRequest);
  /*
   * Admins get an admin-only overflow menu (Deactivate / Delete permanently),
   * so on phones the Edit action moves out of that menu and becomes its own
   * compact button: [ ✏ Edit ] [ ⋮ ]. Staff without admin actions keep Edit
   * inside the menu (otherwise the menu would be empty).
   */
  const hasAdminMenu = canToggleStatus || canDelete;
  const showQuickEdit = canEdit && hasAdminMenu;
  const hasActions = canEdit || hasAdminMenu;

  const statusTitle = med
    ? (isActive
      ? 'Deactivate: keeps all records but hides this medicine from POS'
      : 'Activate: allow this medicine to be sold again')
    : undefined;

  /* Master-record rows → "Basic Information" card. */
  const basicRows = med ? [
    ['Generic Name', med.generic_name],
    ['Brand Name', med.brand_name],
    ['Strength', med.strength],
    ['Dosage Form', med.dosage_form],
    ['Route', med.route],
    ['Prescription Type', med.prescription_type],
    ['Category', med.category_name],
    ['Subcategory', med.sub_category_name],
    ['Therapeutic Class', med.therapeutic_class],
    ['Manufacturer', med.manufacturer],
    ['Country of Origin', med.country],
  ] : [];

  /* Packaging / record rows → "Packaging & Other Info" card. */
  const otherRows = med ? [
    ['Packaging Unit', sampleBatch.packaging_unit],
    ['Units per Package', sampleBatch.units_per_package],
    ['Barcode', sampleBatch.barcode],
    ['Record Created', med.created_at ? fmtDate(med.created_at) : null],
    ['Last Updated', med.updated_at ? fmtDate(med.updated_at) : null],
  ] : [];

  /*
   * The medical information is a stack of expandable cards — one per topic —
   * so a long clinical record never becomes a single wall of text.
   */
  const infoSections = med ? [
    {
      key: 'basic',
      title: 'Basic Information',
      icon: <Info size={15} />,
      tone: 'primary',
      content: <InfoRows rows={basicRows} empty="No master data recorded for this medicine yet." />,
    },
    {
      key: 'indications',
      title: 'Indications',
      icon: <Stethoscope size={15} />,
      tone: 'primary',
      content: <InfoText text={med.indications} fallback="No indication recorded for this medicine yet." />,
    },
    {
      key: 'contraindications',
      title: 'Contraindications',
      icon: <ShieldAlert size={15} />,
      tone: 'red',
      content: <InfoText text={med.contraindications} />,
    },
    {
      key: 'side-effects',
      title: 'Side Effects',
      icon: <AlertCircle size={15} />,
      tone: 'amber',
      content: <InfoText text={med.side_effects} />,
    },
    {
      key: 'warnings',
      title: 'Warnings',
      icon: <ShieldAlert size={15} />,
      tone: 'red',
      content: <InfoText text={med.warnings} />,
    },
    {
      key: 'storage',
      title: 'Storage Conditions',
      icon: <Boxes size={15} />,
      tone: 'green',
      content: <InfoText text={med.storage_conditions} />,
    },
    {
      key: 'other',
      title: 'Packaging & Other Info',
      icon: <Package size={15} />,
      tone: 'muted',
      content: (
        <>
          <InfoRows rows={otherRows} empty="No packaging details recorded for this medicine yet." />
          {hasValue(med.counseling_points) && (
            <div className="lm__kv-note">
              <span className="lm__kv-note-title"><MessageCircle size={13} /> Counseling &amp; Advice</span>
              <p>{med.counseling_points}</p>
            </div>
          )}
        </>
      ),
    },
  ] : [];
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="lm lm--reader lm--details" onMouseDown={(e) => e.stopPropagation()}>

        {/* ── HEADER: back · status · actions ── */}
        {med && (
          <header className="lm__topbar">
            <button type="button" className="lm__back" onClick={onClose} aria-label="Back to the medicine list">
              <ArrowLeft size={16} /> <span className="lm__back-label">Back</span>
            </button>

            <span className={`lm__status-badge ${isActive ? '' : 'inactive'}`}>
              <CircleDot size={9} /> {isActive ? 'Active' : (med.status || 'Inactive')}
            </span>
            <span className={`lm__status-badge stock-${stockStatus.tone}`}>
              {stockStatus.icon} {stockStatus.label}
            </span>

            {hasActions && (
              <div className="lm__actions" ref={menuRef}>
                {showQuickEdit && (
                  <button type="button" className="lm__quick-edit" onClick={() => onEdit(med)}>
                    <Edit size={14} /> <span>Edit</span>
                  </button>
                )}
                <button
                  type="button"
                  className="lm__gear-btn"
                  aria-label="More actions"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  title="More actions"
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  <Settings size={17} className="lm__icon-gear" />
                  <MoreVertical size={18} className="lm__icon-more" />
                </button>
                {menuOpen && (
                  <div className="lm__actions-menu" role="menu">
                    {canEdit && (
                      <button
                        type="button"
                        role="menuitem"
                        className={showQuickEdit ? 'lm__menu-edit' : undefined}
                        onClick={() => { setMenuOpen(false); onEdit(med); }}
                      >
                        <Edit size={14} /> Edit medicine
                      </button>
                    )}
                    {canToggleStatus && (
                      <button type="button" role="menuitem" title={statusTitle} disabled={statusBusy} onClick={toggleStatus}>
                        {statusBusy
                          ? <Loader2 size={14} className="spin" />
                          : (isActive ? <PowerOff size={14} /> : <Power size={14} />)}
                        {isActive ? 'Deactivate (hide from POS)' : 'Activate medicine'}
                      </button>
                    )}
                    {canDelete && (
                      <>
                        <span className="lm__actions-menu-sep" aria-hidden="true" />
                        <button type="button" role="menuitem" className="lm__actions-menu-danger" onClick={() => { setMenuOpen(false); onDeleteRequest(med); }}>
                          <Trash2 size={14} /> Delete permanently
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </header>
        )}
        {loading ? (
          <div className="lm__loading">
            <div className="lm__spinner" />
            Loading medicine information…
          </div>
        ) : !med ? (
          <div className="lm__loading">Medicine details could not be loaded.</div>
        ) : (
          <div className="lm__detail-grid">

            {/* ── HERO: packaging image + identity ── */}
            <section className="lm__hero" aria-label="Medicine identity">
              <div className="lm__detail-cover-wrap">
                <div className="lm__detail-cover">
                  <MedicineImage className="medicine-image" src={med.image_url} alt={med.generic_name} />
                </div>
              </div>

              <div className="lm__detail-main">
                <span className="lm__detail-rx">{med.prescription_type || 'OTC'}</span>

                <h1 className="lm__detail-title">{med.generic_name}</h1>

                <p className="lm__detail-byline">
                  Generic: <strong>{med.generic_name}</strong>
                </p>
                {brandDiffers && (
                  <p className="lm__detail-byline">
                    Brand: <strong>{med.brand_name}</strong>
                  </p>
                )}

                {(med.pronunciation_english || med.pronunciation_amharic) && (
                  <div className="lm__detail-pron">
                    <span className="lm__pron-title"><Volume2 size={13} /> Pronunciation</span>
                    {med.pronunciation_english && (
                      <div className="lm__pron-row">
                        <span className="lm__pron-lang">English</span>
                        <span className="lm__pron-text" lang="en">{med.pronunciation_english}</span>
                        <PronunciationSpeaker text={med.pronunciation_english} language="en" />
                      </div>
                    )}
                    {med.pronunciation_amharic && (
                      <div className="lm__pron-row">
                        <span className="lm__pron-lang">Amharic</span>
                        <span className="lm__pron-text" lang="am">{med.pronunciation_amharic}</span>
                        <PronunciationSpeaker text={med.pronunciation_amharic} language="am-ET" />
                      </div>
                    )}
                  </div>
                )}

                <div className="lm__detail-sub">
                  {hasValue(med.strength) && <span>{med.strength}</span>}
                  <span>{[med.dosage_form, med.route].filter(Boolean).join(' • ') || '—'}</span>
                </div>

                <div className="lm__hero-tags">
                  {med.category_name && <span className="lm-tag lm-tag--primary">{med.category_name}</span>}
                  {med.sub_category_name && <span className="lm-tag">{med.sub_category_name}</span>}
                  {med.prescription_required && <span className="lm-tag lm-tag--amber">Rx required</span>}
                </div>

                {hasValue(med.description) && (
                  <div className="lm__desc-block">
                    <p className={`lm__desc-text ${descExpanded ? '' : 'clamped'}`}>{med.description}</p>
                    <button type="button" className="lm__readmore" onClick={() => setDescExpanded((v) => !v)}>
                      {descExpanded ? 'Show less' : 'Read more'}
                    </button>
                  </div>
                )}
              </div>
            </section>
            {/* ── QUICK STATS: compact 2-column grid on phones, one row on tablets ── */}
            <div className="lm__quick-stats" aria-label="Stock summary">
              <div className="lm-qstat">
                <span className="lm-qstat__lbl">Stock</span>
                <span className="lm-qstat__val">{med.stock_on_hand || 0}</span>
                <span className={`lm-qstat__hint lm-qstat__hint--${stockStatus.tone}`}>
                  {stockStatus.icon} {stockStatus.label}
                </span>
              </div>
              <div className="lm-qstat">
                <span className="lm-qstat__lbl">Status</span>
                <span className={`lm-qstat__val lm-qstat__val--${isActive ? 'success' : 'danger'}`}>
                  {isActive ? '● Active' : '× Inactive'}
                </span>
              </div>
              <div className="lm-qstat">
                <span className="lm-qstat__lbl">Reorder</span>
                <span className="lm-qstat__val">{med.reorder_level ?? '—'}</span>
              </div>
              <div className="lm-qstat">
                <span className="lm-qstat__lbl">Max Level</span>
                <span className="lm-qstat__val">{med.max_level ?? '—'}</span>
              </div>
            </div>

            {/* ── MEDICAL INFORMATION: one expandable card per topic ── */}
            <section className="lm__info" aria-label="Medical information">
              <div className="lm__accordion">
                {infoSections.map((s) => (
                  <div key={s.key} className={`lm-acc lm-acc--${s.tone}`}>
                    <button
                      type="button"
                      className="lm-acc__head"
                      aria-expanded={!!openSections[s.key]}
                      aria-controls={`lm-acc-panel-${s.key}`}
                      onClick={() => setOpenSections((o) => ({ ...o, [s.key]: !o[s.key] }))}
                    >
                      <span className="lm-acc__icon">{s.icon}</span>
                      <span className="lm-acc__title">{s.title}</span>
                      <ChevronDown size={16} className={`lm-acc__chev ${openSections[s.key] ? 'open' : ''}`} />
                    </button>
                    <div id={`lm-acc-panel-${s.key}`} className={`lm-acc__panel ${openSections[s.key] ? 'is-open' : ''}`}>
                      <div className="lm-acc__body">{s.content}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            {/* ── BIN CARD: stock summary + batch ledger ── */}
            <section className="lm__bincard">
              <h3 className="lm__bincard-title"><Layers size={15} /> Bin Card</h3>

              <div className="lm__stats-bar">
                <div className="lm-stat"><Package size={16} /><span className="lm-stat__num">{med.stock_on_hand || 0}</span><span className="lm-stat__lbl">Total Stock</span></div>
                <div className="lm-stat"><Layers size={16} /><span className="lm-stat__num">{med.active_batches || 0}{med.batch_count ? ` / ${med.batch_count}` : ''}</span><span className="lm-stat__lbl">Batches</span></div>
                <div className="lm-stat"><CalendarClock size={16} /><span className="lm-stat__num">{med.expiring_soon || 0}</span><span className="lm-stat__lbl">Expiring ≤ 90d</span></div>
                <div className="lm-stat"><DollarSign size={16} /><span className="lm-stat__num">{fmtMoney(med.stock_value_retail)}</span><span className="lm-stat__lbl">Value (retail)</span></div>
              </div>

              <div className="lm__details">
                <h3 className="lm__details-title"><FileClock size={13} /> Batches {batches.length ? `(${batches.length})` : ''}</h3>
                {batches.length === 0 ? (
                  <p className="lm-acc__text">No active batches for this medicine.</p>
                ) : (
                  <div className="lm-batch-scroll">
                    <table className="custom-table lm-batch-table">
                      <thead><tr><th>Batch</th><th>Supplier</th><th>Mfg Date</th><th>Expiry</th><th>ABC / VEN</th><th>Buy</th><th>Sell</th><th>Stock</th></tr></thead>
                      <tbody>
                        {batches.map((b) => (
                          <tr key={b.batch_id}>
                            <td><strong className="td-strong">{b.batch_number || '—'}</strong></td>
                            <td>{b.supplier_name || '—'}</td>
                            <td>{fmtDate(b.manufacture_date)}</td>
                            <td>{fmtExpiry(b.expiry_date)}</td>
                            <td>{[b.abc_category, b.ven_category].filter(Boolean).join(' / ') || '—'}</td>
                            <td>{fmtMoney(b.buy_price)}</td>
                            <td>{fmtMoney(b.sell_price)}</td>
                            <td><span className={`badge ${Number(b.stock_quantity) === 0 ? 'badge-danger' : Number(b.stock_quantity) < 10 ? 'badge-warning' : 'badge-secondary'}`}>{b.stock_quantity || 0}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
            {/* ── STOCK / PRICING / SUPPLIERS ── */}
            <div className="lm__extra-grid">
              <div className="lm__details">
                <h3 className="lm__details-title">Stock Overview</h3>
                <dl className="lm__details-table">
                  <div className="lm__details-row"><dt>Total Stock</dt><dd>{med.stock_on_hand || 0} units</dd></div>
                  <div className="lm__details-row"><dt>Active Batches</dt><dd>{med.active_batches || 0}{med.batch_count ? ` of ${med.batch_count}` : ''}</dd></div>
                  <div className="lm__details-row"><dt>Low (Reorder) Level</dt><dd>{med.reorder_level ?? '—'}</dd></div>
                  <div className="lm__details-row"><dt>Max Level</dt><dd>{med.max_level ?? '—'}</dd></div>
                  <div className="lm__details-row"><dt>Stock Status</dt><dd><span className={`lm__status-badge stock-${stockStatus.tone}`}>{stockStatus.icon} {stockStatus.label}</span></dd></div>
                  <div className="lm__details-row"><dt>Nearest Expiry</dt><dd>{expiryUrgency(med) ? (<span className={`lm__status-badge stock-${expiryUrgency(med).tone}`}>{expiryUrgency(med).icon} {expiryUrgency(med).text}</span>) : '—'}</dd></div>
                  <div className="lm__details-row"><dt>Stock Value (cost)</dt><dd>{fmtMoney(med.stock_value_cost)}</dd></div>
                  <div className="lm__details-row"><dt>Stock Value (retail)</dt><dd>{fmtMoney(med.stock_value_retail)}</dd></div>
                </dl>
              </div>

              <div className="lm__details">
                <h3 className="lm__details-title">Pricing &amp; Valuation</h3>
                <dl className="lm__details-table">
                  <div className="lm__details-row"><dt>Avg Buy Price (per unit)</dt><dd>{fmtMoney(med.avg_buy_price)}</dd></div>
                  <div className="lm__details-row"><dt>Sell Price (per unit)</dt><dd>{fmtMoney(med.min_sell_price)}{Number(med.max_sell_price) !== Number(med.min_sell_price) ? ` – ${fmtMoney(med.max_sell_price)}` : ''}</dd></div>
                </dl>
              </div>

              {suppliers.length > 0 && (
                <div className="lm__details lm__details--suppliers">
                  <h3 className="lm__details-title"><Truck size={13} /> Suppliers</h3>
                  <div className="lm__suppliers">
                    {suppliers.map((s) => (
                      <div key={s.supplier_id} className="lm__supplier">
                        <PackageCheck size={15} />
                        <div>
                          <strong>{s.name}</strong>
                          {s.contact_person && <small>{s.contact_person}{s.phone ? ` · ${s.phone}` : ''}</small>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ACTION BAR: primary sale actions, pinned below the scrolling body.
               Edit / Deactivate / Delete live in the header menu. ── */}
        {med && (onSell || onResupply) && (
          <div className="lm__footer-bar">
            {onSell && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={stockStatus.key === 'inactive' || stockStatus.key === 'out' || stockStatus.key === 'expired'}
                title={stockStatus.key === 'inactive' ? 'Inactive medicines cannot be sold' : stockStatus.key === 'expired' ? 'Expired stock cannot be sold' : undefined}
                onClick={() => onSell(med)}
              >
                <ShoppingCart size={15} /> Sell
              </button>
            )}
            {onResupply && (
              <button type="button" className="btn btn-secondary" onClick={() => onResupply(med)}>
                <PackageCheck size={15} /> Resupply
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MedicineLearnModal;







