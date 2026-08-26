import React, { useEffect, useMemo, useRef, useState } from "react";
import "./POS.css";
import {
  AlertTriangle,
  CheckCircle2,
  Pill,
  QrCode,
  Search,
  ShoppingCart,
  Trash2,
  X,
  ShieldCheck,
  Calculator,
  MessageSquareText,
  Lock,
  RefreshCw,
} from "lucide-react";

import { inventoryAPI, salesAPI, ddiAPI } from "../services/api";
import { socket } from "../services/socket";
import { useToast } from "../context/ToastContext";
import { EmptyState } from "../components/Feedback";

/*
  POS WORKFLOW (prescription-type driven — there is NO "RX" button)

  Scan/Search
      -> medicine is identified from REAL inventory data
      -> its stored prescription_type controls the workflow automatically:
           OTC          -> simple quantity + checkout
           PRESCRIPTION -> dose/frequency/duration/route panel appears,
                           required single doses are CALCULATED READ-ONLY,
                           dispensing strips are adjustable
           CONTROLLED   -> same as prescription + mandatory authorization
                           note enforced by the Express backend at checkout
      -> multi-drug interaction checking runs on every cart change
      -> checkout uses an idempotent operation_id (network retries can
         never create a duplicate sale)

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

const normalizeRxType = (value) => {
  const type = String(value || "").toUpperCase();
  if (type === "PRESCRIPTION" || type === "CONTROLLED") return type;
  return "OTC";
};

/*
 * CLINICAL CALCULATION — the source of truth for REQUIRED single doses.
 * This value is always derived; it can never be typed in by hand.
 *
 * PRICE RULE:
 *   current_price = price of ONE STRIP (from the live FEFO batch).
 *   strip_size    = number of single doses inside one strip.
 */
const calculateDispensing = (item) => {
  const dose = Math.max(0, numberOr(item.dose_per_admin, 0));
  const duration = Math.max(0, numberOr(item.duration_days, 0));
  const frequency = getFrequency(item.frequency_code);

  const stripSize = Math.max(1, Math.floor(numberOr(item.strip_size, 10)));
  const stripPrice = Math.max(0, numberOr(item.current_price, 0));
  const perDosePrice = stripPrice / stripSize;

  let required_units;
  let formula;
  if (frequency.per_day === null) {
    // PRN / STAT — a single administration is the requirement.
    required_units = Math.max(1, Math.ceil(dose || 1));
    formula = `${required_units} single dose(s) — ${frequency.code}`;
  } else {
    required_units = Math.max(
      1,
      Math.ceil(dose * frequency.per_day * duration)
    );
    formula = `${dose} single dose(s) × ${frequency.per_day} time(s)/day × ${duration} day(s) = ${required_units} single doses`;
  }

  const suggested_strips = Math.max(1, Math.ceil(required_units / stripSize));

  return {
    required_units,
    suggested_strips,
    strip_size: stripSize,
    strip_price: stripPrice,
    single_unit_price: perDosePrice,
    formula,
  };
};

/* Line totals follow the DISPENSING unit:
   - PRESCRIPTION/CONTROLLED : strips × strip-price
   - OTC                     : single doses × (strip-price ÷ strip size) */
const lineTotalFor = (item) => {
  const stripPrice = Math.max(0, numberOr(item.current_price, 0));
  if (item.rx_required) {
    return numberOr(item.strips, 1) * stripPrice;
  }
  const stripSize = Math.max(1, Math.floor(numberOr(item.strip_size, 10)));
  return numberOr(item.quantity, 0) * (stripPrice / stripSize);
};

const generateCounseling = (item) => {
  const frequency = getFrequency(item.frequency_code);
  const route = getRoute(item.route_of_admin);
  const routeName = route.label.split("—")[1]?.trim() || route.label;

  if (frequency.per_day === null) {
    if (item.frequency_code === "STAT") {
      return `Take ${item.dose_per_admin} unit(s) immediately via ${routeName}.`;
    }
    return `Take ${item.dose_per_admin} unit(s) as needed via ${routeName}, according to the pharmacist's instructions.`;
  }

  return `Take ${item.dose_per_admin} unit(s) ${frequency.label.split("—")[1]?.trim() || frequency.label} for ${item.duration_days} days via ${routeName}. Follow the prescribed course and do not change the dose without professional advice.`;
};

const normalizeMedicine = (medicine) => ({
  ...medicine,
  medicine_id: medicine.medicine_id ?? medicine.id,
  generic_name: medicine.generic_name || medicine.name || "Unknown medicine",
  brand_name: medicine.brand_name || "",
  strength: medicine.strength || "",
  prescription_type: normalizeRxType(medicine.prescription_type),
  stock_on_hand: numberOr(medicine.stock_on_hand ?? medicine.stock_quantity, 0),
  // current_price is the price of ONE STRIP from the live batch record.
  current_price: numberOr(
    medicine.current_price ?? medicine.sell_price ?? medicine.price,
    0
  ),
  strip_size: Math.max(
    1,
    Math.floor(
      numberOr(
        medicine.strip_size ??
          medicine.units_per_package ??
          medicine.package_capacity,
        10
      )
    )
  ),
  batch_id: medicine.batch_id ?? null,
  batch_number: medicine.batch_number ?? "",
  expiry_date: medicine.expiry_date ?? null,
});

const getCartItemKey = (item) => {
  const medicineId = item?.medicine_id ?? item?.id ?? "unknown";
  const batchId = item?.batch_id ?? item?.batch?.id ?? "no-batch";
  return `${medicineId}-${batchId}`;
};

const escapeHtml = (unsafe) => {
  if (!unsafe && unsafe !== 0) return "";
  return String(unsafe).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[m]);
};

export const POS = ({
  onOpenBarcodeScanner,
  scannedMedicine,
  onClearScannedMedicine,
  cart: cartProp,
  setCart: setCartProp,
}) => {
  const { toast, withLoading } = useToast();

  // Cart is lifted to App so page changes never clear an ongoing sale.
  const [internalCart, setInternalCart] = useState([]);
  const cart = cartProp !== undefined ? cartProp : internalCart;
  const setCart = setCartProp !== undefined ? setCartProp : setInternalCart;

  const [stockList, setStockList] = useState([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [stockError, setStockError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [aiWarnings, setAiWarnings] = useState([]);
  const [hasInteractions, setHasInteractions] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const [showInteractionConfirm, setShowInteractionConfirm] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  /*
    SUCCESS MODAL STATE — printing is never part of the transaction.
    The sale is committed first; only then is "Print receipt?" offered.
  */
  const [saleResult, setSaleResult] = useState(null); // { sale_id, total, operation_id, items }
  const [showPrintPrompt, setShowPrintPrompt] = useState(false);

  // Idempotency: one operation_id per checkout attempt sequence. A network
  // failure + retry reuses the SAME id, so the backend can de-duplicate.
  const operationIdRef = useRef(null);
  const ensureOperationId = () => {
    if (!operationIdRef.current) {
      operationIdRef.current =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    return operationIdRef.current;
  };

  const stockFetchRef = useRef(false);

  /* ── REAL-TIME STOCK ───────────────────────────────────────────────────── */
  const refreshStock = async ({ silent = false } = {}) => {
    if (!silent) setStockLoading(true);
    try {
      const response = await inventoryAPI.getStock();
      const rows = Array.isArray(response.data) ? response.data.map(normalizeMedicine) : [];
      setStockList(rows);
      setStockError(false);
      setLastUpdated(new Date());

      // Live reconciliation: update stock/prices of items already in the
      // cart and warn when a batch price changed while the POS was open.
      setCart((current) =>
        current.map((item) => {
          const fresh = rows.find((r) => r.medicine_id === item.medicine_id);
          if (!fresh) return item;
          const next = {
            ...item,
            stock_on_hand: fresh.stock_on_hand,
            expiry_date: item.batch_id ? item.expiry_date : fresh.expiry_date,
          };
          if (
            !item.batch_id &&
            Number(fresh.current_price) !== Number(item.current_price)
          ) {
            next.current_price = fresh.current_price;
            setTimeout(
              () =>
                toast.warning(
                  `Price updated: ${item.generic_name} is now ETB ${Number(fresh.current_price).toFixed(2)} / strip. Please review the total.`
                ),
              0
            );
          }
          return next;
        })
      );
    } catch {
      setStockError(true);
      if (!silent) {
        setStockList([]);
        toast.error("Unable to retrieve current stock.");
      }
    } finally {
      setStockLoading(false);
    }
  };

  useEffect(() => {
    refreshStock();
    stockFetchRef.current = true;

    // Socket events keep this POS in sync when OTHER counters sell stock.
    socket.connect();
    const onDataUpdated = () => refreshStock({ silent: true });
    socket.on("data_updated", onDataUpdated);

    return () => {
      socket.off("data_updated", onDataUpdated);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Scanner integration: scanned medicines join the current sale. */
  useEffect(() => {
    if (!scannedMedicine) return;

    const medicine = normalizeMedicine(scannedMedicine);
    addToCart(medicine);

    if (onClearScannedMedicine) {
      onClearScannedMedicine();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedMedicine]);

  /* Drug–drug interaction checking on every cart change. */
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
          setHasInteractions(false);
          setAiWarnings([]);
          toast.warning(
            "Interaction check is temporarily unavailable. Pharmacist judgement required."
          );
        }
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    };

    checkCombination();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.length]);

  /* ── CART ACTIONS ─────────────────────────────────────────────────────── */

  const buildCartItem = (med) => {
    const rxRequired = med.prescription_type !== "OTC";

    const base = {
      ...med,
      cart_key: getCartItemKey(med),
      rx_required: rxRequired,
      dose_per_admin: 1,
      frequency_code: "BID",
      duration_days: 7,
      route_of_admin: "PO",
    };

    if (!rxRequired) {
      // OTC — normal dispensing: default 1 strip worth of single doses.
      return {
        ...base,
        quantity: Math.min(med.strip_size, Math.max(1, med.stock_on_hand)),
        counseling_note: null,
      };
    }

    // PRESCRIPTION / CONTROLLED — default clinical course, dispensing
    // follows the calculation (never fewer strips than required).
    const calculation = calculateDispensing(base);
    return {
      ...base,
      strips: calculation.suggested_strips,
      quantity: calculation.suggested_strips * calculation.strip_size,
      counseling_note: generateCounseling(base),
    };
  };

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
        (item) => getCartItemKey(item) === itemKey
      );

      // Already in cart → increase dispensing. Never duplicate or replace.
      if (existingIndex >= 0) {
        const updated = [...current];
        const existing = updated[existingIndex];
        const step = existing.rx_required
          ? existing.strip_size
          : 1;
        const proposedQty = numberOr(existing.quantity, step) + step;

        if (proposedQty > Number(existing.stock_on_hand)) {
          toast.warning(
            `Only ${existing.stock_on_hand} single doses of ${med.generic_name} are in stock.`
          );
          return current;
        }

        updated[existingIndex] = {
          ...existing,
          quantity: proposedQty,
          strips: existing.rx_required
            ? Math.floor(proposedQty / existing.strip_size)
            : existing.strips,
        };
        toast.info(`${med.generic_name} added again.`);
        return updated;
      }

      return [...current, buildCartItem(med)];
    });

    setSearchQuery("");
  };

  const removeFromCart = (index) => {
    setCart((current) => current.filter((_, i) => i !== index));
  };

  /* OTC quantity stepper — single doses. */
  const updateQuantity = (index, value) => {
    const quantity = Math.floor(Number(value));

    if (!Number.isFinite(quantity) || quantity < 1) return;

    setCart((current) => {
      const updated = [...current];

      if (quantity > updated[index].stock_on_hand) {
        toast.warning("Quantity cannot exceed available stock.");
        return current;
      }

      updated[index] = { ...updated[index], quantity };
      return updated;
    });
  };

  /* PRESCRIPTION dispensing stepper — WHOLE STRIPS. The calculated
     required dose stays read-only; only dispensing is adjustable. */
  const changeStrips = (index, delta) => {
    setCart((current) => {
      const updated = [...current];
      const item = updated[index];
      if (!item.rx_required) return current;

      const stripSize = Math.max(1, Math.floor(numberOr(item.strip_size, 10)));
      const maxStrips = Math.max(
        1,
        Math.floor(numberOr(item.stock_on_hand, 0) / stripSize)
      );
      const nextStrips = Math.min(
        maxStrips,
        Math.max(1, numberOr(item.strips, 1) + delta)
      );

      if (nextStrips === item.strips) {
        if (delta > 0) {
          toast.warning(
            `Only ${item.stock_on_hand} single doses available (${maxStrips} full strip(s)).`
          );
        }
        return current;
      }

      updated[index] = {
        ...updated[index],
        strips: nextStrips,
        quantity: nextStrips * stripSize,
      };
      return updated;
    });
  };

  /* Clinical inputs — editing these RE-CALCULATES the required dose and
     auto-follows with dispensing unless the pharmacist chose it manually. */
  const updateRx = (index, field, value) => {
    setCart((current) => {
      const updated = [...current];
      const item = { ...updated[index] };

      if (field === "dose_per_admin") {
        item[field] = Math.max(1, Math.floor(Number(value) || 1));
      } else if (field === "duration_days") {
        item[field] =
          getFrequency(item.frequency_code).per_day === null
            ? item[field]
            : Math.max(1, Math.floor(Number(value) || 1));
      } else {
        item[field] = value;
      }

      if (!item.note_manual) {
        item.counseling_note = generateCounseling(item);
      }

      const calculation = calculateDispensing(item);

      // Dispensing follows the calculation unless adjusted manually.
      if (!item.strips_manual) {
        const stripSize = Math.max(
          1,
          Math.floor(numberOr(item.strip_size, 10))
        );
        const maxStrips = Math.max(
          1,
          Math.floor(numberOr(item.stock_on_hand, 0) / stripSize)
        );
        const strips = Math.min(maxStrips, calculation.suggested_strips);
        item.strips = strips;
        item.quantity = strips * stripSize;
      }

      updated[index] = item;
      return updated;
    });
  };

  const editCounselingNote = (index, text) => {
    setCart((current) => {
      const updated = [...current];
      updated[index] = {
        ...updated[index],
        counseling_note: text,
        note_manual: true,
      };
      return updated;
    });
  };

  /* ── TOTALS & VALIDATION ──────────────────────────────────────────────── */

  const calculateTotal = useMemo(
    () => cart.reduce((sum, item) => sum + lineTotalFor(item), 0),
    [cart]
  );

  const selectedItemCount = cart.length;

  const hasCriticalInteractions = useMemo(
    () => aiWarnings.filter((w) => w.severity === 1).length,
    [aiWarnings]
  );

  const hasControlled = useMemo(
    () => cart.some((item) => item.prescription_type === "CONTROLLED"),
    [cart]
  );

  const stockProblems = useMemo(
    () =>
      cart.filter(
        (item) => numberOr(item.quantity, 0) > numberOr(item.stock_on_hand, 0)
      ),
    [cart]
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

    // Critical interactions OR controlled medicines require an explicit
    // documented reason before the backend will accept the sale.
    const criticalCount = aiWarnings.filter((w) => w.severity === 1).length;
    if (criticalCount > 0 || hasControlled) {
      setShowInteractionConfirm(true);
      return;
    }

    await proceedCheckout();
  };

  const proceedCheckout = async () => {
    const criticalCount = aiWarnings.filter((w) => w.severity === 1).length;

    if ((criticalCount > 0 || hasControlled) && !overrideReason.trim()) {
      toast.error(
        hasControlled
          ? "An authorization/prescription reference is required for controlled medicines."
          : "A pharmacist review reason is required for critical interactions."
      );
      return;
    }

    setShowInteractionConfirm(false);

    const operation_id = ensureOperationId();

    // Snapshot for receipt printing BEFORE the cart is cleared.
    const saleSnapshot = {
      items: cart.map((item) => ({
        name: `${item.generic_name}${item.brand_name ? ` (${item.brand_name})` : ""}`,
        strength: item.strength,
        rx_type: item.prescription_type,
        dispense_units: numberOr(item.quantity, 0),
        strips: item.rx_required ? item.strips : null,
        strip_size: item.rx_required ? item.strip_size : null,
        counseling_note: item.rx_required ? item.counseling_note : null,
      })),
    };

    try {
      const payload = {
        // NOTE: no user_id — identity comes from the authenticated token.
        operation_id,
        payment_method: "CASH",
        override_reason: overrideReason.trim() || null,

        items: cart.map((item) => {
          const calculation = calculateDispensing(item);
          const stripSize = Math.max(
            1,
            Math.floor(numberOr(item.strip_size, 10))
          );

          return {
            medicine_id: item.medicine_id,
            batch_id: item.batch_id || null,
            // Inventory stock is counted as SINGLE doses.
            quantity: numberOr(item.quantity, 0),
            strip_size: stripSize,
            strip_quantity: item.rx_required ? item.strips : null,

            required_units: item.rx_required
              ? calculation.required_units
              : null,
            dispense_units: numberOr(item.quantity, 0),

            dose_per_admin: item.rx_required ? item.dose_per_admin : null,
            frequency_code: item.rx_required ? item.frequency_code : null,
            duration_days: item.rx_required ? item.duration_days : null,
            route_of_admin: item.rx_required ? item.route_of_admin : null,
            counseling_note: item.rx_required ? item.counseling_note : null,
          };
        }),
      };

      const response = await withLoading(() => salesAPI.create(payload), {
        loadingMsg: "Processing sale and updating inventory...",
        successMsg: "Sale completed successfully!",
      });

      const sale_id = response.data?.sale_id;
      const total = numberOr(
        response.data?.total_amount,
        Number(calculateTotal.toFixed(2))
      );

      setSaleResult({
        sale_id,
        total,
        operation_id,
        items: saleSnapshot.items,
      });
      setShowPrintPrompt(true);

      // A NEW checkout after this success must be a NEW operation.
      operationIdRef.current = null;
      setCart([]);
      setOverrideReason("");

      refreshStock({ silent: true });
    } catch (error) {
      const message =
        error.response?.data?.error || error.message || "Unknown error";
      toast.error(`Failed to process checkout: ${message}`);
      // Keep the SAME operation_id so an immediate retry after a network
      // failure cannot create a duplicate sale.
    }
  };

  const closePrintPrompt = () => {
    setShowPrintPrompt(false);
    setSaleResult(null);
  };

  const printReceipt = (sale) => {
    if (!sale) return;
    const pharmacyName = "NET-PHARMA";
    const now = new Date();

    const rows = sale.items
      .map(
        (it, i) => `
      <tr style="border-bottom:1px solid #eee">
        <td style="padding:8px 0">
          <strong>${i + 1}. ${escapeHtml(it.name)}</strong>
          <div style="font-size:12px;color:#666">${escapeHtml(it.strength || "")}${it.rx_type !== "OTC" ? ` · ${escapeHtml(it.rx_type)}` : ""}</div>
          ${
            it.strips
              ? `<div style="font-size:12px;color:#333">${it.strips} strip(s) × ${it.strip_size} = ${it.dispense_units} single doses</div>`
              : `<div style="font-size:12px;color:#333">${it.dispense_units} single dose(s)</div>`
          }
        </td>
      </tr>
      ${
        it.counseling_note
          ? `<tr><td style="padding:0 0 12px 0;font-size:12px;color:#333">Counseling: ${escapeHtml(it.counseling_note)}</td></tr>`
          : ""
      }`
      )
      .join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${escapeHtml(sale.sale_id)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;padding:20px}.card{max-width:680px;margin:0 auto;border-radius:12px;padding:20px;border:1px solid #e6eef7}h1{margin:0;font-size:20px}.meta{color:#64748b;font-size:13px;margin-top:6px}table{width:100%;border-collapse:collapse;margin-top:16px}td{vertical-align:top}.total{display:flex;justify-content:space-between;padding-top:12px;border-top:1px solid #e6eef7;margin-top:12px;font-weight:800;font-size:16px}.op{margin-top:14px;padding:10px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;font-size:12px;color:#334155;word-break:break-all}</style></head><body><div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div><h1>${escapeHtml(pharmacyName)}</h1><div class="meta">Receipt #${escapeHtml(sale.sale_id)} — ${now.toLocaleString()}</div></div><div style="text-align:right;color:#64748b;font-size:12px">Powered by NET-PHARMA</div></div><div class="op"><strong>Operation ID:</strong> ${escapeHtml(sale.operation_id || "-")}</div><div style="margin-top:12px;color:#334155">Items</div><table>${rows}</table><div class="total"><div>Total</div><div>ETB ${Number(sale.total).toFixed(2)}</div></div><div style="margin-top:18px;font-size:13px;color:#475569">Thank you for your purchase. For medicine counselling please follow instructions above or contact your pharmacist.</div></div><body onload="window.print()"></body></html>`;

    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Pop-up blocked. Allow pop-ups for printing.");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
  };

  /* ── SEARCH ───────────────────────────────────────────────────────────── */

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

  const checkoutBlocked =
    cart.length === 0 || aiLoading || stockProblems.length > 0;

  const badgeClass = (type) =>
    type === "CONTROLLED"
      ? "rx-badge controlled"
      : type === "PRESCRIPTION"
        ? "rx-badge prescription"
        : "rx-badge otc";

  /* ════════════════════════ RENDER ════════════════════════ */

  return (
    <div className="pos-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Point of Sale</h1>
          <p>
            Scan or search a medicine — OTC, prescription and controlled
            workflows apply automatically.
          </p>
        </div>
        <div className="pos-sync-state" title={lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : undefined}>
          {stockLoading ? (
            <>
              <RefreshCw size={13} className="spin" /> Updating stock…
            </>
          ) : stockError ? (
            <button
              type="button"
              className="pos-retry-btn"
              onClick={() => refreshStock()}
            >
              <RefreshCw size={13} /> Unable to refresh stock — Retry
            </button>
          ) : (
            lastUpdated && <>Live · {lastUpdated.toLocaleTimeString()}</>
          )}
        </div>
      </div>

      <div className="pos-layout">
        {/* ══ LEFT · SEARCH + CART ══ */}
        <section className="pos-main-card">
          <div className="pos-scan-and-search">
            <div className="smart-search-input-wrap pos-search-wrap">
              <Search size={17} />
              <input
                type="text"
                placeholder={
                  stockError
                    ? "Inventory unavailable — press Retry to reconnect"
                    : "Search generic, brand, strength or batch…"
                }
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
                      <span className={`pos-result-type ${badgeClass(medicine.prescription_type)}`}>
                        {medicine.prescription_type}
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
                  <div className="pos-no-result">
                    No medicine matches “{searchQuery}” in current stock.
                  </div>
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

          {/* ── ITEM CARDS (auto workflow per prescription type) ── */}
          <div className="pos-items">
            {cart.length === 0 && !stockError && (
              <EmptyState
                icon={<Pill size={28} />}
                title="No medicines selected yet"
                description="Search or scan a medicine from inventory to start this sale."
              />
            )}

            {stockError && cart.length === 0 && (
              <EmptyState
                icon={<AlertTriangle size={28} />}
                title="Unable to load inventory"
                description="Check the connection to the server, then retry."
              />
            )}

            {cart.map((item, index) => {
              const calculation = calculateDispensing(item);
              const lineTotal = lineTotalFor(item);
              const stripSize = calculation.strip_size;
              const maxStrips = Math.max(
                1,
                Math.floor(numberOr(item.stock_on_hand, 0) / stripSize)
              );

              return (
                <article key={item.cart_key || getCartItemKey(item)} className="pos-item-card">
                  {/* header */}
                  <header className="pos-item-head">
                    <div className="pos-item-title">
                      <strong>
                        {item.generic_name}
                        {item.brand_name ? ` — ${item.brand_name}` : ""}
                      </strong>
                      <span className="muted-line">
                        {[
                          item.strength,
                          item.batch_number ? `Batch: ${item.batch_number}` : null,
                          item.expiry_date ? `Exp: ${String(item.expiry_date).slice(0, 10)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <div className="pos-item-head-right">
                      <span className={badgeClass(item.prescription_type)}>
                        {item.prescription_type}
                      </span>
                      <button
                        type="button"
                        className="icon-btn remove"
                        onClick={() => removeFromCart(index)}
                        aria-label={`Remove ${item.generic_name}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </header>

                  {!item.rx_required ? (
                    /* ── OTC: simple quantity control ── */
                    <div className="pos-item-body otc">
                      <div className="otc-row">
                        <label className="otc-qty-label">
                          Quantity (single doses)
                          <div className="stepper">
                            <button
                              type="button"
                              onClick={() =>
                                numberOr(item.quantity, 1) > 1 &&
                                updateQuantity(index, numberOr(item.quantity, 1) - 1)
                              }
                              aria-label="Decrease quantity"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min="1"
                              max={item.stock_on_hand}
                              value={item.quantity}
                              onChange={(event) =>
                                updateQuantity(index, event.target.value)
                              }
                              aria-label={`Quantity for ${item.generic_name}`}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateQuantity(index, numberOr(item.quantity, 1) + 1)
                              }
                              aria-label="Increase quantity"
                            >
                              +
                            </button>
                          </div>
                        </label>

                        <div className="otc-pricing">
                          <span>
                            ETB{" "}
                            {(numberOr(item.current_price, 0) / stripSize).toFixed(2)} /
                            dose
                          </span>
                          <small>Stock: {item.stock_on_hand}</small>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* ── PRESCRIPTION / CONTROLLED: automatic workflow ── */
                    <>
                      <section className="pos-item-section">
                        <h4>Prescription</h4>
                        <div className="rx-grid">
                          <label className="rx-field">
                            Dose
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
                      </section>

                      <section className="pos-item-section calc">
                        <h4>
                          <Calculator size={14} /> Calculation
                        </h4>

                        <div className="rx-formula">{calculation.formula}</div>

                        <div className="calc-grid">
                          <div className="calc-box required">
                            <span>
                              Required dose <Lock size={11} aria-label="read-only" />
                            </span>
                            <strong>{calculation.required_units} single doses</strong>
                            <small>calculated automatically — read-only</small>
                          </div>

                          <div className="calc-box">
                            <span>Strip size</span>
                            <strong>{stripSize} single doses</strong>
                            <small>ETB {calculation.strip_price.toFixed(2)} / strip</small>
                          </div>

                          <div className="calc-box dispensing">
                            <span>Dispensing</span>
                            <div className="stepper compact">
                              <button
                                type="button"
                                onClick={() => changeStrips(index, -1)}
                                disabled={numberOr(item.strips, 1) <= 1}
                                aria-label="Decrease strips"
                              >
                                −
                              </button>
                              <strong>{numberOr(item.strips, 1)} strip(s)</strong>
                              <button
                                type="button"
                                onClick={() => changeStrips(index, 1)}
                                disabled={numberOr(item.strips, 1) >= maxStrips}
                                aria-label="Increase strips"
                              >
                                +
                              </button>
                            </div>
                            <small>
                              Actual: {numberOr(item.quantity, 0)} single doses · adjustable
                            </small>
                          </div>
                        </div>

                        <div className="calc-price">
                          Price: {numberOr(item.strips, 1)} strip(s) × ETB{" "}
                          {calculation.strip_price.toFixed(2)} = ETB{" "}
                          {lineTotal.toFixed(2)}
                        </div>
                      </section>

                      <section className="pos-item-section counseling">
                        <h4>
                          <MessageSquareText size={14} /> Counseling Note
                        </h4>
                        <textarea
                          rows="3"
                          value={item.counseling_note || ""}
                          onChange={(event) =>
                            editCounselingNote(index, event.target.value)
                          }
                          placeholder="Counselling guidance shown to the patient…"
                        />
                      </section>
                    </>
                  )}

                  <footer className="pos-item-foot">
                    <span>Line total</span>
                    <strong>ETB {lineTotal.toFixed(2)}</strong>
                  </footer>
                </article>
              );
            })}
          </div>
        </section>

        {/* ══ RIGHT · ORDER SUMMARY ══ */}
        <aside className="pos-sidebar dot-grid">
          <h3 className="pos-summary-title">Order Summary</h3>

          {aiWarnings.length > 0 && (
            <div className={`interaction-box ${hasCriticalInteractions ? "danger" : "warn"}`}>
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
                      ? `${hasCriticalInteractions} critical interaction${hasCriticalInteractions > 1 ? "s" : ""}`
                      : "Interaction Notice"}
                </strong>
              </div>

              {!aiLoading &&
                aiWarnings.slice(0, 2).map((warning) => (
                  <div
                    key={warning.id || warning.drugs?.join("|")}
                    className="interaction-warning"
                  >
                    <span className={`badge ${warning.severity === 1 ? "badge-danger" : "badge-warning"}`}>
                      {warning.title}
                    </span>
                    <strong>{warning.drugs?.join(" + ")}</strong>
                    <p>{warning.clinical_effect || warning.recommended_action}</p>
                  </div>
                ))}
              {!aiLoading && aiWarnings.length > 2 && (
                <p className="muted-line" style={{ marginTop: "0.5rem" }}>
                  +{aiWarnings.length - 2} more interaction notice(s)
                </p>
              )}

              {!aiLoading && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: "0.6rem" }}
                  onClick={() => setShowDetails(true)}
                >
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
            <span className="summary-total-value">
              ETB {calculateTotal.toFixed(2)}
            </span>
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
        </aside>
      </div>

      {/* ══ CHECKOUT CONFIRMATION (critical interactions / controlled meds) ══ */}
      {showInteractionConfirm && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-card" style={{ maxWidth: "520px" }}>
            <div className={`interaction-confirm-head ${hasControlled && hasCriticalInteractions === 0 ? "controlled" : ""}`}>
              {hasControlled ? <ShieldCheck size={28} /> : <AlertTriangle size={28} />}
              <h3>
                {hasControlled && hasCriticalInteractions > 0
                  ? "Review Required Before Dispensing"
                  : hasControlled
                    ? "Controlled Medicine — Authorization Required"
                    : "Critical Interaction — Pharmacist Review Required"}
              </h3>
            </div>

            {hasCriticalInteractions > 0 && (
              <>
                <p className="muted-line" style={{ lineHeight: 1.6 }}>
                  These medicines have a potentially serious interaction.
                  Pharmacist review is required before dispensing.
                </p>
                <div className="confirm-warnings">
                  {aiWarnings
                    .filter((w) => w.severity === 1)
                    .map((warning) => (
                      <div
                        key={warning.id || warning.drugs?.join("|")}
                        className="interaction-warning boxed"
                      >
                        <span className="badge badge-danger">{warning.title}</span>
                        <strong>{warning.drugs?.join(" + ")}</strong>
                        {warning.clinical_effect && <p>{warning.clinical_effect}</p>}
                        {warning.recommended_action && (
                          <p>
                            <em>Recommended: {warning.recommended_action}</em>
                          </p>
                        )}
                      </div>
                    ))}
                </div>
              </>
            )}

            {hasControlled && (
              <p className="muted-line" style={{ lineHeight: 1.6 }}>
                This sale contains <strong>CONTROLLED</strong> medicine(s):{" "}
                {cart
                  .filter((i) => i.prescription_type === "CONTROLLED")
                  .map((i) => i.generic_name)
                  .join(", ")}
                . Document the prescription/authorization reference below. The
                server enforces this requirement and records the transaction in
                the audit log.
              </p>
            )}

            <label className="form-group" style={{ margin: "1rem 0" }}>
              {hasControlled ? "Prescription / authorization reference *" : "Pharmacist review reason *"}
              <textarea
                className="form-control"
                rows="3"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder={
                  hasControlled
                    ? "e.g. Prescription #1234, prescriber name and license…"
                    : "Document the clinical reason for proceeding…"
                }
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
                Confirm &amp; Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ SALE COMPLETED → PRINT? ══ */}
      {showPrintPrompt && saleResult && (
        <div className="modal-overlay" style={{ zIndex: 1200 }}>
          <div className="modal-card sale-complete-modal" style={{ maxWidth: "440px" }} role="dialog" aria-modal="true" aria-label="Sale completed">
            <div className="sale-complete-icon">
              <CheckCircle2 size={44} />
            </div>
            <h3>Sale Completed</h3>
            <p className="muted-line">
              Receipt #{saleResult.sale_id ?? "—"} · Total ETB{" "}
              {Number(saleResult.total).toFixed(2)}
            </p>

            <div className="sale-op-id">
              <span>Operation ID</span>
              <code>{saleResult.operation_id}</code>
            </div>

            <p style={{ margin: "1rem 0 0.4rem", fontWeight: 600 }}>
              Would you like to print the receipt?
            </p>

            <div className="confirm-actions center">
              <button type="button" className="btn btn-secondary" onClick={closePrintPrompt}>
                No
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  printReceipt(saleResult);
                  closePrintPrompt();
                }}
              >
                Yes, Print
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interaction details drawer */}
      {showDetails && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setShowDetails(false)}>
          <div className="modal-card" style={{ maxWidth: "560px" }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Interaction Details</h2>
              <button type="button" className="modal-close-btn" onClick={() => setShowDetails(false)}>×</button>
            </div>
            <p className="muted-line" style={{ marginBottom: "0.9rem" }}>
              Source: local structured DDI reference dataset. Clinical judgement and dose,
              duration and patient factors always apply.
            </p>
            <div className="confirm-warnings" style={{ maxHeight: "50vh" }}>
              {aiWarnings.map((warning) => (
                <div key={warning.id || warning.drugs?.join("|")} className={`interaction-warning boxed ${warning.severity === 1 ? "boxed-critical" : ""}`}>
                  <span className={`badge ${warning.severity === 1 ? "badge-danger" : warning.severity === 2 ? "badge-warning" : "badge-info"}`}>
                    {warning.title}
                  </span>
                  <strong>{warning.drugs?.join(" + ")}</strong>
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
