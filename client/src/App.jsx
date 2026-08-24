import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { BarcodeModal } from './components/BarcodeModal';

import { AuthPage } from './pages/AuthPage';
import { Dashboard } from './pages/Dashboard';
import { Drugs } from './pages/Drugs';
import { Inventory } from './pages/Inventory';
import { POS } from './pages/POS';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { Suppliers } from './pages/Suppliers';

import { QrCode, EyeOff } from 'lucide-react';
import './styles/global.css';
import './styles/components.css';

/* Read-only landing shown when a guest opens a write surface */
const GuestOnlyPage = ({ title, description }) => (
  <div className="empty-state fade-in" style={{ minHeight: '60vh' }}>
    <div className="empty-state__icon"><EyeOff size={26} /></div>
    <div className="empty-state__title">{title}</div>
    <div className="empty-state__desc">{description}</div>
  </div>
);

export function AppContent() {
  const { user, isGuest } = useAuth();
  const [activePage, setActivePage] = useState('dashboard');
  const [isBarcodeOpen, setIsBarcodeOpen] = useState(false);
  const [scannedMed, setScannedMed] = useState(null);
  const [registerCode, setRegisterCode] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /*
   * The POS cart lives here (App level) so scanning a medicine from the
   * header — or simply visiting another page — NEVER wipes items that
   * are already in an ongoing sale.
   */
  const [posCart, setPosCart] = useState([]);

  // Show the authentication page if not signed in
  if (!user) {
    return <AuthPage />;
  }

  const handleScanSuccess = (med) => {
    if (!med) return;
    setScannedMed(med);
    setIsBarcodeOpen(false);
    setActivePage('pos');
  };

  /*
   * Scanner "not registered" flow:
   * an unknown barcode/QR can be sent straight into the medicine
   * registration form, pre-filled with the scanned code.
   */
  const handleRegisterUnknown = (code) => {
    setIsBarcodeOpen(false);
    setRegisterCode(code || null);
    setActivePage('drugs');
  };

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <Sidebar
        activePage={activePage}
        setActivePage={(page) => { setActivePage(page); setSidebarOpen(false); }}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content Wrapper */}
      <div className="main-wrapper">
        <Header
          onScanClick={() => setIsBarcodeOpen(true)}
          onSelectMedicine={() => setActivePage('pos')}
          toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          isSidebarOpen={sidebarOpen}
        />

        <main className="content-area">
          {activePage === 'dashboard' && <Dashboard onNavigate={(page) => setActivePage(page)} />}
          {activePage === 'drugs' && (
            <Drugs
              onOpenPOS={() => setActivePage('pos')}
              prefillCode={registerCode}
              onConsumePrefill={() => setRegisterCode(null)}
            />
          )}
          {activePage === 'inventory' && <Inventory />}
          {activePage === 'suppliers' && <Suppliers />}
          {activePage === 'pos' && (
            isGuest ? (
              <GuestOnlyPage
                title="POS is unavailable in Guest Mode"
                description="Selling medicines requires a pharmacy account. Sign in with a staff account to process sales."
              />
            ) : (
              <POS
                onOpenBarcodeScanner={() => setIsBarcodeOpen(true)}
                scannedMedicine={scannedMed}
                onClearScannedMedicine={() => setScannedMed(null)}
                cart={posCart}
                setCart={setPosCart}
              />
            )
          )}
          {activePage === 'reports' && <Reports />}
          {activePage === 'settings' && (
            isGuest ? (
              <GuestOnlyPage
                title="Settings are unavailable in Guest Mode"
                description="System configuration requires an administrator account."
              />
            ) : (
              <Settings />
            )
          )}
        </main>
      </div>

      {/* Barcode/QR Code Reader Modal */}
      <BarcodeModal
        isOpen={isBarcodeOpen}
        onClose={() => setIsBarcodeOpen(false)}
        onScanSuccess={handleScanSuccess}
        onRegisterRequest={handleRegisterUnknown}
      />

      {/* Floating scan button for small screens */}
      <button
        className="floating-scan-button"
        aria-label="Open barcode / QR scanner"
        onClick={() => setIsBarcodeOpen(true)}
      >
        <QrCode size={18} />
        Scan
      </button>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
