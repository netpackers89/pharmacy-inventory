import React, { useEffect, useMemo, useState } from "react";
import "./POS.css";
import {
  AlertTriangle,
  CheckCircle2,
  Pill,
  QrCode,
  Search,
  ShoppingCart,
  Stethoscope,
  Trash2,
  X,
  ShieldCheck,
  Calculator,
  MessageSquareText,
  Printer,
} from "lucide-react";

import { inventoryAPI, salesAPI, ddiAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { EmptyState } from "../components/Feedback";

/*
  POS WORKFLOW

  Scan/Search
      -> find existing inventory medicine
      -> add the exact medicine to the current POS
      -> enter dose/frequency/duration/route
      -> automatically calculate required quantity
      -> automatically show counseling
      -> when 2+ medicines exist, run multi-drug interaction checking
      -> validate stock
      -> checkout
      -> backend creates the sale and deducts stock

  IMPORTANT:
  POS never creates a medicine or a batch.
  It only consumes existing inventory records.

  CART RULES:
  - Scanning a NEW medicine appends it to the cart.
  - Re-scanning a medicine already in the cart increases its quantity.
  - Existing items are never replaced or removed by a scan.
*/

const FREQUENCIES = [
  { code: "QD", label: "QD — Once daily", per_day: 1 },
  { code: "BID", label: "BID — Twice daily", per_day: 2 },
  { code: "TID", label: "TID — Three times daily", per_day: 3 },
  { code: "QID", label: "QID — Four times daily", per_day: 4 },
  { code: "QOD", label: "QOD — Every other day", per_day: 0.5 },
  { code: "Q4H", label: "Q4H — Every 4 hours", per_day: 6 },
  { code: "Q6H", label: "Q6H — Every 6 hours", per_day: 4 },
  { code: "Q8H", label: "Q8H — Every 8 hours", per_day: 3 },
  { code: "Q12H", label: "Q12H — Every 12 hours", per_day: 2 },
  { code: "QW", label: "QW — Once weekly", per_day: 1 / 7 },
  { code: "BIW", label: "BIW — Twice weekly", per_day: 2 / 7 },
  { code: "PRN", label: "PRN — As needed", per_day: null },
  { code: "STAT", label: "STAT — Immediately (single dose)", per_day: null },
];

const ROUTES = [
  { code: "PO", label: "PO — Oral" },
  { code: "SL", label: "SL — Sublingual" },
  { code: "BU", label: "BU — Buccal" },
  { code: "IV", label: "IV — Intravenous" },
  { code: "IM", label: "IM — Intramuscular" },
  { code: "SC", label: "SC — Subcutaneous" },
  { code: "Top", label: "Top — Topical" },
  { code: "OD", label: "OD — Right eye" },
  { code: "OS", label: "OS — Left eye" },
  { code: "OU", label: "OU — Both eyes" },
  { code: "AD", label: "AD — Right ear" },
  { code: "AS", label: "AS — Left ear" },
  { code: "AU", label: "AU — Both ears" },
  { code: "PR", label: "PR — Rectal" },
  { code: "PV", label: "PV — Vaginal" },
  { code: "INH", label: "INH — Inhalation" },
];

const numberOr = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const getFrequency = (code) =>
  FREQUENCIES.find((frequency) => frequency.code === code) || FREQUENCIES[1];

const getRoute = (code) =>
  ROUTES.find((route) => route.code === code) || ROUTES[0];

/* PRICE RULE:
   current_price = price of ONE STRIP.
   strip_size = number of single doses inside one strip (default 10). */
const calculateDispensing = (item) => {
  const dose = Math.max(0, numberOr(item.dose_per_admin, 0));
  const duration = Math.max(0, numberOr(item.duration_days, 0));
  const frequency = getFrequency(item.frequency_code);

  const stripSize = Math.max(
    1,
    Math.floor(numberOr(item.strip_size ?? item.package_capacity, 10)),
  );
  const stripPrice = Math.max(0, numberOr(item.current_price, 0));

  if (frequency.per_day === null) {
    const required_units = Math.max(1, Math.ceil(numberOr(item.quantity, 1)));
    const strips = Math.ceil(required_units / stripSize);
    const dispense_units = strips * stripSize;

    return {
      required_units,
      dispense_units,
      strips,
      strip_size: stripSize,
      strip_price: stripPrice,
      single_unit_price: stripPrice / stripSize,
      total_price: strips * stripPrice,
      formula: `${required_units} single dose(s) ÷ ${stripSize} single doses/strip = ${strips} strip(s)`,
    };
  }

  const required_units = Math.ceil(dose * frequency.per_day * duration);
  const strips = Math.ceil(required_units / stripSize);
  const dispense_units = strips * stripSize;

  return {
    required_units,
    dispense_units,
    strips,
    strip_size: stripSize,
    strip_price: stripPrice,
    single_unit_price: stripPrice / stripSize,
    total_price: strips * stripPrice,
    formula: `${dose} single dose(s) × ${frequency.per_day} times/day × ${duration} days = ${required_units} single doses`,
  };
};

const generateCounseling = (item) => {
  const frequency = getFrequency(item.frequency_code);
  const route = getRoute(item.route_of_admin);

  if (frequency.per_day === null) {
    if (item.frequency_code === "STAT") {
      return `Take ${item.dose_per_admin} unit(s) immediately via ${route.label.split("—")[1]?.trim() || route.label}.`;
    }

    return `Take ${item.dose_per_admin} unit(s) as needed via ${route.label.split("—")[1]?.trim() || route.label}, according to the pharmacist's instructions.`;
  }

  return `Take ${item.dose_per_admin} unit(s) ${frequency.label.split("—")[1]?.trim() || frequency.label} for ${item.duration_days} days via ${route.label.split("—")[1]?.trim() || route.label}. Follow the prescribed course and do not change the dose without professional advice.`;
};

const normalizeMedicine = (medicine) => ({
  ...medicine,
  medicine_id: medicine.medicine_id ?? medicine.id,
  generic_name: medicine.generic_name || medicine.name || "Unknown medicine",
  brand_name: medicine.brand_name || "",
  strength: medicine.strength || "",
  stock_on_hand: numberOr(medicine.stock_on_hand ?? medicine.stock_quantity, 0),
  // current_price is the price of ONE STRIP.
  current_price: numberOr(
    medicine.current_price ?? medicine.sell_price ?? medicine.price,
    0,
  ),
  strip_size: Math.max(
    1,
    Math.floor(
      numberOr(
        medicine.strip_size ??
          medicine.package_capacity ??
          medicine.units_per_strip,
        10,
      ),
    ),
  ),
  package_capacity: Math.max(1, numberOr(medicine.package_capacity, 10)),
  batch_id: medicine.batch_id ?? medicine.batch?.id ?? null,
  batch_number: medicine.batch_number ?? medicine.batch?.batch_number ?? "",
  expiry_date: medicine.expiry_date ?? medicine.batch?.expiry_date ?? null,
});

const getCartItemKey = (item) => {
  const medicineId = item?.medicine_id ?? item?.id ?? "unknown";
  const batchId = item?.batch_id ?? item?.batch?.id ?? "no-batch";
  return `${medicineId}-${batchId}`;
};

const escapeHtml = (unsafe) => {
  if (!unsafe && unsafe !== 0) return '';
  return String(unsafe).replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[m]; });
};

export const POS = ({
  onOpenBarcodeScanner,
  scannedMedicine,
  onClearScannedMedicine,
  cart: cartProp,
  setCart: setCartProp,
}) => {
  const { user } = useAuth();
  const { toast, withLoading } = useToast();

  // Cart is lifted to App so page changes never clear an ongoing sale.
  const [internalCart, setInternalCart] = useState([]);
  const cart = cartProp !== undefined ? cartProp : internalCart;
  const setCart = setCartProp !== undefined ? setCartProp : setInternalCart;

  const [stockList, setStockList] = useState([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [stockError, setStockError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [aiWarnings, setAiWarnings] = useState([]);
  const [hasInteractions, setHasInteractions] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const [showInteractionConfirm, setShowInteractionConfirm] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [finalSaleId, setFinalSaleId] = useState(null);
  const [finalTotal, setFinalTotal] = useState(0);

  const [dispensingDrawer, setDispensingDrawer] = useState({
    open: false,
    itemIndex: null,
  });

  const [drawerForm, setDrawerForm] = useState({
    dose_per_admin: 1,
    frequency_code: "BID",
    duration_days: 7,
    route_of_admin: "PO",
    counseling_note: "",
    package_capacity: 10,
  });

  useEffect(() => {
    let cancelled = false;
    setStockLoading(true);
    setStockError(false);

    inventoryAPI.getStock()
      .then((response) => {
        if (cancelled) return;
        const rows = response.data;
        setStockList(Array.isArray(rows) ? rows.map(normalizeMedicine) : []);
        setStockLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setStockList([]);
        setStockError(true);
        setStockLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  /*
    Scanner integration:
    The scanner parent passes an existing inventory medicine here.
    It is appended to the current POS cart — never replacing it.
  */
  useEffect(() => {
    if (!scannedMedicine) return;

    const medicine = normalizeMedicine(scannedMedicine);
    addToCart(medicine);

    if (onClearScannedMedicine) {
      onClearScannedMedicine();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedMedicine]);

  /*
    Drug–drug interaction checking (LOCAL DDI dataset — not AI):
    Runs whenever the medicine list changes. Unique unordered pairs are
    checked server-side; results are deterministic and auditable.
  */
  useEffect(() => {
    if (cart.length < 1) {
      setHasInteractions(false);
      setAiWarnings([]);
      setAiLoading(false);
      return;
    }

    let cancelled = false;

    const checkCombination = async () => {
      setAiLoading(true);

      try {
        const response = await ddiAPI.check(cart);
        if (cancelled) return;

        const data = response.data || {};
        setHasInteractions(Boolean(data.hasInteractions));
        setAiWarnings(Array.isArray(data.alerts) ? data.alerts : []);
        if (data.error) {
          toast.warning(data.error);
        }
      } catch {
        if (!cancelled) {
          // Never block the sale on a failed check — surface it clearly.
          setHasInteractions(false);
          setAiWarnings([]);
          toast.warning("Interaction check is temporarily unavailable. Pharmacist judgement required.");
        }
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    };

    checkCombination();

    return () => {
      cancelled = true;
    };
  }, [cart]);

  const addToCart = (medicine) => {
    const med = normalizeMedicine(medicine);

    if (!med.medicine_id) {
      toast.error("This medicine has no valid inventory ID.");
      return;
    }

    if (med.stock_on_hand <= 0) {
      toast.warning(`${med.generic_name} is out of stock.`);
      return;
    }

    setCart((current) => {
      const itemKey = getCartItemKey(med);
      const existingIndex = current.findIndex(
        (item) => getCartItemKey(item) === itemKey,
      );

      // Already in cart → increase quantity. Never duplicate, never replace.
      if (existingIndex >= 0) {
        const updated = [...current];
        const existing = updated[existingIndex];

        if (Number(existing.quantity || 1) + 1 > Number(existing.stock_on_hand)) {
          toast.warning(`Only ${existing.stock_on_hand} units of ${med.generic_name} are in stock.`);
          return current;
        }

        updated[existingIndex] = {
          ...existing,
          quantity: Number(existing.quantity || 1) + 1,
        };
        toast.info(`${med.generic_name} quantity increased.`);
        return updated;
      }

      const newItem = {
        ...med,
        cart_key: itemKey,
        quantity: 1,
        dose_per_admin: 1,
        frequency_code: "BID",
        duration_days: 7,
        route_of_admin: "PO",
        counseling_note: generateCounseling({
          ...med,
          dose_per_admin: 1,
          frequency_code: "BID",
          duration_days: 7,
          route_of_admin: "PO",
        }),
        has_rx: false,
      };

      return [...current, newItem];
    });

    setSearchQuery("");
  };

  const removeFromCart = (index) => {
    setCart((current) => current.filter((_, i) => i !== index));
  };

  const updateQuantity = (index, value) => {
    const quantity = Math.floor(Number(value));

    if (!Number.isFinite(quantity) || quantity < 1) return;

    setCart((current) => {
      const updated = [...current];

      if (quantity > updated[index].stock_on_hand) {
        toast.warning("Quantity cannot exceed available stock.");
        return current;
      }

      updated[index] = {
        ...updated[index],
        quantity,
      };

      return updated;
    });
  };

  /* Price comes from inventory/batch pricing — cashiers cannot edit it. */

  const updateRx = (index, field, value) => {
    setCart((current) => {
      const updated = [...current];
      const item = { ...updated[index] };

      if (field === "dose_per_admin" || field === "duration_days") {
        item[field] = Math.max(1, Math.floor(Number(value) || 1));
      } else {
        item[field] = value;
      }

      item.counseling_note = generateCounseling(item);

      const calculation = calculateDispensing(item);

      /*
        Required quantity is what the prescription calculates.
        If packaging requires rounding, dispense_units represents the
        actual stock quantity to be sold.
      */
      if (calculation.dispense_units <= item.stock_on_hand) {
        item.quantity = calculation.dispense_units;
      }

      updated[index] = item;
      return updated;
    });
  };

  const openDrawer = (index) => {
    const item = cart[index];

    setDrawerForm({
      dose_per_admin: item.dose_per_admin || 1,
      frequency_code: item.frequency_code || "BID",
      duration_days: item.duration_days || 7,
      route_of_admin: item.route_of_admin || "PO",
      counseling_note:
        item.counseling_note ||
        generateCounseling({
          ...item,
          dose_per_admin: item.dose_per_admin || 1,
          frequency_code: item.frequency_code || "BID",
          duration_days: item.duration_days || 7,
          route_of_admin: item.route_of_admin || "PO",
        }),
      package_capacity: item.package_capacity || item.strip_size || 10,
    });

    setDispensingDrawer({
      open: true,
      itemIndex: index,
    });
  };

  const applyDrawer = () => {
    if (dispensingDrawer.itemIndex === null) return;

    const index = dispensingDrawer.itemIndex;
    const currentItem = cart[index];

    const item = {
      ...currentItem,
      ...drawerForm,
      dose_per_admin: Math.max(1, numberOr(drawerForm.dose_per_admin, 1)),
      duration_days: Math.max(1, numberOr(drawerForm.duration_days, 7)),
      package_capacity: Math.max(1, numberOr(drawerForm.package_capacity, 10)),
      strip_size: Math.max(1, numberOr(drawerForm.package_capacity, 10)),
      has_rx: true,
    };

    item.counseling_note =
      drawerForm.counseling_note || generateCounseling(item);

    const calculation = calculateDispensing(item);

    if (calculation.dispense_units > item.stock_on_hand) {
      toast.warning(
        `Required quantity is ${calculation.dispense_units}, but only ${item.stock_on_hand} units are available.`,
      );
      return;
    }

    setCart((current) => {
      const updated = [...current];
      updated[index] = {
        ...item,
        quantity: calculation.dispense_units,
      };
      return updated;
    });

    setDispensingDrawer({
      open: false,
      itemIndex: null,
    });
  };

  const calculateTotal = useMemo(
    () =>
      cart
        .reduce(
          (sum, item) =>
            sum + numberOr(item.current_price, 0) * numberOr(item.quantity, 0),
          0,
        )
        .toFixed(2),
    [cart],
  );

  const printReceipt = (options = {}) => {
    const pharmacyName = options.pharmacyName || 'NET-PHARMA';
    const now = new Date();
    const rows = cart.map((it, i) => {
      const calc = calculateDispensing(it);
      return `<tr style="border-bottom:1px solid #eee"><td style="padding:8px 0"><strong>${i+1}. ${escapeHtml(it.generic_name)}</strong>${it.brand_name ? ' <span style="color:#666">('+escapeHtml(it.brand_name)+')</span>' : ''}<div style="font-size:12px;color:#666">${escapeHtml(it.strength || '')}</div></td><td style="padding:8px 0; text-align:right">${calc.dispense_units} units</td></tr>
        <tr><td colspan="2" style="padding:4px 0 12px 0; font-size:12px; color:#333">Counseling: ${escapeHtml(it.counseling_note || '—')}</td></tr>`;
    }).join('');

    const total = numberOr(calculateTotal, 0);

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;padding:20px} .card{max-width:680px;margin:0 auto;border-radius:12px;padding:20px;border:1px solid #e6eef7} h1{margin:0;font-size:20px} .meta{color:#64748b;font-size:13px;margin-top:6px} table{width:100%;border-collapse:collapse;margin-top:16px} td{vertical-align:top} .total{display:flex;justify-content:space-between;padding-top:12px;border-top:1px solid #e6eef7;margin-top:12px;font-weight:800;font-size:16px}</style></head><body><div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div><h1>${escapeHtml(pharmacyName)}</h1><div class="meta">Receipt — ${now.toLocaleString()}</div></div><div style="text-align:right;color:#64748b;font-size:12px">Powered by NET-PHARMA</div></div><div style="margin-top:12px;color:#334155">Items</div><table>${rows}</table><div class="total"><div>Total</div><div>ETB ${Number(total).toFixed(2)}</div></div><div style="margin-top:18px;font-size:13px;color:#475569">Thank you for your purchase. For medicine counselling please follow instructions above or contact your pharmacist.</div></div><script>function printAndClose(){window.print();}</script></body></html>`;

    const w = window.open('', '_blank');
    if (!w) { toast.error('Pop-up blocked. Allow pop-ups for printing.'); return; }
    w.document.write(html);
    w.document.close();
    w.onload = () => { w.focus(); w.print(); };
  };

  const selectedItemCount = cart.length;

  const hasCriticalInteractions = useMemo(
    () => aiWarnings.filter((w) => w.severity === 1).length,
    [aiWarnings],
  );

  const stockProblems = useMemo(
    () =>
      cart.filter(
        (item) => numberOr(item.quantity, 0) > numberOr(item.stock_on_hand, 0),
      ),
    [cart],
  );

  const handleCheckout = async () => {
    if (!cart.length) {
      toast.warning("Add at least one medicine before checkout.");
      return;
    }

    if (stockProblems.length) {
      toast.error("One or more medicines exceed available stock.");
      return;
    }

    if (aiLoading) {
      toast.warning("Please wait for the interaction check to finish.");
      return;
    }

    // Only CRITICAL interactions require an explicit pharmacist override reason.
    const criticalCount = aiWarnings.filter((w) => w.severity === 1).length;
    if (criticalCount > 0) {
      setShowInteractionConfirm(true);
      return;
    }

    await proceedCheckout();
  };

  const proceedCheckout = async () => {
    const criticalCount = aiWarnings.filter((w) => w.severity === 1).length;
    if (criticalCount > 0 && !overrideReason.trim()) {
      toast.error("A pharmacist review reason is required for critical interactions.");
      return;
    }

    setShowInteractionConfirm(false);

    try {
      const payload = {
        user_id: user?.id || 1,
        payment_method: "CASH",
        override_reason: overrideReason.trim() || null,

        /*
          Every selected medicine remains an individual sale line.
          The backend uses the medicine/batch inventory relation
          to deduct stock and write the stock/bin-card transaction.
        */
        items: cart.map((item) => {
          const calculation = calculateDispensing(item);

          return {
            medicine_id: item.medicine_id,
            batch_id: item.batch_id || null,
            // Inventory stock is counted as SINGLE doses.
            quantity: item.quantity,
            strip_size: item.strip_size || 10,
            strip_quantity: Math.ceil(
              item.quantity / Math.max(1, item.strip_size || 10),
            ),

            required_units: calculation.required_units,
            dispense_units: calculation.dispense_units,

            dose_per_admin: item.has_rx ? item.dose_per_admin : null,
            frequency_code: item.has_rx ? item.frequency_code : null,
            duration_days: item.has_rx ? item.duration_days : null,
            route_of_admin: item.has_rx ? item.route_of_admin : null,
            counseling_note: item.has_rx ? item.counseling_note : null,
          };
        }),
      };

      const response = await withLoading(() => salesAPI.create(payload), {
        loadingMsg: "Processing sale and updating inventory...",
        successMsg: "Sale completed successfully!",
      });

      setFinalSaleId(response.data?.sale_id);
      setFinalTotal(
        numberOr(response.data?.total_amount, Number(calculateTotal)),
      );
      setCheckoutSuccess(true);

      setCart([]);
      setOverrideReason("");

      setTimeout(() => {
        setCheckoutSuccess(false);
        setFinalSaleId(null);
        setFinalTotal(0);
      }, 5000);
    } catch (error) {
      toast.error(
        `Failed to process checkout: ${
          error.response?.data?.error || error.message || "Unknown error"
        }`,
      );
    }
  };

  const drawerItem =
    dispensingDrawer.open && dispensingDrawer.itemIndex !== null
      ? cart[dispensingDrawer.itemIndex]
      : null;

  const drawerCalculation = drawerItem
    ? calculateDispensing({
        ...drawerItem,
        ...drawerForm,
      })
    : null;

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) return [];

    return stockList
      .filter((medicine) => {
        return (
          medicine.generic_name.toLowerCase().includes(query) ||
          medicine.brand_name.toLowerCase().includes(query) ||
          medicine.strength.toLowerCase().includes(query) ||
          medicine.batch_number.toLowerCase().includes(query)
        );
      })
      .slice(0, 20);
  }, [searchQuery, stockList]);

  const checkoutBlocked = cart.length === 0 || aiLoading || stockProblems.length > 0;

  return (
    <div className="pos-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Point of Sale</h1>
          <p>
            Scan or search a medicine, add multiple medicines, check
            interactions, and complete the sale.
          </p>
        </div>
      </div>

      {checkoutSuccess && (
        <div className="checkout-success slide-up" role="status">
          <CheckCircle2 size={30} />
          <div>
            <strong>Sale Completed Successfully</strong>
            <p>Receipt #{finalSaleId || "—"} · Total: ETB {finalTotal.toFixed(2)}</p>
          </div>
        </div>
      )}

      <div className="pos-layout">
        {/* ══ LEFT · SEARCH + CART ══ */}
        <section className="pos-main-card">
          <div className="pos-scan-and-search">
            <div className="smart-search-input-wrap pos-search-wrap">
              <Search size={17} />
              <input
                type="text"
                placeholder={stockError ? "Inventory could not be loaded — retry from the Inventory page" : "Search generic, brand, strength or batch…"}
                disabled={stockLoading || stockError}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                aria-label="Search medicines to add"
              />

              {searchResults.length > 0 && (
                <div className="pos-results fade-in" role="listbox">
                  {searchResults.map((medicine) => (
                    <button
                      type="button"
                      key={`${medicine.medicine_id}-${medicine.batch_id || "stock"}`}
                      role="option"
                      aria-selected="false"
                      onClick={() => addToCart(medicine)}
                      className="pos-result-item"
                    >
                      <span className="pos-result-name">
                        <strong>
                          {medicine.generic_name}
                          {medicine.brand_name ? ` (${medicine.brand_name})` : ""}
                        </strong>
                        <small>
                          {medicine.strength || "No strength"} · Stock:{" "}
                          {medicine.stock_on_hand}
                          {medicine.batch_number ? ` · Batch ${medicine.batch_number}` : ""}
                        </small>
                      </span>
                      <strong className="pos-result-price">
                        ETB {medicine.current_price.toFixed(2)} / strip
                      </strong>
                    </button>
                  ))}
                </div>
              )}

              {searchQuery.trim() && searchResults.length === 0 && !stockLoading && (
                <div className="pos-results fade-in">
                  <div className="pos-no-result">No medicine matches “{searchQuery}” in current stock.</div>
                </div>
              )}
            </div>

            {onOpenBarcodeScanner && (
              <button className="btn-scan" type="button" onClick={onOpenBarcodeScanner}>
                <QrCode size={18} />
                <span className="hide-sm">Scan Medicine</span>
              </button>
            )}
          </div>

          {cart.length > 0 && (
            <div className="pos-cart-hint">
              <Pill size={17} />
              <strong>{selectedItemCount} medicine(s) selected</strong>
              <span className="pos-hint-text">
                Scan another medicine to add it to this sale — existing items stay.
              </span>
            </div>
          )}

          <div className="table-container">
            <div className="table-scroll-wrap">
              <table className="custom-table pos-table">
                <thead>
                  <tr>
                    <th>Drug</th>
                    <th>Unit Price</th>
                    <th>Qty</th>
                    <th>Total</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {cart.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ padding: 0 }}>
                        <EmptyState
                          icon={<Pill size={28} />}
                          title="No medicines selected yet"
                          description="Search or scan a medicine from inventory to start this sale."
                        />
                      </td>
                    </tr>
                  ) : (
                    cart.map((item, index) => {
                      const calculation = calculateDispensing(item);
                      const lineTotal =
                        numberOr(item.current_price, 0) *
                        numberOr(item.quantity, 0);

                      return (
                        <tr
                          key={
                            item.cart_key ||
                            `${item.medicine_id}-${item.batch_id || "no-batch"}`
                          }
                        >
                          <td className="cell-truncate">
                            <strong className="td-strong">{item.generic_name}</strong>

                            {item.brand_name && (
                              <small className="muted-line">{item.brand_name}</small>
                            )}

                            <small className="muted-line">
                              {item.strength}
                              {item.batch_number ? ` · Batch ${item.batch_number}` : ""}
                              {item.expiry_date ? ` · Exp ${String(item.expiry_date).slice(0, 10)}` : ""}
                            </small>

                            {item.has_rx && (
                              <div className="rx-panel">
                                <div className="rx-grid">
                                  <label className="rx-field">
                                    Dose per admin
                                    <input
                                      type="number"
                                      min="1"
                                      value={item.dose_per_admin}
                                      onChange={(event) =>
                                        updateRx(index, "dose_per_admin", event.target.value)
                                      }
                                    />
                                  </label>

                                  <label className="rx-field">
                                    Frequency
                                    <select
                                      value={item.frequency_code}
                                      onChange={(event) =>
                                        updateRx(index, "frequency_code", event.target.value)
                                      }
                                    >
                                      {FREQUENCIES.map((frequency) => (
                                        <option key={frequency.code} value={frequency.code}>
                                          {frequency.code}
                                        </option>
                                      ))}
                                    </select>
                                  </label>

                                  <label className="rx-field">
                                    Duration (days)
                                    <input
                                      type="number"
                                      min="1"
                                      value={item.duration_days}
                                      disabled={
                                        getFrequency(item.frequency_code).per_day === null
                                      }
                                      onChange={(event) =>
                                        updateRx(index, "duration_days", event.target.value)
                                      }
                                    />
                                  </label>

                                  <label className="rx-field">
                                    Route
                                    <select
                                      value={item.route_of_admin}
                                      onChange={(event) =>
                                        updateRx(index, "route_of_admin", event.target.value)
                                      }
                                    >
                                      {ROUTES.map((route) => (
                                        <option key={route.code} value={route.code}>
                                          {route.code}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                </div>

                                <div className="rx-calc">
                                  <div className="rx-calc-head">
                                    <Calculator size={15} />
                                    Calculation
                                  </div>
                                  <div className="rx-formula">Formula: {calculation.formula}</div>

                                  <div className="rx-strip-grid">
                                    <div className="rx-strip-card">
                                      <span>Single Dose</span>
                                      <strong>1 tablet/capsule</strong>
                                      <small>ETB {calculation.single_unit_price.toFixed(2)}</small>
                                    </div>
                                    <div className="rx-strip-card">
                                      <span>1 Strip</span>
                                      <strong>{calculation.strip_size} single doses</strong>
                                      <small>ETB {calculation.strip_price.toFixed(2)}</small>
                                    </div>
                                  </div>

                                  <div className="rx-required">
                                    Required: {calculation.required_units} single doses
                                  </div>
                                  <div className="rx-dispense">
                                    Dispense: {calculation.strips} strip(s) ×{" "}
                                    {calculation.strip_size} = {calculation.dispense_units} single doses
                                  </div>
                                  <div className="rx-price">
                                    Price: {calculation.strips} strip(s) × ETB{" "}
                                    {calculation.strip_price.toFixed(2)} = ETB{" "}
                                    {calculation.total_price.toFixed(2)}
                                  </div>
                                </div>

                                <div className="rx-counseling">
                                  <div className="rx-calc-head neutral">
                                    <MessageSquareText size={15} />
                                    Counseling Note
                                  </div>
                                  <textarea
                                    rows="2"
                                    value={item.counseling_note}
                                    onChange={(event) =>
                                      setCart((current) => {
                                        const updated = [...current];
                                        updated[index] = {
                                          ...updated[index],
                                          counseling_note: event.target.value,
                                        };
                                        return updated;
                                      })
                                    }
                                  />
                                </div>
                              </div>
                            )}
                          </td>

                          <td>
                            {/* Unit price is fixed by inventory — display only */}
                            <span
                              className="price-fixed"
                              title="Unit price is determined by inventory and cannot be edited in POS"
                            >
                              ETB {numberOr(item.current_price, 0).toFixed(2)}
                            </span>
                          </td>

                          <td>
                            <input
                              className="qty-input"
                              type="number"
                              min="1"
                              max={item.stock_on_hand}
                              value={item.quantity}
                              onChange={(event) =>
                                updateQuantity(index, event.target.value)
                              }
                              aria-label={`Quantity for ${item.generic_name}`}
                            />
                            <small className="muted-line">Stock: {item.stock_on_hand}</small>
                          </td>

                          <td>
                            <strong className="td-strong">ETB {lineTotal.toFixed(2)}</strong>
                          </td>

                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            <button
                              type="button"
                              className="icon-btn"
                              data-tip="Prescription / dispensing"
                              onClick={() => openDrawer(index)}
                              aria-label="Open prescription dispensing"
                            >
                              <Stethoscope size={16} />
                            </button>

                            <button
                              type="button"
                              className="icon-btn remove"
                              data-tip="Remove item"
                              onClick={() => removeFromCart(index)}
                              aria-label={`Remove ${item.generic_name}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ══ RIGHT · ORDER SUMMARY ══ */}
        <aside className="pos-sidebar dot-grid">
          <h3 className="pos-summary-title">Order Summary</h3>

          {aiWarnings.length > 0 && (
            <div className={`interaction-box ${hasCriticalInteractions ? 'danger' : 'warn'}`}>
              <div className="interaction-head">
                {hasCriticalInteractions ? (
                  <AlertTriangle size={18} />
                ) : (
                  <ShieldCheck size={18} />
                )}
                <strong>
                  {aiLoading
                    ? "Checking interactions…"
                    : hasCriticalInteractions
                      ? `${hasCriticalInteractions} critical interaction${hasCriticalInteractions > 1 ? 's' : ''}`
                      : "Interaction Notice"}
                </strong>
              </div>

              {!aiLoading && aiWarnings.slice(0, 2).map((warning) => (
                <div key={warning.id || warning.drugs?.join('|')} className="interaction-warning">
                  <span className={`badge ${warning.severity === 1 ? 'badge-danger' : 'badge-warning'}`}>
                    {warning.title}
                  </span>
                  <strong>{warning.drugs?.join(' + ')}</strong>
                  <p>{warning.clinical_effect || warning.recommended_action}</p>
                </div>
              ))}
              {!aiLoading && aiWarnings.length > 2 && (
                <p className="muted-line" style={{ marginTop: '0.5rem' }}>
                  +{aiWarnings.length - 2} more interaction notice(s)
                </p>
              )}

              {!aiLoading && (
                <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: '0.6rem' }} onClick={() => setShowDetails(true)}>
                  View Details
                </button>
              )}
            </div>
          )}

          <div className="summary-row">
            <span>Medicines</span>
            <strong>{cart.length}</strong>
          </div>

          <div className="summary-total">
            <span>Total</span>
            <span>ETB {calculateTotal}</span>
          </div>

          {stockProblems.length > 0 && (
            <div className="stock-problem">
              <strong>Stock problem</strong>
              <div>One or more quantities exceed available stock.</div>
            </div>
          )}

          <button
            type="button"
            onClick={handleCheckout}
            disabled={checkoutBlocked}
            className="btn-scan checkout-btn"
          >
            <ShoppingCart size={19} />
            {aiLoading ? "Checking Drugs…" : "Checkout & Pay"}
          </button>

          <button
            type="button"
            onClick={() => printReceipt()}
            disabled={cart.length === 0}
            className="btn btn-secondary print-btn"
          >
            <Printer size={16} />
            Print Receipt
          </button>
        </aside>
      </div>

      {dispensingDrawer.open && (
        <>
          <div
            className="drawer-backdrop"
            onClick={() => setDispensingDrawer({ open: false, itemIndex: null })}
          />

          <div className="drawer-panel slide-in-right" role="dialog" aria-modal="true" aria-label="Prescription dispensing">
            <div className="drawer-header">
              <div>
                <strong>Prescription / Dispensing</strong>
                <div className="muted-line">
                  {drawerItem?.generic_name} {drawerItem?.strength}
                </div>
              </div>

              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setDispensingDrawer({ open: false, itemIndex: null })}
                aria-label="Close dispensing panel"
              >
                <X size={18} />
              </button>
            </div>

            <div className="drawer-body">
              <label className="form-group">
                Dose per admin
                <input
                  className="form-control"
                  type="number"
                  min="1"
                  value={drawerForm.dose_per_admin}
                  onChange={(event) =>
                    setDrawerForm((current) => ({
                      ...current,
                      dose_per_admin: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="form-group">
                Frequency
                <select
                  className="form-control"
                  value={drawerForm.frequency_code}
                  onChange={(event) =>
                    setDrawerForm((current) => ({
                      ...current,
                      frequency_code: event.target.value,
                    }))
                  }
                >
                  {FREQUENCIES.map((frequency) => (
                    <option key={frequency.code} value={frequency.code}>
                      {frequency.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-group">
                Duration (days)
                <input
                  className="form-control"
                  type="number"
                  min="1"
                  value={drawerForm.duration_days}
                  disabled={
                    getFrequency(drawerForm.frequency_code).per_day === null
                  }
                  onChange={(event) =>
                    setDrawerForm((current) => ({
                      ...current,
                      duration_days: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="form-group">
                Strip Size
                <div className="strip-row">
                  <input
                    className="form-control"
                    type="number"
                    min="1"
                    value={drawerForm.package_capacity || 10}
                    onChange={(event) =>
                      setDrawerForm((current) => ({
                        ...current,
                        package_capacity: Math.max(
                          1,
                          Math.floor(Number(event.target.value) || 10),
                        ),
                      }))
                    }
                  />
                  <span className="form-hint">single doses / strip</span>
                </div>
                <small className="form-hint">Example: 10 tablets = 1 strip</small>
                {drawerCalculation && (
                  <div className="strip-preview">
                    Strips required: {drawerCalculation.strips} strip(s) —{" "}
                    {drawerCalculation.dispense_units} units
                  </div>
                )}
              </label>

              <label className="form-group">
                Route
                <select
                  className="form-control"
                  value={drawerForm.route_of_admin}
                  onChange={(event) =>
                    setDrawerForm((current) => ({
                      ...current,
                      route_of_admin: event.target.value,
                    }))
                  }
                >
                  {ROUTES.map((route) => (
                    <option key={route.code} value={route.code}>
                      {route.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="drawer-calc">
                <h4>Calculation</h4>
                {drawerCalculation && (
                  <>
                    <div className="rx-formula">Formula: {drawerCalculation.formula}</div>
                    <div className="rx-required" style={{ marginTop: '0.5rem' }}>
                      Required: {drawerCalculation.required_units} units
                    </div>
                    <div className="rx-price" style={{ marginTop: '0.35rem' }}>
                      Price: {drawerCalculation.strips} strip(s) × ETB{" "}
                      {drawerCalculation.strip_price.toFixed(2)} = ETB{" "}
                      {drawerCalculation.total_price.toFixed(2)}
                    </div>
                  </>
                )}
              </div>

              <label className="form-group">
                Counseling Note
                <textarea
                  className="form-control"
                  rows="5"
                  value={drawerForm.counseling_note}
                  onChange={(event) =>
                    setDrawerForm((current) => ({
                      ...current,
                      counseling_note: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <div className="drawer-footer">
              <button type="button" className="btn-scan" onClick={applyDrawer} style={{ width: '100%' }}>
                Apply to POS
              </button>
            </div>
          </div>
        </>
      )}

      {showInteractionConfirm && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-card" style={{ maxWidth: '520px' }}>
            <div className="interaction-confirm-head">
              <AlertTriangle size={28} />
              <h3>Critical Interaction — Pharmacist Review Required</h3>
            </div>

            <p className="muted-line" style={{ lineHeight: 1.6 }}>
              These medicines have a potentially serious interaction. Pharmacist
              review is required before dispensing.
            </p>

            <div className="confirm-warnings">
              {aiWarnings.filter((w) => w.severity === 1).map((warning) => (
                <div key={warning.id || warning.drugs?.join('|')} className="interaction-warning boxed">
                  <span className="badge badge-danger">{warning.title}</span>
                  <strong>{warning.drugs?.join(' + ')}</strong>
                  {warning.clinical_effect && <p>{warning.clinical_effect}</p>}
                  {warning.recommended_action && <p><em>Recommended: {warning.recommended_action}</em></p>}
                </div>
              ))}
            </div>

            <label className="form-group" style={{ margin: '1rem 0' }}>
              Pharmacist review reason *
              <textarea
                className="form-control"
                rows="3"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Document the clinical reason for proceeding…"
              />
            </label>

            <div className="confirm-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowInteractionConfirm(false)}
              >
                Cancel
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={proceedCheckout}
                disabled={!overrideReason.trim()}
              >
                Review &amp; Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interaction details drawer (severity 1–3, full dataset info) */}
      {showDetails && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setShowDetails(false)}>
          <div className="modal-card" style={{ maxWidth: '560px' }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Interaction Details</h2>
              <button type="button" className="modal-close-btn" onClick={() => setShowDetails(false)}>×</button>
            </div>
            <p className="muted-line" style={{ marginBottom: '0.9rem' }}>
              Source: local structured DDI reference dataset. Clinical judgement and dose,
              duration and patient factors always apply.
            </p>
            <div className="confirm-warnings" style={{ maxHeight: '50vh' }}>
              {aiWarnings.map((warning) => (
                <div key={warning.id || warning.drugs?.join('|')} className={`interaction-warning boxed ${warning.severity === 1 ? 'boxed-critical' : ''}`}>
                  <span className={`badge ${warning.severity === 1 ? 'badge-danger' : warning.severity === 2 ? 'badge-warning' : 'badge-info'}`}>
                    {warning.title}
                  </span>
                  <strong>{warning.drugs?.join(' + ')}</strong>
                  {warning.category && <small className="muted-line">Category: {warning.category}</small>}
                  {warning.mechanism && <p>Mechanism: {warning.mechanism}</p>}
                  {warning.clinical_effect && <p>Effect: {warning.clinical_effect}</p>}
                  {warning.recommended_action && <p><em>Recommended action: {warning.recommended_action}</em></p>}
                </div>
              ))}
            </div>
            <div className="confirm-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowDetails(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
