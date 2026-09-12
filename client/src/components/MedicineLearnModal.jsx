import React, { useState, useEffect } from 'react';
import './MedicineLearnModal.css';
import {
  X, Stethoscope, ShieldAlert, MessageCircle,
  Package, Boxes, CalendarClock, AlertCircle, Clock,
} from 'lucide-react';
import { medicinesAPI } from '../services/api';
import { MedicineImage } from './MedicineImage';

/* ─── info card ─── */
const InfoCard = ({ icon, title, children, accent }) => {
  if (!children) return null;
  return (
    <div className={`lm-card lm-card--${accent || 'default'}`}>
      <div className="lm-card__head">
        <span className="lm-card__icon">{icon}</span>
        <span className="lm-card__title">{title}</span>
      </div>
      <div className="lm-card__body">{children}</div>
    </div>
  );
};

const fmtDate = (d) => {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch (_) { return d; }
};

export const MedicineLearnModal = ({ medicineId, onClose }) => {
  const [med, setMed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [descExpanded, setDescExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDescExpanded(false);
    medicinesAPI.getById(medicineId)
      .then((res) => { if (!cancelled) setMed(res.data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [medicineId]);

  const detailRows = med ? [
    ['Generic Name', med.generic_name],
    ['Strength', med.strength],
    ['Dosage Form', med.dosage_form],
    ['Route', med.route],
    ['Prescription Type', med.prescription_type],
    ['Therapeutic Class', med.therapeutic_class],
    ['Manufacturer', med.manufacturer],
    ['Country of Origin', med.country],
    ['Storage', med.storage_conditions],
  ].filter(([, v]) => v) : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="lm lm--reader" onClick={(e) => e.stopPropagation()}>
        <button className="lm__close" onClick={onClose} aria-label="Close"><X size={18} /></button>

        {loading ? (
          <div className="lm__loading">
            <div className="lm__spinner" />
            Loading medicine information…
          </div>
        ) : !med ? (
          <div className="lm__loading">Medicine details could not be loaded.</div>
        ) : (
          <>
            {/* ── TOP: cover + main info (GoodReads-style reader) ── */}
            <div className="lm__top">
              <div className="lm__cover-wrap">
                <span className="lm__cover-blob" aria-hidden="true" />
                <div className="lm__cover">
                  <MedicineImage src={med.image_url} alt={med.generic_name} />
                </div>
              </div>

              <div className="lm__main">
                <span className="lm__hero-rx">{med.prescription_type || 'OTC'}</span>
                <h1 className="lm__main-title">{med.brand_name || med.generic_name}</h1>
                {med.manufacturer && (
                  <p className="lm__byline">
                    by <strong>{med.manufacturer}</strong>
                    {med.country ? ` · ${med.country}` : ''}
                  </p>
                )}
                <p className="lm__main-sub">
                  {med.generic_name}
                  {med.strength ? ` • ${med.strength}` : ''}
                  {med.dosage_form ? ` • ${med.dosage_form}` : ''}
                  {med.route ? ` • ${med.route}` : ''}
                </p>

                <div className="lm__hero-tags">
                  {med.category_name && <span className="lm-tag lm-tag--primary">{med.category_name}</span>}
                  {med.sub_category_name && <span className="lm-tag">{med.sub_category_name}</span>}
                  {med.therapeutic_class && <span className="lm-tag">{med.therapeutic_class}</span>}
                  {med.pharmacological_class && <span className="lm-tag">{med.pharmacological_class}</span>}
                  <span className={`lm-tag ${med.status === 'ACTIVE' ? 'lm-tag--ok' : 'lm-tag--muted'}`}>
                    {med.status || 'ACTIVE'}
                  </span>
                </div>

                {med.description && (
                  <div className="lm__desc-block">
                    <p className={`lm__desc-text ${descExpanded ? '' : 'clamped'}`}>{med.description}</p>
                    <button
                      type="button"
                      className="lm__readmore"
                      onClick={() => setDescExpanded((v) => !v)}
                    >
                      {descExpanded ? 'Show less' : 'Read more'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ── STATS BAR ── */}
            <div className="lm__stats-bar">
              <div className="lm-stat">
                <Boxes size={16} />
                <span className="lm-stat__num">{med.stock_on_hand || 0}</span>
                <span className="lm-stat__lbl">In Stock</span>
              </div>
              <div className="lm-stat">
                <Package size={16} />
                <span className="lm-stat__num">{med.active_batches || 0}</span>
                <span className="lm-stat__lbl">Batches</span>
              </div>
              <div className="lm-stat">
                <Clock size={16} />
                <span className="lm-stat__num">{med.reorder_level ?? '—'}</span>
                <span className="lm-stat__lbl">Reorder Lvl</span>
              </div>
              <div className="lm-stat">
                <CalendarClock size={16} />
                <span className="lm-stat__num">{fmtDate(med.nearest_expiry) || '—'}</span>
                <span className="lm-stat__lbl">Nearest Expiry</span>
              </div>
            </div>

            {/* ── CONTENT ── */}
            <div className="lm__content">
              {/* Indications — the featured, reading-focused section */}
              <section className="lm__featured">
                <div className="lm__featured-head">
                  <span className="lm__featured-icon"><Stethoscope size={16} /></span>
                  <h2>Indications</h2>
                  <span className="lm__featured-hint">What this medicine is used for</span>
                </div>
                <p className="lm__featured-body">
                  {med.indications || 'No indication recorded for this medicine yet.'}
                </p>
              </section>

              {/* Book-details-style fact table */}
              {detailRows.length > 0 && (
                <div className="lm__details">
                  <h3 className="lm__details-title">Drug Details</h3>
                  <dl className="lm__details-table">
                    {detailRows.map(([label, value]) => (
                      <div key={`lm-detail-${label}`} className="lm__details-row">
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              <InfoCard icon={<ShieldAlert size={15} />} title="Contraindications" accent="red">
                <p>{med.contraindications}</p>
              </InfoCard>

              <InfoCard icon={<AlertCircle size={15} />} title="Side Effects" accent="amber">
                <p>{med.side_effects}</p>
              </InfoCard>

              <InfoCard icon={<ShieldAlert size={15} />} title="Warnings" accent="red">
                <p>{med.warnings}</p>
              </InfoCard>

              <InfoCard icon={<MessageCircle size={15} />} title="Counseling Points" accent="purple">
                <p>{med.counseling_points}</p>
              </InfoCard>
            </div>
          </>
        )}
      </div>
    </div>
  );
};