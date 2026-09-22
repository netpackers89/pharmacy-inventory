import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const TermsContext = createContext();

const STORAGE_KEY = 'pharm_terms_accepted_v1';
const TERMS_VERSION = 'v1.0';

function tryRead(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

export const TermsProvider = ({ children }) => {
  const [accepted, setAccepted] = useState(() => {
    const saved = tryRead(STORAGE_KEY);
    return saved === TERMS_VERSION;
  });

  const acceptTerms = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, TERMS_VERSION); } catch (_) {}
    setAccepted(true);
  }, []);

  const rejectTerms = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    setAccepted(false);
  }, []);

  // Respond to storage changes from other tabs.
  useEffect(() => {
    const handler = (e) => {
      if (e.key === STORAGE_KEY) {
        const current = tryRead(STORAGE_KEY);
        setAccepted(current === TERMS_VERSION);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return (
    <TermsContext.Provider value={{ accepted, acceptTerms, rejectTerms, termsVersion: TERMS_VERSION }}>
      {children}
    </TermsContext.Provider>
  );
};

export const useTerms = () => useContext(TermsContext);