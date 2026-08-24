const fs = require('fs');

const fileContent = `import React, { useState, useEffect } from 'react';
import './POS.css';
import { ShoppingCart, Search, QrCode, Trash2, CheckCircle2, AlertTriangle, Stethoscope, X } from 'lucide-react';
import { inventoryAPI, salesAPI, aiAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const FREQUENCIES = [
  { code: 'QD', label: 'QD — Once daily', per_day: 1 },
  { code: 'BID', label: 'BID — Twice daily', per_day: 2 },
  { code: 'TID', label: 'TID — Three times daily', per_day: 3 },
  { code: 'QID', label: 'QID — Four times daily', per_day: 4 },
  { code: 'QOD', label: 'QOD — Every other day', per_day: 0.5 },
  { code: 'Q4H', label: 'Q4H — Every 4 hours', per_day: 6 },
  { code: 'Q6H', label: 'Q6H — Every 6 hours', per_day: 4 },
  { code: 'Q8H', label: 'Q8H — Every 8 hours', per_day: 3 },
  { code: 'Q12H', label: 'Q12H — Every 12 hours', per_day: 2 },
  { code: 'QW', label: 'QW — Once weekly', per_day: 1/7 },
  { code: 'BIW', label: 'BIW — Twice weekly', per_day: 2/7 },
  { code: 'PRN', label: 'PRN — As needed', per_day: null },
  { code: 'STAT', label: 'STAT — Immediately (single dose)', per_day: null },
];

const ROUTES = [
  { code: 'PO', label: 'PO — Oral' },
  { code: 'SL', label: 'SL — Sublingual' },
  { code: 'BU', label: 'BU — Buccal' },
  { code: 'IV', label: 'IV — Intravenous' },
  { code: 'IM', label: 'IM — Intramuscular' },
  { code: 'SC', label: 'SC — Subcutaneous' },
  { code: 'Top', label: 'Top — Topical' },
  { code: 'OD', label: 'OD — Right eye' },
  { code: 'OS', label: 'OS — Left eye' },
  { code: 'OU', label: 'OU — Both eyes' },
  { code: 'AD', label: 'AD — Right ear' },
  { code: 'AS', label: 'AS — Left ear' },
  { code: 'AU', label: 'AU — Both ears' },
  { code: 'PR', label: 'PR — Rectal' },
  { code: 'PV', label: 'PV — Vaginal' },
  { code: 'INH', label: 'INH — Inhalation' },
];

function calculateDispensing(item) {
  const freq = FREQUENCIES.find(f => f.code === item.frequency_code);
  if (!freq || freq.per_day === null) {
    return { required_units: item.quantity, dispense_qty: item.quantity, dispense_units: item.quantity, dispense_label: `${item.quantity} units`, pkg_size: 1 };
  }
  const required_units = Math.ceil(item.dose_per_admin * freq.per_day * item.duration_days);
  const pkg_size = parseInt(item.package_capacity) || 1;
  const dispense_pkgs = Math.ceil(required_units / pkg_size);
  const dispense_units = dispense_pkgs * pkg_size;
  return {
    required_units,
    dispense_pkgs,
    dispense_units,
    pkg_size,
    dispense_label: pkg_size > 1 ? `${dispense_pkgs} strips (${dispense_units} units)` : `${required_units} units`
  };
}

function generateCounseling(item, freq, route) {
  if (!freq || freq.per_day === null) {
    return `Take ${item.dose_per_admin} units ${item.frequency_code === 'PRN' ? 'as needed' : 'immediately'} via ${route?.label || item.route_of_admin}.`;
  }
  return `Take ${item.dose_per_admin} unit(s) ${freq.label.split('—')[1]?.trim() || ''} for ${item.duration_days} days via ${route?.label?.split('—')[1]?.trim() || item.route_of_admin}. Complete the full prescribed course unless advised otherwise.`;
}

function writeFile() {
  fs.writeFileSync('/home/netsanetdesta/Downloads/pharmacy-inventory-main/pharmacy-inventory-main/client/src/pages/POS.jsx', fileContent);
  console.log('Done POS.jsx');
}

writeFile();
