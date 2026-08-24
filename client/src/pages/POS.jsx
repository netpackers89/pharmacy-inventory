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
} from "lucide-react";

import { inventoryAPI, salesAPI, aiAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

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

const calculateDispensing = (item) => {
  const dose = Math.max(0, numberOr(item.dose_per_admin, 0));
  const duration = Math.max(0, numberOr(item.duration_days, 0));
  const frequency = getFrequency(item.frequency_code);

  // PRICE RULE:
  // current_price = price of ONE STRIP.
  // strip_size = number of single doses inside one strip.
  // Default pharmacy strip size = 10.
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

  // The prescription is calculated in SINGLE doses.
  // The POS then rounds UP to complete strips.
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

export const POS = ({
  onOpenBarcodeScanner,
  scannedMedicine,
  onClearScannedMedicine,
}) => {
  const { user } = useAuth();
  const { toast, withLoading } = useToast();

  const [stockList, setStockList] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [cart, setCart] = useState([]);

  const [aiWarnings, setAiWarnings] = useState([]);
  const [hasInteractions, setHasInteractions] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const [showInteractionConfirm, setShowInteractionConfirm] = useState(false);
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
    loadStock();
  }, []);

  const loadStock = async () => {
    try {
      const response = await inventoryAPI.getStock();
      setStockList((response.data || []).map(normalizeMedicine));
    } catch {
      toast.error("Unable to load current inventory.");
    }
  };

  /*
    Scanner integration:
    The scanner parent passes an existing inventory medicine here.
    It is immediately sent into the POS cart.
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
    Multi-drug checking:
    This runs every time the selected medicine list changes.
    One medicine = no interaction comparison.
    Two or more = check the complete combination.
  */
  useEffect(() => {
    if (cart.length < 2) {
      setHasInteractions(false);
      setAiWarnings([]);
      setAiLoading(false);
      return;
    }

    let cancelled = false;

    const checkCombination = async () => {
      setAiLoading(true);

      try {
        const response = await aiAPI.checkInteractions(
          cart.map((medicine) => ({
            medicine_id: medicine.medicine_id,
            generic_name: medicine.generic_name,
            brand_name: medicine.brand_name,
            strength: medicine.strength,
            dose_per_admin: medicine.dose_per_admin,
            frequency_code: medicine.frequency_code,
            route_of_admin: medicine.route_of_admin,
            duration_days: medicine.duration_days,
          })),
        );

        if (cancelled) return;

        const data = response.data || {};
        setHasInteractions(Boolean(data.hasInteractions));
        setAiWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      } catch {
        if (!cancelled) {
          setHasInteractions(false);
          setAiWarnings([]);
          toast.warning("Multi-drug checking could not be completed.");
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

      if (existingIndex >= 0) {
        const updated = [...current];
        const existing = updated[existingIndex];
        updated[existingIndex] = {
          ...existing,
          quantity: Number(existing.quantity || 1) + 1,
        };
        toast.info(
          `${med.generic_name} was already in the POS. Quantity increased.`,
        );
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

  const updatePrice = (index, value) => {
    const price = Number(value);

    if (!Number.isFinite(price) || price < 0) return;

    setCart((current) => {
      const updated = [...current];
      updated[index] = {
        ...updated[index],
        current_price: price,
      };
      return updated;
    });
  };

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
    const pharmacyName = options.pharmacyName || 'My Pharmacy';
    const now = new Date();
    const rows = cart.map((it, i) => {
      const calc = calculateDispensing(it);
      return `<tr style="border-bottom:1px solid #eee"><td style="padding:8px 0"><strong>${i+1}. ${escapeHtml(it.generic_name)}</strong>${it.brand_name ? ' <span style="color:#666">('+escapeHtml(it.brand_name)+')</span>' : ''}<div style="font-size:12px;color:#666">${escapeHtml(it.strength || '')}</div></td><td style="padding:8px 0; text-align:right">${calc.dispense_units} units</td></tr>
        <tr><td colspan="2" style="padding:4px 0 12px 0; font-size:12px; color:#333">Counseling: ${escapeHtml(it.counseling_note || '—')}</td></tr>`;
    }).join('');

    const total = numberOr(calculateTotal, 0);

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;padding:20px} .card{max-width:680px;margin:0 auto;border-radius:12px;padding:20px;border:1px solid #e6eef7} h1{margin:0;font-size:20px} .meta{color:#64748b;font-size:13px;margin-top:6px} table{width:100%;border-collapse:collapse;margin-top:16px} td{vertical-align:top} .total{display:flex;justify-content:space-between;padding-top:12px;border-top:1px solid #e6eef7;margin-top:12px;font-weight:800;font-size:16px}</style></head><body><div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div><h1>${escapeHtml(pharmacyName)}</h1><div class="meta">Receipt — ${now.toLocaleString()}</div></div><div style="text-align:right;color:#64748b;font-size:12px">Powered by Pharmacy Inventory</div></div><div style="margin-top:12px;color:#334155">Items</div><table>${rows}</table><div class="total"><div>Total</div><div>ETB ${Number(total).toFixed(2)}</div></div><div style="margin-top:18px;font-size:13px;color:#475569">Thank you for your purchase. For medicine counselling please follow instructions above or contact your pharmacist.</div></div><script>function printAndClose(){window.print();}</script></body></html>`;

    const w = window.open('', '_blank');
    if (!w) { toast.error('Pop-up blocked. Allow pop-ups for printing.'); return; }
    w.document.write(html);
    w.document.close();
    // Wait for content to render before print
    w.onload = () => { w.focus(); w.print(); };
  };

  const escapeHtml = (unsafe) => {
    if (!unsafe && unsafe !== 0) return '';
    return String(unsafe).replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[m]; });
  };

  const selectedItemCount = cart.length;

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
      toast.warning("Please wait for the multi-drug check to finish.");
      return;
    }

    if (hasInteractions) {
      setShowInteractionConfirm(true);
      return;
    }

    await proceedCheckout();
  };

  const proceedCheckout = async () => {
    if (hasInteractions && !overrideReason.trim()) {
      toast.error("An override reason is required.");
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
          The backend should use the medicine/batch inventory relation
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

      await loadStock();

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

  return (
    <div className="pos-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Point of Sale</h1>
          <p>
            Scan or search an existing medicine, add multiple medicines, check
            interactions, calculate dispensing quantities, and complete the
            sale.
          </p>
        </div>
      </div>

      {checkoutSuccess && (
        <div
          className="checkout-success"
          style={{
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            padding: "1rem",
            borderRadius: "12px",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <CheckCircle2 size={32} color="#166534" />
          <div>
            <strong style={{ color: "#166534", fontSize: "1.1rem" }}>
              Sale Completed Successfully
            </strong>
            <p style={{ color: "#15803d", margin: 0 }}>
              Receipt #{finalSaleId || "—"} · Total: ETB {finalTotal.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      <div
        className="pos-layout"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 360px",
          gap: "1.5rem",
          alignItems: "start",
        }}
      >
        <div
          style={{
            background: "white",
            padding: "1.5rem",
            borderRadius: "14px",
            border: "1px solid #e2e8f0",
            boxShadow: "0 8px 30px rgba(15, 23, 42, 0.05)",
          }}
        >
          <div
            className="pos-scan-and-search"
            style={{
              display: "flex",
              gap: "1rem",
              marginBottom: "1.5rem",
            }}
          >
            <div
              className="smart-search-input-wrap"
              style={{ flex: 1, position: "relative" }}
            >
              <Search
                size={18}
                color="#64748b"
                style={{
                  position: "absolute",
                  left: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                }}
              />

              <input
                type="text"
                placeholder="Search generic, brand, strength or batch..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                style={{
                  width: "100%",
                  padding: "0.85rem 1rem 0.85rem 2.5rem",
                  border: "1px solid #cbd5e1",
                  borderRadius: "10px",
                  fontSize: "1rem",
                  outline: "none",
                }}
              />

              {searchResults.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    left: 0,
                    right: 0,
                    background: "white",
                    border: "1px solid #e2e8f0",
                    borderRadius: "12px",
                    boxShadow: "0 20px 40px rgba(15, 23, 42, 0.15)",
                    zIndex: 50,
                    maxHeight: "360px",
                    overflowY: "auto",
                  }}
                >
                  {searchResults.map((medicine) => (
                    <button
                      type="button"
                      key={`${medicine.medicine_id}-${medicine.batch_id || "stock"}`}
                      onClick={() => addToCart(medicine)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "0.9rem 1rem",
                        border: 0,
                        borderBottom: "1px solid #f1f5f9",
                        background: "white",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "1rem",
                      }}
                    >
                      <span>
                        <strong
                          style={{
                            color: "#0f172a",
                            display: "block",
                          }}
                        >
                          {medicine.generic_name}{" "}
                          {medicine.brand_name
                            ? `(${medicine.brand_name})`
                            : ""}
                        </strong>

                        <span
                          style={{
                            display: "block",
                            fontSize: "0.78rem",
                            color: "#64748b",
                            marginTop: "3px",
                          }}
                        >
                          {medicine.strength || "No strength"} · Stock:{" "}
                          {medicine.stock_on_hand}
                          {medicine.batch_number
                            ? ` · Batch ${medicine.batch_number}`
                            : ""}
                        </span>
                      </span>

                      <strong style={{ whiteSpace: "nowrap" }}>
                        ETB {medicine.current_price.toFixed(2)} / strip
                      </strong>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {onOpenBarcodeScanner && (
              <button
                className="btn-scan"
                type="button"
                onClick={onOpenBarcodeScanner}
                style={{
                  padding: "0 1.3rem",
                  background: "#0f172a",
                  color: "white",
                  border: "none",
                  borderRadius: "10px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                }}
              >
                <QrCode size={18} />
                Scan Medicine
              </button>
            )}
          </div>

          {cart.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                marginBottom: "1rem",
                padding: "0.8rem 1rem",
                background: "#f8fafc",
                borderRadius: "10px",
              }}
            >
              <Pill size={18} color="#2563eb" />
              <strong>{selectedItemCount} medicine(s) selected</strong>
              <span style={{ color: "#64748b" }}>
                Scan another medicine to add it to the same POS transaction.
              </span>
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            <table className="custom-table" style={{ minWidth: "900px" }}>
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
                    <td
                      colSpan="5"
                      style={{
                        textAlign: "center",
                        padding: "4rem 2rem",
                        color: "#64748b",
                      }}
                    >
                      <Pill
                        size={36}
                        style={{ marginBottom: "0.7rem", opacity: 0.5 }}
                      />
                      <div>
                        <strong>No medicines selected</strong>
                      </div>
                      <div style={{ marginTop: "0.25rem" }}>
                        Search or scan a medicine from inventory.
                      </div>
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
                        <td>
                          <strong
                            style={{
                              color: "#0f172a",
                              display: "block",
                            }}
                          >
                            {item.generic_name}
                          </strong>

                          {item.brand_name && (
                            <span
                              style={{
                                fontSize: "0.78rem",
                                color: "#64748b",
                                display: "block",
                              }}
                            >
                              {item.brand_name}
                            </span>
                          )}

                          <span
                            style={{
                              fontSize: "0.75rem",
                              color: "#64748b",
                            }}
                          >
                            {item.strength}
                            {item.batch_number
                              ? ` · Batch ${item.batch_number}`
                              : ""}
                            {item.expiry_date
                              ? ` · Exp ${item.expiry_date}`
                              : ""}
                          </span>

                          {item.has_rx && (
                            <div
                              style={{
                                marginTop: "0.75rem",
                                background: "#f8fafc",
                                padding: "0.75rem",
                                border: "1px solid #e2e8f0",
                                borderRadius: "10px",
                              }}
                            >
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns:
                                    "repeat(4, minmax(90px, 1fr))",
                                  gap: "0.5rem",
                                  marginBottom: "0.65rem",
                                }}
                              >
                                <label style={{ fontSize: "0.75rem" }}>
                                  Dose per admin
                                  <input
                                    type="number"
                                    min="1"
                                    value={item.dose_per_admin}
                                    onChange={(event) =>
                                      updateRx(
                                        index,
                                        "dose_per_admin",
                                        event.target.value,
                                      )
                                    }
                                    style={{
                                      width: "100%",
                                      marginTop: "4px",
                                      padding: "0.45rem",
                                      border: "1px solid #cbd5e1",
                                      borderRadius: "7px",
                                    }}
                                  />
                                </label>

                                <label style={{ fontSize: "0.75rem" }}>
                                  Frequency
                                  <select
                                    value={item.frequency_code}
                                    onChange={(event) =>
                                      updateRx(
                                        index,
                                        "frequency_code",
                                        event.target.value,
                                      )
                                    }
                                    style={{
                                      width: "100%",
                                      marginTop: "4px",
                                      padding: "0.45rem",
                                      border: "1px solid #cbd5e1",
                                      borderRadius: "7px",
                                    }}
                                  >
                                    {FREQUENCIES.map((frequency) => (
                                      <option
                                        key={frequency.code}
                                        value={frequency.code}
                                      >
                                        {frequency.code}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label style={{ fontSize: "0.75rem" }}>
                                  Duration (days)
                                  <input
                                    type="number"
                                    min="1"
                                    value={item.duration_days}
                                    disabled={
                                      getFrequency(item.frequency_code)
                                        .per_day === null
                                    }
                                    onChange={(event) =>
                                      updateRx(
                                        index,
                                        "duration_days",
                                        event.target.value,
                                      )
                                    }
                                    style={{
                                      width: "100%",
                                      marginTop: "4px",
                                      padding: "0.45rem",
                                      border: "1px solid #cbd5e1",
                                      borderRadius: "7px",
                                    }}
                                  />
                                </label>

                                <label style={{ fontSize: "0.75rem" }}>
                                  Route
                                  <select
                                    value={item.route_of_admin}
                                    onChange={(event) =>
                                      updateRx(
                                        index,
                                        "route_of_admin",
                                        event.target.value,
                                      )
                                    }
                                    style={{
                                      width: "100%",
                                      marginTop: "4px",
                                      padding: "0.45rem",
                                      border: "1px solid #cbd5e1",
                                      borderRadius: "7px",
                                    }}
                                  >
                                    {ROUTES.map((route) => (
                                      <option
                                        key={route.code}
                                        value={route.code}
                                      >
                                        {route.code}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>

                              <div
                                style={{
                                  padding: "0.7rem",
                                  background: "#eff6ff",
                                  borderRadius: "8px",
                                  border: "1px solid #bfdbfe",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.4rem",
                                    fontWeight: 800,
                                    color: "#1e40af",
                                  }}
                                >
                                  <Calculator size={15} />
                                  Calculation
                                </div>

                                <div
                                  style={{
                                    color: "#1e3a8a",
                                    marginTop: "0.4rem",
                                    fontSize: "0.82rem",
                                  }}
                                >
                                  Formula: {calculation.formula}
                                </div>

                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr 1fr",
                                    gap: "0.5rem",
                                    marginTop: "0.65rem",
                                  }}
                                >
                                  <div
                                    className="rx-strip-card"
                                    style={{
                                      padding: "0.65rem",
                                      background: "#ffffff",
                                      borderRadius: "8px",
                                      border: "1px solid #bfdbfe",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: "0.7rem",
                                        color: "#64748b",
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                      }}
                                    >
                                      Single Dose
                                    </div>
                                    <strong
                                      style={{
                                        display: "block",
                                        marginTop: "0.2rem",
                                        color: "#0f172a",
                                      }}
                                    >
                                      1 tablet/capsule
                                    </strong>
                                    <span
                                      style={{
                                        fontSize: "0.75rem",
                                        color: "#64748b",
                                      }}
                                    >
                                      ETB{" "}
                                      {calculation.single_unit_price.toFixed(2)}
                                    </span>
                                  </div>

                                  <div
                                    className="rx-strip-card"
                                    style={{
                                      padding: "0.65rem",
                                      background: "#ffffff",
                                      borderRadius: "8px",
                                      border: "1px solid #bfdbfe",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: "0.7rem",
                                        color: "#64748b",
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                      }}
                                    >
                                      1 STRIP
                                    </div>
                                    <strong
                                      style={{
                                        display: "block",
                                        marginTop: "0.2rem",
                                        color: "#0f172a",
                                      }}
                                    >
                                      {calculation.strip_size} single doses
                                    </strong>
                                    <span
                                      style={{
                                        fontSize: "0.75rem",
                                        color: "#64748b",
                                      }}
                                    >
                                      ETB {calculation.strip_price.toFixed(2)}
                                    </span>
                                  </div>
                                </div>

                                <div
                                  style={{
                                    color: "#166534",
                                    fontWeight: 900,
                                    marginTop: "0.7rem",
                                  }}
                                >
                                  Required: {calculation.required_units} single
                                  doses
                                </div>

                                <div
                                  style={{
                                    color: "#92400e",
                                    fontWeight: 800,
                                    fontSize: "0.82rem",
                                    marginTop: "0.25rem",
                                  }}
                                >
                                  Dispense: {calculation.strips} strip(s) ×{" "}
                                  {calculation.strip_size} ={" "}
                                  {calculation.dispense_units} single doses
                                </div>

                                <div
                                  style={{
                                    color: "#1e40af",
                                    fontWeight: 900,
                                    marginTop: "0.35rem",
                                  }}
                                >
                                  Price: {calculation.strips} strip(s) × ETB{" "}
                                  {calculation.strip_price.toFixed(2)} = ETB{" "}
                                  {calculation.total_price.toFixed(2)}
                                </div>
                              </div>

                              <div
                                style={{
                                  marginTop: "0.65rem",
                                  padding: "0.7rem",
                                  background: "#fff",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: "8px",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.4rem",
                                    fontWeight: 800,
                                    color: "#334155",
                                  }}
                                >
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
                                  style={{
                                    width: "100%",
                                    marginTop: "0.5rem",
                                    padding: "0.55rem",
                                    border: "1px solid #cbd5e1",
                                    borderRadius: "7px",
                                    resize: "vertical",
                                  }}
                                />
                              </div>
                            </div>
                          )}
                        </td>

                        <td>
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              minWidth: "90px",
                              padding: "0.45rem 0.65rem",
                              background: "#f8fafc",
                              border: "1px solid #e2e8f0",
                              borderRadius: "7px",
                              color: "#0f172a",
                              fontWeight: 800,
                              whiteSpace: "nowrap",
                            }}
                            title="Unit price is determined by inventory and cannot be edited in POS"
                          >
                            ETB {numberOr(item.current_price, 0).toFixed(2)}
                          </div>
                        </td>

                        <td>
                          <input
                            type="number"
                            min="1"
                            max={item.stock_on_hand}
                            value={item.quantity}
                            onChange={(event) =>
                              updateQuantity(index, event.target.value)
                            }
                            style={{
                              width: "75px",
                              padding: "0.45rem",
                              border: "1px solid #cbd5e1",
                              borderRadius: "7px",
                            }}
                          />
                          <small
                            style={{
                              display: "block",
                              marginTop: "4px",
                              color: "#64748b",
                            }}
                          >
                            Stock: {item.stock_on_hand}
                          </small>
                        </td>

                        <td>
                          <strong>ETB {lineTotal.toFixed(2)}</strong>
                        </td>

                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={() => openDrawer(index)}
                            style={{
                              background: "#eff6ff",
                              color: "#2563eb",
                              border: "none",
                              padding: "0.5rem 0.7rem",
                              borderRadius: "7px",
                              cursor: "pointer",
                              marginRight: "5px",
                              fontWeight: 800,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <Stethoscope size={16} />
                            Rx
                          </button>

                          <button
                            type="button"
                            onClick={() => removeFromCart(index)}
                            style={{
                              background: "#fee2e2",
                              color: "#dc2626",
                              border: "none",
                              padding: "0.5rem",
                              borderRadius: "7px",
                              cursor: "pointer",
                            }}
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

        <aside
          style={{
            background: "#f8fafc",
            padding: "1.5rem",
            borderRadius: "14px",
            border: "1px solid #e2e8f0",
            position: "sticky",
            top: "1rem",
          }}
        >
          <h3
            style={{
              marginTop: 0,
              borderBottom: "2px solid #e2e8f0",
              paddingBottom: "0.75rem",
            }}
          >
            Order Summary
          </h3>

          {cart.length > 1 && (
            <div
              style={{
                marginBottom: "1rem",
                padding: "1rem",
                background: hasInteractions ? "#fef2f2" : "#f0fdf4",
                border: `1px solid ${hasInteractions ? "#fecaca" : "#bbf7d0"}`,
                borderRadius: "10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                {hasInteractions ? (
                  <AlertTriangle size={18} color="#dc2626" />
                ) : (
                  <ShieldCheck size={18} color="#16a34a" />
                )}

                <strong
                  style={{
                    color: hasInteractions ? "#991b1b" : "#166534",
                  }}
                >
                  {aiLoading
                    ? "Checking Multiple Drugs..."
                    : hasInteractions
                      ? "Interaction Warning"
                      : "Multi-Drug Check Passed"}
                </strong>
              </div>

              {hasInteractions && !aiLoading && (
                <div style={{ marginTop: "0.75rem" }}>
                  {aiWarnings.length === 0 ? (
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.82rem",
                        color: "#7f1d1d",
                      }}
                    >
                      Potential interaction detected. Review before dispensing.
                    </p>
                  ) : (
                    aiWarnings.map((warning, index) => (
                      <div
                        key={index}
                        style={{
                          marginTop: index ? "0.75rem" : 0,
                          paddingTop: index ? "0.75rem" : 0,
                          borderTop: index ? "1px solid #fecaca" : "none",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            padding: "0.2rem 0.45rem",
                            borderRadius: "999px",
                            background: "#fee2e2",
                            color: "#991b1b",
                            fontSize: "0.68rem",
                            fontWeight: 900,
                          }}
                        >
                          {warning.severity || "WARNING"}
                        </span>

                        <strong
                          style={{
                            display: "block",
                            marginTop: "0.25rem",
                            color: "#7f1d1d",
                          }}
                        >
                          {warning.title || "Drug interaction"}
                        </strong>

                        <p
                          style={{
                            margin: "0.25rem 0 0",
                            color: "#7f1d1d",
                            fontSize: "0.78rem",
                          }}
                        >
                          {warning.warning || warning.message}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "0.6rem",
            }}
          >
            <span>Medicines</span>
            <strong>{cart.length}</strong>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "1.3rem",
              fontWeight: 900,
              borderTop: "1px solid #cbd5e1",
              paddingTop: "1rem",
              marginTop: "0.5rem",
              marginBottom: "1rem",
            }}
          >
            <span>Total</span>
            <span style={{ color: "#2563eb" }}>ETB {calculateTotal}</span>
          </div>

          {stockProblems.length > 0 && (
            <div
              style={{
                padding: "0.8rem",
                background: "#fff7ed",
                border: "1px solid #fed7aa",
                color: "#9a3412",
                borderRadius: "8px",
                marginBottom: "1rem",
                fontSize: "0.8rem",
              }}
            >
              <strong>Stock problem</strong>
              <div>One or more quantities exceed available stock.</div>
            </div>
          )}

          <button
            type="button"
            onClick={handleCheckout}
            disabled={
              cart.length === 0 || aiLoading || stockProblems.length > 0
            }
            style={{
              width: "100%",
              padding: "0.9rem",
              background:
                cart.length === 0 || aiLoading || stockProblems.length > 0
                  ? "#94a3b8"
                  : "#10b981",
              color: "white",
              border: "none",
              borderRadius: "9px",
              fontSize: "1.05rem",
              fontWeight: 900,
              cursor:
                cart.length === 0 || aiLoading || stockProblems.length > 0
                  ? "not-allowed"
                  : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
            }}
          >
            <ShoppingCart size={20} />
            {aiLoading ? "Checking Drugs..." : "Checkout & Pay"}
          </button>
          <button
            type="button"
            onClick={() => printReceipt({ pharmacyName: 'My Pharmacy' })}
            disabled={cart.length === 0}
            style={{
              marginTop: '10px',
              width: '100%',
              padding: '0.8rem',
              background: cart.length === 0 ? '#94a3b8' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '9px',
              fontSize: '0.98rem',
              fontWeight: 800,
              cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Print Receipt
          </button>
        </aside>
      </div>

      {dispensingDrawer.open && (
        <>
          <div
            onClick={() =>
              setDispensingDrawer({ open: false, itemIndex: null })
            }
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.45)",
              zIndex: 999,
            }}
          />

          <div
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "min(430px, 94vw)",
              background: "white",
              boxShadow: "-10px 0 40px rgba(15, 23, 42, 0.2)",
              zIndex: 1000,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "1.3rem 1.5rem",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <strong style={{ fontSize: "1.1rem" }}>
                  Prescription / Dispensing
                </strong>
                <div style={{ color: "#64748b", fontSize: "0.8rem" }}>
                  {drawerItem?.generic_name} {drawerItem?.strength}
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setDispensingDrawer({ open: false, itemIndex: null })
                }
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  borderRadius: "8px",
                  padding: "0.5rem",
                  cursor: "pointer",
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div
              style={{
                padding: "1.5rem",
                overflowY: "auto",
                flex: 1,
              }}
            >
              <label
                style={{
                  display: "block",
                  marginBottom: "1rem",
                  fontSize: "0.85rem",
                  fontWeight: 700,
                }}
              >
                Dose per admin
                <input
                  type="number"
                  min="1"
                  value={drawerForm.dose_per_admin}
                  onChange={(event) =>
                    setDrawerForm((current) => ({
                      ...current,
                      dose_per_admin: event.target.value,
                    }))
                  }
                  style={{
                    width: "100%",
                    marginTop: "0.4rem",
                    padding: "0.7rem",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                  }}
                />
              </label>

              <label
                style={{
                  display: "block",
                  marginBottom: "1rem",
                  fontSize: "0.85rem",
                  fontWeight: 700,
                }}
              >
                Frequency
                <select
                  value={drawerForm.frequency_code}
                  onChange={(event) =>
                    setDrawerForm((current) => ({
                      ...current,
                      frequency_code: event.target.value,
                    }))
                  }
                  style={{
                    width: "100%",
                    marginTop: "0.4rem",
                    padding: "0.7rem",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                  }}
                >
                  {FREQUENCIES.map((frequency) => (
                    <option key={frequency.code} value={frequency.code}>
                      {frequency.label}
                    </option>
                  ))}
                </select>
              </label>

              <label
                style={{
                  display: "block",
                  marginBottom: "1rem",
                  fontSize: "0.85rem",
                  fontWeight: 700,
                }}
              >
                Duration (days)
                <input
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
                  style={{
                    width: "100%",
                    marginTop: "0.4rem",
                    padding: "0.7rem",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                  }}
                />
              </label>

              <label
                style={{
                  display: "block",
                  marginBottom: "1rem",
                  fontSize: "0.85rem",
                  fontWeight: 700,
                }}
              >
                Strip Size
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginTop: "0.4rem",
                  }}
                >
                  <input
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
                    style={{
                      flex: 1,
                      padding: "0.7rem",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                    }}
                  />
                  <span style={{ color: "#64748b", fontSize: "0.8rem" }}>
                    single doses / strip
                  </span>
                </div>
                <small
                  style={{
                    display: "block",
                    marginTop: "4px",
                    color: "#64748b",
                    fontWeight: 500,
                  }}
                >
                  Example: 10 tablets = 1 strip
                </small>
                  {drawerCalculation && (
                    <div style={{ marginTop: '8px', color: '#0f172a', fontWeight: 700 }}>
                      Strips required: {drawerCalculation.strips} strip(s) — {drawerCalculation.dispense_units} units
                    </div>
                  )}
              </label>

              <label
                style={{
                  display: "block",
                  marginBottom: "1.5rem",
                  fontSize: "0.85rem",
                  fontWeight: 700,
                }}
              >
                Route
                <select
                  value={drawerForm.route_of_admin}
                  onChange={(event) =>
                    setDrawerForm((current) => ({
                      ...current,
                      route_of_admin: event.target.value,
                    }))
                  }
                  style={{
                    width: "100%",
                    marginTop: "0.4rem",
                    padding: "0.7rem",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                  }}
                >
                  {ROUTES.map((route) => (
                    <option key={route.code} value={route.code}>
                      {route.label}
                    </option>
                  ))}
                </select>
              </label>

              <div
                style={{
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  padding: "1rem",
                  borderRadius: "10px",
                  marginBottom: "1rem",
                }}
              >
                <h4
                  style={{
                    margin: "0 0 0.6rem",
                    color: "#1e40af",
                  }}
                >
                  Calculation
                </h4>

                {drawerCalculation && (
                  <>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: "#1e3a8a",
                      }}
                    >
                      Formula: {drawerCalculation.formula}
                    </div>

                    <div
                      style={{
                        marginTop: "0.5rem",
                        fontWeight: 900,
                        color: "#166534",
                      }}
                    >
                      Required: {drawerCalculation.required_units} units
                    </div>

                    <div
                      style={{
                        marginTop: "0.4rem",
                        fontWeight: 900,
                        color: "#1e40af",
                      }}
                    >
                      Price: {drawerCalculation.strips} strip(s) × ETB{" "}
                      {drawerCalculation.strip_price.toFixed(2)} = ETB{" "}
                      {drawerCalculation.total_price.toFixed(2)}
                    </div>
                  </>
                )}
              </div>

              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 800,
                }}
              >
                Counseling Note
                <textarea
                  rows="5"
                  value={drawerForm.counseling_note}
                  onChange={(event) =>
                    setDrawerForm((current) => ({
                      ...current,
                      counseling_note: event.target.value,
                    }))
                  }
                  style={{
                    width: "100%",
                    marginTop: "0.4rem",
                    padding: "0.7rem",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    resize: "vertical",
                  }}
                />
              </label>
            </div>

            <div
              style={{
                padding: "1rem 1.5rem",
                borderTop: "1px solid #e2e8f0",
              }}
            >
              <button
                type="button"
                onClick={applyDrawer}
                style={{
                  width: "100%",
                  padding: "0.85rem",
                  background: "#2563eb",
                  color: "white",
                  border: "none",
                  borderRadius: "9px",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Apply to POS
              </button>
            </div>
          </div>
        </>
      )}

      {showInteractionConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.55)",
            zIndex: 1100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            style={{
              background: "white",
              padding: "2rem",
              borderRadius: "14px",
              maxWidth: "520px",
              width: "100%",
              boxShadow: "0 25px 60px rgba(0, 0, 0, 0.2)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.8rem",
                marginBottom: "1rem",
              }}
            >
              <AlertTriangle size={30} color="#dc2626" />
              <h3 style={{ margin: 0 }}>Multi-Drug Interaction Detected</h3>
            </div>

            <p style={{ color: "#475569", lineHeight: 1.6 }}>
              The selected medicines contain one or more potential interaction
              warnings. Review the warnings before dispensing.
            </p>

            <div
              style={{
                maxHeight: "220px",
                overflowY: "auto",
                marginBottom: "1rem",
              }}
            >
              {aiWarnings.map((warning, index) => (
                <div
                  key={index}
                  style={{
                    padding: "0.8rem",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: "8px",
                    marginBottom: "0.5rem",
                  }}
                >
                  <strong style={{ color: "#991b1b" }}>
                    {warning.title || "Interaction"}
                  </strong>
                  <p
                    style={{
                      margin: "0.3rem 0 0",
                      color: "#7f1d1d",
                      fontSize: "0.85rem",
                    }}
                  >
                    {warning.warning || warning.message}
                  </p>
                </div>
              ))}
            </div>

            <label
              style={{
                display: "block",
                marginBottom: "1rem",
                fontWeight: 800,
                fontSize: "0.85rem",
              }}
            >
              Override / pharmacist review reason
              <textarea
                rows="3"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Enter the clinical reason for proceeding..."
                style={{
                  width: "100%",
                  marginTop: "0.4rem",
                  padding: "0.7rem",
                  border: "1px solid #cbd5e1",
                  borderRadius: "8px",
                }}
              />
            </label>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.7rem",
              }}
            >
              <button
                type="button"
                onClick={() => setShowInteractionConfirm(false)}
                style={{
                  padding: "0.7rem 1rem",
                  background: "#f1f5f9",
                  color: "#334155",
                  border: "none",
                  borderRadius: "8px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={proceedCheckout}
                disabled={!overrideReason.trim()}
                style={{
                  padding: "0.7rem 1rem",
                  background: overrideReason.trim() ? "#dc2626" : "#fca5a5",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  fontWeight: 900,
                  cursor: overrideReason.trim() ? "pointer" : "not-allowed",
                }}
              >
                Review & Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
