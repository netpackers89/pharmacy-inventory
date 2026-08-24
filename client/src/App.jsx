import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
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

import './styles/global.css';
import './styles/components.css';

export function AppContent() {
  const { user } = useAuth();
  const [activePage, setActivePage] = useState('dashboard');
  const [isBarcodeOpen, setIsBarcodeOpen] = useState(false);
  const [scannedMed, setScannedMed] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Show login/signup page if not authenticated
  if (!user) {
    return <AuthPage />;
  }

  const handleScanSuccess = (med) => {
    if (!med) return;

    setScannedMed(med);
    setIsBarcodeOpen(false);
    setActivePage('pos');
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

      {/* Main Main Content Wrapper */}
      <div className="main-wrapper">
        <Header
          onScanClick={() => setIsBarcodeOpen(true)}
          onSelectMedicine={() => setActivePage('pos')}
          toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          isSidebarOpen={sidebarOpen}
        />

        <main className="content-area">
          {activePage === 'dashboard' && <Dashboard onNavigate={(page) => setActivePage(page)} />}
          {activePage === 'drugs' && <Drugs onOpenPOS={() => setActivePage('pos')} />}
          {activePage === 'inventory' && <Inventory />}
          {activePage === 'pos' && (
            <POS
              onOpenBarcodeScanner={() => setIsBarcodeOpen(true)}
              scannedMedicine={scannedMed}
              onClearScannedMedicine={() => setScannedMed(null)}
            />
          )}
          {activePage === 'reports' && <Reports />}
          {activePage === 'settings' && <Settings />}
        </main>
      </div>

      {/* Barcode/QR Code Reader Simulator Modal */}
      <BarcodeModal
        isOpen={isBarcodeOpen}
        onClose={() => setIsBarcodeOpen(false)}
        onScanSuccess={handleScanSuccess}
      />

      {/* Floating scan button for small screens */}
      <button
        className="floating-scan-button"
        aria-label="Open QR scanner"
        onClick={() => setIsBarcodeOpen(true)}
      >
        Scan
      </button>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AuthProvider>
  );
}
