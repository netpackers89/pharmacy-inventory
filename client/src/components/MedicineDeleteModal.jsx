import React, { useState, useEffect } from 'react';
import { AlertTriangle, X, Loader2 } from 'lucide-react';

/*
 * MedicineDeleteModal — serious permanent-delete confirmation.
 *
 * Deliberately hard to trigger by accident:
 *   1. Lists EXACTLY what will be removed (medicine + its batches/current stock).
 *   2. States that historical pharmacy records are preserved where required.
 *   3. Requires the administrator to TYPE the medicine's name before the
 *      "Delete Permanently" button becomes enabled ("type to confirm").
 *   4. Only ADMINS can ever reach this flow (route-level requireAdmin
 *      additionally protects the DELETE endpoint server-side).
 */
export const MedicineDeleteModal = ({
  medicine,
  onConfirm,
  onCancel,
  loading = false,
}) => {
  const [typed, setTyped] = useState('');

  const medicineName = medicine?.generic_name || medicine?.name || '';

  useEffect(() => {
    if (medicine) setTyped('');
  }, [medicine?.medicine_id || medicine?.id]);

  if (!medicine) return null;

  const matches = typed.trim().toLowerCase() === medicineName.trim().toLowerCase();

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 1300 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel?.();
      }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="med-delete-title"
    >
      <div className="modal-card confirm-dialog" style={{ maxWidth: '520px' }}>
        <div className="confirm-dialog__icon danger">
          <AlertTriangle size={24} />
        </div>

        <h3 id="med-delete-title" className="confirm-dialog__title" style={{ marginBottom: '0.2rem' }}>
          Delete Medicine?
        </h3>
        <p className="confirm-dialog__message" style={{ textAlign: 'left', fontSize: '0.9rem' }}>
          <strong className="td-strong" style={{ display: 'block', marginBottom: '0.4rem' }}>
            {medicineName}{medicine.strength ? ` ${medicine.strength}` : ''}
            {medicine.brand_name ? ` (${medicine.brand_name})` : ''}
          </strong>
          This will <strong>permanently remove</strong>:
        </p>

        <ul className="med-delete-impacts">
          <li>Medicine information (name, brand, clinical details, image)</li>
          <li>Its associated inventory batches</li>
          <li>Current stock records derived from those batches</li>
        </ul>

        <p className="med-delete-preserve" style={{ fontSize: '0.84rem' }}>
          Historical sales, resupply and audit records are preserved where required.
          <strong>This action cannot be undone.</strong>
        </p>

        <div className="form-group" style={{ marginTop: '0.9rem' }}>
          <label htmlFor="med-delete-type" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
            Type “{medicineName}” to confirm deletion.
          </label>
          <input
            id="med-delete-type"
            type="text"
            className="form-control"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={medicineName}
            autoFocus
          />
        </div>

        <div className="confirm-actions" style={{ marginTop: '1.25rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary confirm-danger"
            onClick={onConfirm}
            disabled={loading || !matches || !medicineName.trim()}
            aria-busy={loading}
            title={matches ? 'Permanently delete this medicine' : 'Type the medicine name to enable permanent deletion'}
          >
            {loading && <Loader2 size={15} className="spin" />}
            {loading ? 'Deleting…' : 'Delete Permanently'}
          </button>
        </div>

        <button
          type="button"
          className="modal-close-btn"
          style={{ position: 'absolute', top: '0.75rem', right: '0.75rem' }}
          onClick={onCancel}
          disabled={loading}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default MedicineDeleteModal;