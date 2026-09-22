import React, { useState } from 'react';
import { useTerms } from '../context/TermsContext';
import { ShieldCheck } from 'lucide-react';
import './TermsGate.css';

export const TermsGate = ({ children }) => {
  const { accepted, acceptTerms } = useTerms();
  const [termsConsent, setTermsConsent] = useState(false);
  const [cameraConsent, setCameraConsent] = useState(false);

  if (accepted) return <>{children}</>;

  return (
    <div className="terms-gate-overlay" data-theme="light">
          <div className="terms-gate-card" role="dialog" aria-modal="true" aria-labelledby="terms-title">
            <div className="terms-gate__header">
              <ShieldCheck className="terms-gate__icon" size={28} />
              <h1 id="terms-title">Pharmacy Inventory &amp; POS System</h1>
            </div>

            <div className="terms-gate__body">
              <p>
                Before using this system you must review and accept the Terms &amp; Conditions
                and Privacy Notice. This is a professional pharmacy management application —
                only trained personnel should operate it.
              </p>

              <div className="terms-gate__consent">
                <label>
                  <input
                    type="checkbox"
                    checked={termsConsent}
                    onChange={(event) => setTermsConsent(event.target.checked)}
                  />
                  <span>I agree to the Terms &amp; Conditions and Privacy Notice</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={cameraConsent}
                    onChange={(event) => setCameraConsent(event.target.checked)}
                  />
                  <span>
                    I understand that camera access is used only when barcode/QR scanning is
                    turned on, and no video is recorded or uploaded.
                  </span>
                </label>
              </div>

              
            </div>

            <button
              className="terms-gate__continue btn btn--primary"
              disabled={!termsConsent || !cameraConsent}
              onClick={() => {
                acceptTerms();
              }}
            >
              Continue to the system
            </button>
          </div>
    </div>
  );
};
