import React, { useState, useEffect } from "react";
import "./Settings.css";
import {
  Users,
  Truck,
  Tag,
  DollarSign,
  ClipboardList,
  Plus,
  Edit,
  Check,
  X,
  Search,
  UserCheck,
  UserX,
  KeyRound,
  RefreshCw,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  usersAPI,
  suppliersAPI,
  categoriesAPI,
  settingsAPI,
} from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { StatusBadge, FilterTabs, ConfirmDialog } from "../components/ui";
import { TableSkeleton, EmptyState, ErrorState } from "../components/Feedback";

const TABS = [
  { id: "users", icon: <Users size={16} />, label: "Users" },
  { id: "suppliers", icon: <Truck size={16} />, label: "Suppliers" },
  { id: "categories", icon: <Tag size={16} />, label: "Categories" },
  { id: "pricing", icon: <DollarSign size={16} />, label: "Pricing & Tax" },
  { id: "audit", icon: <ClipboardList size={16} />, label: "Audit Logs" },
];

export const Settings = () => {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState("users");

  if (currentUser?.role !== "ADMIN") {
    return (
      <div className="settings-page">
        <div style={{ textAlign: "center", padding: "5rem", color: "var(--danger)" }}>
          <h2>Access Denied</h2>
          <p>Only administrators can access Settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Settings</h1>
          <p>System configuration and administration</p>
        </div>
      </div>

      <div className="settings-layout">
        {/* Sidebar tabs */}
        <div className="settings-sidebar">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`settings-tab-btn ${activeTab === t.id ? "active" : ""}`}
            >
              {t.icon} <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Content pane */}
        <div className="settings-content">
          {activeTab === "users" && <UsersPanel />}
          {activeTab === "suppliers" && <SuppliersPanel />}
          {activeTab === "categories" && <CategoriesPanel />}
          {activeTab === "pricing" && <PricingPanel />}
          {activeTab === "audit" && <AuditPanel />}
        </div>
      </div>
    </div>
  );
};

// ─── USERS PANEL ──────────────────────────────────────────────────────────────
const UsersPanel = () => {
  const { toast, withLoading } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetUserId, setResetUserId] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    username: "",
    password: "",
    role: "PHARMACY",
  });

  const load = () => {
    setLoading(true);
    usersAPI
      .getAll()
      .then((r) => {
        setUsers(r.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);

  const filtered = users.filter(
    (u) =>
      u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      u.username?.toLowerCase().includes(search.toLowerCase()),
  );

  const openAdd = () => {
    setEditUser(null);
    setForm({ full_name: "", username: "", password: "", role: "PHARMACY" });
    setShowModal(true);
  };
  const openEdit = (u) => {
    setEditUser(u);
    setForm({
      full_name: u.full_name,
      username: u.username,
      password: "",
      role: u.role,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editUser) {
        await usersAPI.update(editUser.user_id, {
          full_name: form.full_name,
          username: form.username,
          role: form.role,
        });
      } else {
        await usersAPI.create(form);
      }
      setShowModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save user");
    }
  };

  const toggleStatus = async (u) => {
    const newStatus = u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await usersAPI.changeStatus(u.user_id, newStatus);
      load();
    } catch (err) {
      toast.error("Failed to change status");
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.warning("Password must be at least 6 characters");
      return;
    }
    try {
      await usersAPI.resetPassword(resetUserId, newPassword);
      toast.success("Password reset successfully!");
      setShowResetModal(false);
      setNewPassword("");
    } catch (err) {
      toast.error("Failed to reset password");
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.25rem",
        }}
      >
        <h2 className="settings-section-title">User Management</h2>
        <button onClick={openAdd} className="settings-add-btn">
          <Plus size={15} /> Add User
        </button>
      </div>

      <div className="settings-search">
        <Search size={15} />
        <input
          type="text"
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="custom-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan="5"
                  style={{ textAlign: "center", padding: "2rem" }}
                >
                  Loading...
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((u) => (
                <tr key={u.user_id}>
                  <td>
                    <strong>{u.full_name}</strong>
                  </td>
                  <td style={{ color: "#475569" }}>{u.username}</td>
                  <td>
                    <span
                      className={`badge ${u.role === "ADMIN" ? "badge-primary" : "badge-secondary"}`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`badge ${u.status === "ACTIVE" ? "badge-success" : "badge-danger"}`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td>
                    <div
                      style={{
                        display: "flex",
                        gap: "0.4rem",
                        justifyContent: "flex-end",
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        onClick={() => openEdit(u)}
                        className="tbl-action-btn edit"
                      >
                        <Edit size={13} /> Edit
                      </button>
                      <button
                        onClick={() => toggleStatus(u)}
                        className={`tbl-action-btn ${u.status === "ACTIVE" ? "deactivate" : "activate"}`}
                      >
                        {u.status === "ACTIVE" ? (
                          <>
                            <UserX size={13} /> Deactivate
                          </>
                        ) : (
                          <>
                            <UserCheck size={13} /> Activate
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setResetUserId(u.user_id);
                          setShowResetModal(true);
                        }}
                        className="tbl-action-btn reset"
                      >
                        <KeyRound size={13} /> Reset Pwd
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td
                  colSpan="5"
                  style={{
                    textAlign: "center",
                    padding: "2rem",
                    color: "#94a3b8",
                  }}
                >
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: "460px" }}>
            <div className="modal-header">
              <h3>{editUser ? "Edit User" : "Add New User"}</h3>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "1.5rem",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                }}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Full Name *</label>
                <input
                  required
                  className="form-control"
                  value={form.full_name}
                  onChange={(e) =>
                    setForm({ ...form, full_name: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label>Username *</label>
                <input
                  required
                  className="form-control"
                  value={form.username}
                  onChange={(e) =>
                    setForm({ ...form, username: e.target.value })
                  }
                />
              </div>
              {!editUser && (
                <div className="form-group">
                  <label>Password *</label>
                  <input
                    required
                    type="password"
                    className="form-control"
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                  />
                </div>
              )}
              <div className="form-group">
                <label>Role</label>
                <select
                  className="form-control"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  <option value="PHARMACY">PHARMACY</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "1rem",
                  justifyContent: "flex-end",
                  marginTop: "1.5rem",
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-save">
                  <Check size={15} /> Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showResetModal && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: "380px" }}>
            <div className="modal-header">
              <h3>Reset Password</h3>
            </div>
            <div className="form-group">
              <label>New Password (min. 6 characters)</label>
              <input
                type="password"
                className="form-control"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: "1rem",
                justifyContent: "flex-end",
                marginTop: "1.5rem",
              }}
            >
              <button
                onClick={() => {
                  setShowResetModal(false);
                  setNewPassword("");
                }}
                className="btn-cancel"
              >
                Cancel
              </button>
              <button onClick={handleResetPassword} className="btn-save">
                <RefreshCw size={15} /> Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── SUPPLIERS PANEL ──────────────────────────────────────────────────────────
const EMPTY_SUPPLIER = {
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
};

/*
 * SUPPLIER MANAGEMENT — soft deactivation.
 * Inactive suppliers stay listed for admins but disappear from transaction
 * dropdowns. Every mutation has an explicit loading state; failed requests
 * keep the form open with values intact.
 */
const SuppliersPanel = () => {
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");

  const [showModal, setShowModal] = useState(false);
  const [editSup, setEditSup] = useState(null);
  const [form, setForm] = useState(EMPTY_SUPPLIER);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Status change confirmation
  const [confirmTarget, setConfirmTarget] = useState(null); // supplier
  const [confirmLoading, setConfirmLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(false);
    suppliersAPI
      .getAll()
      .then((r) => {
        setSuppliers(Array.isArray(r.data) ? r.data : []);
        setLoading(false);
      })
      .catch(() => {
        setLoadError(true);
        setLoading(false);
      });
  };
  useEffect(() => {
    load();
  }, []);

  const counts = {
    ACTIVE: suppliers.filter((s) => s.status === "ACTIVE").length,
    INACTIVE: suppliers.filter((s) => s.status === "INACTIVE").length,
    ALL: suppliers.length,
  };

  const filtered = suppliers
    .filter((s) => statusFilter === "ALL" || s.status === statusFilter)
    .filter((s) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        s.name?.toLowerCase().includes(q) ||
        s.contact_person?.toLowerCase().includes(q) ||
        s.phone?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q)
      );
    });

  const openAdd = () => {
    setEditSup(null);
    setForm(EMPTY_SUPPLIER);
    setFormError("");
    setShowModal(true);
  };

  const openEdit = (s) => {
    setEditSup(s);
    setForm({
      name: s.name || "",
      contact_person: s.contact_person || "",
      phone: s.phone || "",
      email: s.email || "",
      address: s.address || "",
    });
    setFormError("");
    setShowModal(true);
  };

  const closeModal = () => {
    if (saving) return; // close protection while saving
    setShowModal(false);
    setFormError("");
  };

  /*
   * Save flow: loading state → API → database → success → refresh local state.
   * On failure: stop loading, KEEP entered values, show the error, allow retry.
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return; // duplicate-submission guard

    const name = form.name.trim();
    if (!name) {
      setFormError("Supplier name is required.");
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const payload = {
        name,
        contact_person: form.contact_person.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
      };
      if (editSup) {
        await suppliersAPI.update(editSup.supplier_id, payload);
        toast.success("Supplier updated successfully");
      } else {
        await suppliersAPI.create(payload);
        toast.success("Supplier added successfully");
      }
      setShowModal(false);
      load(); // refetch only this list — no full page reload
    } catch (err) {
      setFormError(err.response?.data?.error || "Unable to save the supplier. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const confirmStatusChange = async () => {
    if (!confirmTarget || confirmLoading) return;
    const nextStatus =
      confirmTarget.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setConfirmLoading(true);
    try {
      await suppliersAPI.changeStatus(confirmTarget.supplier_id, nextStatus);
      toast.success(
        `Supplier ${nextStatus === "ACTIVE" ? "activated" : "deactivated"}`
      );
      setConfirmTarget(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Unable to update the supplier. Please try again.");
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <div>
      <div className="mgmt-header">
        <div>
          <h2 className="settings-section-title">Supplier Management</h2>
          <p className="form-hint">
            Distributors and medical suppliers. Deactivating keeps all historical batches and resupplies linked.
          </p>
        </div>
        <button onClick={openAdd} className="settings-add-btn">
          <Plus size={15} /> Add Supplier
        </button>
      </div>

      <div className="mgmt-toolbar">
        <div className="settings-search" style={{ marginBottom: 0 }}>
          <Search size={15} />
          <input
            type="text"
            placeholder="Search suppliers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search suppliers"
          />
        </div>
        <FilterTabs value={statusFilter} onChange={setStatusFilter} counts={counts} />
      </div>

      <div className="table-container">
        {loading ? (
          <TableSkeleton rows={6} cols={[24, 18, 14, 18, 12]} />
        ) : loadError ? (
          <ErrorState title="Unable to load suppliers" onRetry={load} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Truck size={26} />}
            title={
              search
                ? "No suppliers match your search"
                : statusFilter === "INACTIVE"
                  ? "No inactive suppliers"
                  : "No suppliers yet"
            }
            description={
              search
                ? "Try a different search term."
                : statusFilter === "ACTIVE"
                  ? "Add your first distributor to link batches and resupplies."
                  : undefined
            }
          />
        ) : (
          <>
            {/* Desktop / tablet table */}
            <div className="table-scroll-wrap hide-mobile-table">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Contact Person</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Batches</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.supplier_id}>
                      <td><strong className="td-strong">{s.name}</strong></td>
                      <td>{s.contact_person || "—"}</td>
                      <td>{s.phone || "—"}</td>
                      <td className="cell-truncate">{s.email || "—"}</td>
                      <td>{s.total_batches ?? 0}</td>
                      <td><StatusBadge status={s.status} /></td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button onClick={() => openEdit(s)} className="tbl-action-btn edit">
                          <Edit size={13} /> Edit
                        </button>
                        <button
                          onClick={() => setConfirmTarget(s)}
                          className={`tbl-action-btn ${s.status === "ACTIVE" ? "deactivate" : "activate"}`}
                        >
                          {s.status === "ACTIVE"
                            ? (<><UserX size={13} /> Deactivate</>)
                            : (<><UserCheck size={13} /> Activate</>)}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="show-mobile-table" style={{ padding: "0.6rem" }}>
              {filtered.map((s) => (
                <div key={s.supplier_id} className="supplier-card" style={{ marginBottom: "0.6rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                    <strong style={{ color: "var(--text-main)" }}>{s.name}</strong>
                    <StatusBadge status={s.status} />
                  </div>
                  <div style={{ marginTop: "0.55rem", fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                    {s.contact_person && <div>Contact · {s.contact_person}</div>}
                    {s.phone && <div>Phone · {s.phone}</div>}
                    {s.email && <div className="cell-truncate">Email · {s.email}</div>}
                    <div>{s.total_batches ?? 0} batches</div>
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                    <button onClick={() => openEdit(s)} className="tbl-action-btn edit">
                      <Edit size={13} /> Edit
                    </button>
                    <button
                      onClick={() => setConfirmTarget(s)}
                      className={`tbl-action-btn ${s.status === "ACTIVE" ? "deactivate" : "activate"}`}
                    >
                      {s.status === "ACTIVE"
                        ? (<><UserX size={13} /> Deactivate</>)
                        : (<><UserCheck size={13} /> Activate</>)}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="table-footer">
              <span>{filtered.length} supplier{filtered.length === 1 ? "" : "s"}</span>
            </div>
          </>
        )}
      </div>

      {/* Add / Edit modal — close-protected while saving */}
      {showModal && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal-card" style={{ maxWidth: "500px" }} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>{editSup ? "Edit Supplier" : "Add Supplier"}</h2>
              <button type="button" className="modal-close-btn" onClick={closeModal} disabled={saving} aria-label="Close">×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <fieldset disabled={saving} style={{ border: "none", margin: 0, padding: 0 }}>
                <div className="form-grid">
                  <div className="form-group full-width">
                    <label>Company Name *</label>
                    <input
                      required
                      maxLength={150}
                      className="form-control"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. ABC Pharmaceuticals"
                    />
                  </div>
                  <div className="form-group">
                    <label>Contact Person</label>
                    <input
                      className="form-control"
                      value={form.contact_person}
                      onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input
                      className="form-control"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </div>
                  <div className="form-group full-width">
                    <label>Email</label>
                    <input
                      type="email"
                      className="form-control"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div className="form-group full-width">
                    <label>Address</label>
                    <textarea
                      rows="2"
                      className="form-control"
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                    />
                  </div>
                </div>
              </fieldset>

              {formError && (
                <div className="auth-alert auth-alert--error" role="alert" style={{ marginTop: "1rem" }}>
                  <strong>Unable to save</strong>
                  <span>{formError}</span>
                </div>
              )}

              <div className="form-actions">
                <button type="button" onClick={closeModal} className="btn-cancel" disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn-save" disabled={saving} aria-busy={saving}>
                  {saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
                  {saving
                    ? (editSup ? "Saving Changes…" : "Saving Supplier…")
                    : (editSup ? "Save Changes" : "Add Supplier")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Activate / Deactivate confirmation */}
      <ConfirmDialog
        open={Boolean(confirmTarget)}
        danger={confirmTarget?.status === "ACTIVE"}
        loading={confirmLoading}
        title={confirmTarget?.status === "ACTIVE" ? "Deactivate Supplier?" : "Activate Supplier?"}
        message={
          confirmTarget?.status === "ACTIVE"
            ? `"${confirmTarget?.name}" will no longer appear in resupply and batch selection lists. Existing batches and purchase history remain unchanged.`
            : `"${confirmTarget?.name}" will become available in supplier selection lists again.`
        }
        confirmLabel={confirmTarget?.status === "ACTIVE" ? "Deactivate" : "Activate"}
        onConfirm={confirmStatusChange}
        onCancel={() => !confirmLoading && setConfirmTarget(null)}
      />
    </div>
  );
};

// ─── CATEGORIES PANEL ─────────────────────────────────────────────────────────
const EMPTY_CATEGORY = { name: "", description: "" };

/*
 * CATEGORY & SUBCATEGORY MANAGEMENT — admin-only, soft deactivation.
 * Deactivating keeps every medicine/batch relationship intact; the record
 * simply leaves operational dropdowns (server enforces this via /active).
 */
const CategoriesPanel = () => {
  const { toast } = useToast();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [expanded, setExpanded] = useState({});

  // Category add/edit modal
  const [catModal, setCatModal] = useState(null); // { mode: 'add'|'edit', id?, form }
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState("");

  // Subcategory add (inline) / edit modal
  const [subForms, setSubForms] = useState({});
  const [addingSubFor, setAddingSubFor] = useState(null); // category_id being saved
  const [subModal, setSubModal] = useState(null);         // { id, name }
  const [savingSub, setSavingSub] = useState(false);
  const [subError, setSubError] = useState("");

  // Status confirmation { type: 'category'|'subcategory', id, name, status }
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(false);
    categoriesAPI
      .getAll()
      .then((r) => {
        setCategories(Array.isArray(r.data) ? r.data : []);
        setLoading(false);
      })
      .catch(() => {
        setLoadError(true);
        setLoading(false);
      });
  };
  useEffect(() => {
    load();
  }, []);

  const counts = {
    ACTIVE: categories.filter((c) => c.status === "ACTIVE").length,
    INACTIVE: categories.filter((c) => c.status === "INACTIVE").length,
    ALL: categories.length,
  };

  const filtered = categories
    .filter((c) => statusFilter === "ALL" || c.status === statusFilter)
    .filter((c) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        c.name?.toLowerCase().includes(q) ||
        c.sub_categories?.some((s) => s.name?.toLowerCase().includes(q))
      );
    });

  /* ── Category create / edit ── */
  const openAddCategory = () => {
    setCategoryError("");
    setCatModal({ mode: "add", form: { ...EMPTY_CATEGORY } });
  };

  const openEditCategory = (cat) => {
    setCategoryError("");
    setCatModal({
      mode: "edit",
      id: cat.category_id,
      originalName: cat.name,
      form: { name: cat.name || "", description: cat.description || "" },
    });
  };

  const closeCategoryModal = () => {
    if (savingCategory) return; // close protection while saving
    setCatModal(null);
    setCategoryError("");
  };

  const submitCategory = async (e) => {
    e.preventDefault();
    if (savingCategory || !catModal) return;

    const name = catModal.form.name.replace(/\s+/g, " ").trim();
    if (!name) {
      setCategoryError("Category name is required.");
      return;
    }

    setSavingCategory(true);
    setCategoryError("");
    try {
      if (catModal.mode === "add") {
        await categoriesAPI.create({ name });
        toast.success("Category added successfully");
      } else {
        await categoriesAPI.update(catModal.id, { name });
        toast.success("Category updated successfully");
      }
      setCatModal(null);
      load();
    } catch (err) {
      setCategoryError(err.response?.data?.error || "Unable to save the category. Please try again.");
    } finally {
      setSavingCategory(false);
    }
  };

  /* ── Subcategory create / edit ── */
  const submitInlineSub = async (categoryId) => {
    if (addingSubFor) return; // duplicate guard
    const raw = (subForms[categoryId] || "").replace(/\s+/g, " ").trim();
    if (!raw) return;
    setAddingSubFor(categoryId);
    try {
      await categoriesAPI.addSubcategory(categoryId, { name: raw });
      toast.success("Subcategory added successfully");
      setSubForms((p) => ({ ...p, [categoryId]: "" }));
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Unable to add the subcategory. Please try again.");
    } finally {
      setAddingSubFor(null);
    }
  };

  const openEditSub = (sub) => {
    setSubError("");
    setSubModal({ id: sub.sub_category_id, name: sub.name });
  };

  const submitSubEdit = async (e) => {
    e.preventDefault();
    if (savingSub || !subModal) return;
    const name = subModal.name.replace(/\s+/g, " ").trim();
    if (!name) {
      setSubError("Subcategory name is required.");
      return;
    }
    setSavingSub(true);
    setSubError("");
    try {
      await categoriesAPI.updateSubcategory(subModal.id, { name });
      toast.success("Subcategory updated successfully");
      setSubModal(null);
      load();
    } catch (err) {
      setSubError(err.response?.data?.error || "Unable to save the subcategory. Please try again.");
    } finally {
      setSavingSub(false);
    }
  };

  /* ── Status changes with confirmation + loading ── */
  const confirmStatusChange = async () => {
    if (!confirmTarget || confirmLoading) return;
    const nextStatus = confirmTarget.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setConfirmLoading(true);
    try {
      if (confirmTarget.type === "category") {
        await categoriesAPI.changeStatus(confirmTarget.id, nextStatus);
      } else {
        await categoriesAPI.changeSubcategoryStatus(confirmTarget.id, nextStatus);
      }
      toast.success(
        `${confirmTarget.type === "category" ? "Category" : "Subcategory"} ${nextStatus === "ACTIVE" ? "activated" : "deactivated"}`
      );
      setConfirmTarget(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Unable to update the status. Please try again.");
    } finally {
      setConfirmLoading(false);
    }
  };

  const askToggleCategory = (cat) =>
    setConfirmTarget({ type: "category", id: cat.category_id, name: cat.name, status: cat.status });

  const askToggleSub = (sub) =>
    setConfirmTarget({ type: "subcategory", id: sub.sub_category_id, name: sub.name, status: sub.status });

  return (
    <div>
      <div className="mgmt-header">
        <div>
          <h2 className="settings-section-title">Category Management</h2>
          <p className="form-hint">
            Medicine classification. Inactive categories disappear from medicine forms but all existing records stay linked.
          </p>
        </div>
        <button onClick={openAddCategory} className="settings-add-btn">
          <Plus size={15} /> Add Category
        </button>
      </div>

      <div className="mgmt-toolbar">
        <div className="settings-search" style={{ marginBottom: 0 }}>
          <Search size={15} />
          <input
            type="text"
            placeholder="Search categories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search categories"
          />
        </div>
        <FilterTabs value={statusFilter} onChange={setStatusFilter} counts={counts} />
      </div>

      <div className="table-container">
        {loading ? (
          <TableSkeleton rows={6} cols={[30, 14, 12, 16, 12]} />
        ) : loadError ? (
          <ErrorState title="Unable to load categories" onRetry={load} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Tag size={26} />}
            title={
              search
                ? "No categories match your search"
                : statusFilter === "INACTIVE"
                  ? "No inactive categories"
                  : "No categories yet"
            }
            description={
              search
                ? "Try a different search term."
                : statusFilter === "ACTIVE"
                  ? "Create your first category to organize medicines."
                  : undefined
            }
          />
        ) : (
          <>
            {/* Desktop / tablet table */}
            <div className="table-scroll-wrap hide-mobile-table">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 220 }}>Category</th>
                    <th>Subcategories</th>
                    <th>Medicines</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((cat) => (
                    <React.Fragment key={cat.category_id}>
                      <tr>
                        <td>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
                            <button
                              type="button"
                              className="icon-btn"
                              style={{ width: 26, height: 26, borderRadius: 7 }}
                              aria-label={expanded[cat.category_id] ? "Hide subcategories" : "Show subcategories"}
                              aria-expanded={Boolean(expanded[cat.category_id])}
                              onClick={() =>
                                setExpanded((p) => ({ ...p, [cat.category_id]: !p[cat.category_id] }))
                              }
                            >
                              {expanded[cat.category_id]
                                ? <ChevronDown size={13} />
                                : <ChevronRight size={13} />}
                            </button>
                            <strong className="td-strong">{cat.name}</strong>
                          </span>
                        </td>
                        <td>{cat.sub_count ?? cat.sub_categories?.length ?? 0}</td>
                        <td>{cat.medicine_count ?? 0}</td>
                        <td><StatusBadge status={cat.status} /></td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button onClick={() => openEditCategory(cat)} className="tbl-action-btn edit">
                            <Edit size={13} /> Edit
                          </button>
                          <button
                            onClick={() => askToggleCategory(cat)}
                            className={`tbl-action-btn ${cat.status === "ACTIVE" ? "deactivate" : "activate"}`}
                          >
                            {cat.status === "ACTIVE" ? "Deactivate" : "Activate"}
                          </button>
                        </td>
                      </tr>

                      {/* Inline subcategory management */}
                      {expanded[cat.category_id] && (
                        <tr>
                          <td colSpan="5" style={{ background: "var(--surface-alt)", padding: "0.9rem 1rem 1rem 3.1rem" }}>
                            {(cat.sub_categories?.length || 0) === 0 && (
                              <p className="form-hint" style={{ marginBottom: "0.6rem" }}>No subcategories yet.</p>
                            )}
                            {cat.sub_categories?.map((sub) => (
                              <div key={sub.sub_category_id} className="subcat-row">
                                <span>└ <strong style={{ color: "var(--text-main)" }}>{sub.name}</strong>{" "}
                                  <small className="form-hint">· {sub.medicine_count ?? 0} medicines</small>
                                </span>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                                  <StatusBadge status={sub.status} />
                                  <button onClick={() => openEditSub(sub)} className="tbl-action-btn edit" style={{ fontSize: "0.72rem" }}>
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => askToggleSub(sub)}
                                    className={`tbl-action-btn ${sub.status === "ACTIVE" ? "deactivate" : "activate"}`}
                                    style={{ fontSize: "0.72rem" }}
                                  >
                                    {sub.status === "ACTIVE" ? "Deactivate" : "Activate"}
                                  </button>
                                </span>
                              </div>
                            ))}

                            {cat.status === "ACTIVE" ? (
                              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem", maxWidth: 420 }}>
                                <input
                                  className="form-control"
                                  placeholder="New subcategory name…"
                                  style={{ padding: "0.42rem 0.75rem", fontSize: "0.85rem" }}
                                  value={subForms[cat.category_id] || ""}
                                  onChange={(e) => setSubForms((p) => ({ ...p, [cat.category_id]: e.target.value }))}
                                  onKeyDown={(e) => e.key === "Enter" && submitInlineSub(cat.category_id)}
                                />
                                <button
                                  type="button"
                                  onClick={() => submitInlineSub(cat.category_id)}
                                  className="settings-add-btn"
                                  disabled={addingSubFor !== null}
                                  aria-busy={addingSubFor === cat.category_id}
                                >
                                  {addingSubFor === cat.category_id
                                    ? <Loader2 size={13} className="spin" />
                                    : <Plus size={13} />}
                                  {addingSubFor === cat.category_id ? "Adding…" : "Add"}
                                </button>
                              </div>
                            ) : (
                              <p className="form-hint" style={{ marginTop: "0.5rem" }}>
                                Activate this category before adding new subcategories.
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="show-mobile-table" style={{ padding: "0.6rem" }}>
              {filtered.map((cat) => (
                <div key={cat.category_id} className="mobile-card">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "flex-start" }}>
                    <strong style={{ color: "var(--text-main)" }}>{cat.name}</strong>
                    <StatusBadge status={cat.status} />
                  </div>
                  <div style={{ marginTop: "0.4rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    {cat.sub_count ?? 0} subcategories · {cat.medicine_count ?? 0} medicines
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.7rem", flexWrap: "wrap" }}>
                    <button onClick={() => openEditCategory(cat)} className="tbl-action-btn edit">Edit</button>
                    <button
                      onClick={() => askToggleCategory(cat)}
                      className={`tbl-action-btn ${cat.status === "ACTIVE" ? "deactivate" : "activate"}`}
                    >
                      {cat.status === "ACTIVE" ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      className="tbl-action-btn reset"
                      onClick={() => setExpanded((p) => ({ ...p, [cat.category_id]: !p[cat.category_id] }))}
                    >
                      {expanded[cat.category_id] ? "Hide subs" : `Subs (${cat.sub_categories?.length || 0})`}
                    </button>
                  </div>

                  {expanded[cat.category_id] && (
                    <div style={{ marginTop: "0.7rem", borderTop: "1px dashed var(--border)", paddingTop: "0.7rem" }}>
                      {cat.sub_categories?.map((sub) => (
                        <div key={sub.sub_category_id} className="subcat-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.3rem" }}>
                          <span style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                            <strong style={{ color: "var(--text-main)", fontWeight: 600 }}>└ {sub.name}</strong>
                            <StatusBadge status={sub.status} />
                          </span>
                          <span style={{ display: "flex", gap: "0.35rem" }}>
                            <button onClick={() => openEditSub(sub)} className="tbl-action-btn edit" style={{ fontSize: "0.7rem" }}>Edit</button>
                            <button
                              onClick={() => askToggleSub(sub)}
                              className={`tbl-action-btn ${sub.status === "ACTIVE" ? "deactivate" : "activate"}`}
                              style={{ fontSize: "0.7rem" }}
                            >
                              {sub.status === "ACTIVE" ? "Deactivate" : "Activate"}
                            </button>
                          </span>
                        </div>
                      ))}
                      {cat.status === "ACTIVE" && (
                        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
                          <input
                            className="form-control"
                            placeholder="New subcategory…"
                            style={{ padding: "0.42rem 0.75rem", fontSize: "0.82rem" }}
                            value={subForms[cat.category_id] || ""}
                            onChange={(e) => setSubForms((p) => ({ ...p, [cat.category_id]: e.target.value }))}
                            onKeyDown={(e) => e.key === "Enter" && submitInlineSub(cat.category_id)}
                          />
                          <button
                            type="button"
                            onClick={() => submitInlineSub(cat.category_id)}
                            className="settings-add-btn"
                            disabled={addingSubFor !== null}
                          >
                            {addingSubFor === cat.category_id ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="table-footer">
              <span>{filtered.length} categor{filtered.length === 1 ? "y" : "ies"}</span>
            </div>
          </>
        )}
      </div>

      {/* Category Add / Edit modal */}
      {catModal && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeCategoryModal(); }}>
          <div className="modal-card" style={{ maxWidth: "430px" }} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>{catModal.mode === "add" ? "Add Category" : "Edit Category"}</h2>
              <button type="button" className="modal-close-btn" onClick={closeCategoryModal} disabled={savingCategory} aria-label="Close">×</button>
            </div>
            <form onSubmit={submitCategory}>
              <fieldset disabled={savingCategory} style={{ border: "none", margin: 0, padding: 0 }}>
                <div className="form-group full-width">
                  <label>Category Name *</label>
                  <input
                    required
                    maxLength={100}
                    autoFocus
                    className="form-control"
                    placeholder="e.g. Antibiotics"
                    value={catModal.form.name}
                    onChange={(e) => setCatModal({ ...catModal, form: { ...catModal.form, name: e.target.value } })}
                  />
                </div>
                <div className="form-group full-width" style={{ marginTop: "0.9rem" }}>
                  <label>Description</label>
                  <textarea
                    rows="2"
                    maxLength={300}
                    className="form-control"
                    placeholder="Optional short description…"
                    value={catModal.form.description}
                    onChange={(e) => setCatModal({ ...catModal, form: { ...catModal.form, description: e.target.value } })}
                  />
                </div>
                <div style={{ marginTop: "0.9rem" }}>
                  <span className="form-hint">
                    Status:{" "}
                    <StatusBadge status={catModal.mode === "add" ? "ACTIVE" : undefined} />
                    {catModal.mode === "add" && " (new categories start active)"}
                  </span>
                  {catModal.mode === "edit" && (
                    <p className="form-hint" style={{ marginTop: "0.35rem" }}>
                      Use Activate / Deactivate in the list to change status safely — history is preserved either way.
                    </p>
                  )}
                </div>
              </fieldset>

              {categoryError && (
                <div className="auth-alert auth-alert--error" role="alert" style={{ marginTop: "1rem" }}>
                  <strong>Unable to save</strong>
                  <span>{categoryError}</span>
                </div>
              )}

              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={closeCategoryModal} disabled={savingCategory}>
                  Cancel
                </button>
                <button type="submit" className="btn-save" disabled={savingCategory} aria-busy={savingCategory}>
                  {savingCategory ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
                  {savingCategory
                    ? (catModal.mode === "add" ? "Adding Category…" : "Saving Changes…")
                    : (catModal.mode === "add" ? "Add Category" : "Save Changes")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Subcategory Edit modal */}
      {subModal && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !savingSub) setSubModal(null); }}>
          <div className="modal-card" style={{ maxWidth: "400px" }} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2>Edit Subcategory</h2>
              <button type="button" className="modal-close-btn" onClick={() => !savingSub && setSubModal(null)} disabled={savingSub} aria-label="Close">×</button>
            </div>
            <form onSubmit={submitSubEdit}>
              <fieldset disabled={savingSub} style={{ border: "none", margin: 0, padding: 0 }}>
                <div className="form-group full-width">
                  <label>Subcategory Name *</label>
                  <input
                    required
                    maxLength={100}
                    autoFocus
                    className="form-control"
                    value={subModal.name}
                    onChange={(e) => setSubModal({ ...subModal, name: e.target.value })}
                  />
                </div>
              </fieldset>
              {subError && (
                <div className="auth-alert auth-alert--error" role="alert" style={{ marginTop: "1rem" }}>
                  <strong>Unable to save</strong>
                  <span>{subError}</span>
                </div>
              )}
              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => setSubModal(null)} disabled={savingSub}>
                  Cancel
                </button>
                <button type="submit" className="btn-save" disabled={savingSub} aria-busy={savingSub}>
                  {savingSub ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
                  {savingSub ? "Saving Changes…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Activate / Deactivate confirmations */}
      <ConfirmDialog
        open={Boolean(confirmTarget)}
        danger={confirmTarget?.status === "ACTIVE"}
        loading={confirmLoading}
        title={
          confirmTarget?.status === "ACTIVE"
            ? `Deactivate ${confirmTarget?.type === "category" ? "Category" : "Subcategory"}?`
            : `Activate ${confirmTarget?.type === "category" ? "Category" : "Subcategory"}?`
        }
        message={
          confirmTarget?.status === "ACTIVE"
            ? `"${confirmTarget?.name}" will no longer appear in active medicine forms and selection lists. Existing medicine records using it remain unchanged.`
            : `"${confirmTarget?.name}" will become available in active forms and selection lists again.`
        }
        confirmLabel={confirmTarget?.status === "ACTIVE" ? "Deactivate" : "Activate"}
        onConfirm={confirmStatusChange}
        onCancel={() => !confirmLoading && setConfirmTarget(null)}
      />
    </div>
  );
};

// ─── PRICING PANEL ────────────────────────────────────────────────────────────
const PricingPanel = () => {
  const { toast, withLoading } = useToast();
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    default_profit_margin: "25",
    currency: "ETB",
    default_tax_rate: "0",
    enable_tax: "false",
    price_rounding: "none",
  });

  useEffect(() => {
    setLoading(true);
    settingsAPI
      .getAll()
      .then((r) => {
        const s = r.data;
        setForm({
          default_profit_margin: s.default_profit_margin?.value || "25",
          currency: s.currency?.value || "ETB",
          default_tax_rate: s.default_tax_rate?.value || "0",
          enable_tax: s.enable_tax?.value || "false",
          price_rounding: s.price_rounding?.value || "none",
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    try {
      await settingsAPI.updateBatch(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      toast.error("Failed to save settings");
    }
  };

  return (
    <div style={{ maxWidth: "600px" }}>
      <h2 className="settings-section-title" style={{ marginBottom: "1.5rem" }}>
        Pricing & Tax Configuration
      </h2>
      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}
        >
          <div className="pricing-field">
            <label>Currency</label>
            <select
              className="form-control"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              <option value="ETB">ETB – Ethiopian Birr</option>
              <option value="USD">USD – US Dollar</option>
              <option value="EUR">EUR – Euro</option>
            </select>
          </div>
          <div className="pricing-field">
            <label>Default Profit Margin (%)</label>
            <p
              style={{
                fontSize: "0.8rem",
                color: "var(--text-muted)",
                margin: "0 0 0.5rem",
              }}
            >
              Buy Price × (1 + margin%) = Sell Price. At 25%: Buy 100 ETB → Sell
              125 ETB
            </p>
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <input
                type="number"
                min="0"
                max="500"
                className="form-control"
                style={{ maxWidth: "120px" }}
                value={form.default_profit_margin}
                onChange={(e) =>
                  setForm({ ...form, default_profit_margin: e.target.value })
                }
              />
              <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>%</span>
            </div>
          </div>
          <div className="pricing-field">
            <label>Enable Tax</label>
            <select
              className="form-control"
              value={form.enable_tax}
              onChange={(e) => setForm({ ...form, enable_tax: e.target.value })}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </div>
          {form.enable_tax === "true" && (
            <div className="pricing-field">
              <label>Tax Rate (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                className="form-control"
                style={{ maxWidth: "120px" }}
                value={form.default_tax_rate}
                onChange={(e) =>
                  setForm({ ...form, default_tax_rate: e.target.value })
                }
              />
            </div>
          )}
          <div className="pricing-field">
            <label>Price Rounding</label>
            <select
              className="form-control"
              value={form.price_rounding}
              onChange={(e) =>
                setForm({ ...form, price_rounding: e.target.value })
              }
            >
              <option value="none">No Rounding</option>
              <option value="nearest_1">Nearest 1 ETB</option>
              <option value="nearest_5">Nearest 5 ETB</option>
              <option value="nearest_10">Nearest 10 ETB</option>
            </select>
          </div>

          <button
            onClick={handleSave}
            style={{
              alignSelf: "flex-start",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "0.7rem 1.5rem",
              background: saved ? "var(--success)" : "var(--primary)",
              color: saved ? "#ffffff" : "var(--primary-text)",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: 700,
              transition: "background 0.3s",
            }}
          >
            {saved ? (
              <>
                <Check size={15} /> Saved!
              </>
            ) : (
              <>
                <Check size={15} /> Save Settings
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── AUDIT LOGS PANEL ─────────────────────────────────────────────────────────
const AuditPanel = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Extended server-side filters — the CSV export uses EXACTLY these values.
  const [actionFilter, setActionFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [meta, setMeta] = useState({ actions: [], modules: [] });

  const activeFilters = {
    from: dateFrom || undefined,
    to: dateTo || undefined,
    action: actionFilter || undefined,
    module: moduleFilter || undefined,
    status: statusFilter || undefined,
    user: userFilter.trim() || undefined,
  };

  const loadFilters = () => {
    import("../services/api").then(({ default: api }) => {
      api.get("/audit-logs/meta/actions")
        .then((r) => setMeta({
          actions: r.data?.actions || [],
          modules: r.data?.modules || [],
        }))
        .catch(() => {});
    });
  };

  useEffect(() => {
    loadFilters();
  }, []);

  const load = (pageNum = page) => {
    setLoading(true);
    setLoadError(false);
    import("../services/api").then(({ default: api }) => {
      api
        .get("/audit-logs", { params: { page: pageNum, limit: 50, ...activeFilters } })
        .then((r) => {
          const body = r.data || {};
          setLogs(Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : []);
          if (body.pagination) setPagination(body.pagination);
          setLoading(false);
        })
        .catch(() => {
          setLogs([]);
          setLoading(false);
          setLoadError(true);
        });
    });
  };

  useEffect(() => {
    load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const exportCSV = () => {
    import("../services/api").then(({ reportsAPI }) => {
      const url = reportsAPI.exportAuditLogsUrl(activeFilters);
      window.open(url, "_blank");
    });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.6rem", marginBottom: "1rem" }}>
        <h2 className="settings-section-title">Audit &amp; Security Logs</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={exportCSV} disabled={loading}>
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="audit-filters">
        <label>
          From
          <input type="date" className="form-control" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
        </label>
        <label>
          To
          <input type="date" className="form-control" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" />
        </label>
        <label>
          Action
          <select className="form-control" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} aria-label="Action filter">
            <option value="">All</option>
            {(meta.actions.length ? meta.actions : ["LOGIN", "LOGIN_BLOCKED", "LOGOUT", "SALE_CREATED", "SALE_FAILED", "CONTROLLED_SALE", "STOCK_RECEIVED", "PHYSICAL_COUNT", "MEDICINE_CREATED", "MEDICINE_UPDATED", "CREATE", "UPDATE", "PASSWORD_RESET", "SESSION_REVOKED", "ACCOUNT_LOCKED", "AUTHZ_DENIED", "AUDIT_EXPORTED", "GUEST_LOGIN"]).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Module
          <select className="form-control" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} aria-label="Module filter">
            <option value="">All</option>
            {(meta.modules.length ? meta.modules : ["AUTH", "SECURITY", "SALES", "POS", "INVENTORY", "MEDICINES", "USERS"]).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Result
          <select className="form-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Result filter">
            <option value="">All</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILED">Failed</option>
          </select>
        </label>
        <label>
          User
          <input type="text" className="form-control" placeholder="Name or username" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} aria-label="User filter" />
        </label>
        <div className="audit-filter-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setPage(1); load(1); }}>
            Apply
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setDateFrom(""); setDateTo(""); setActionFilter(""); setModuleFilter("");
              setStatusFilter(""); setUserFilter(""); setPage(1);
              setTimeout(() => load(1), 0);
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="table-container">
        <div className="table-scroll-wrap">
          <table className="custom-table">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>Module</th>
                <th>Record</th>
                <th>Description</th>
                <th>IP</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan="8" style={{ textAlign: "center", padding: "2rem", color: "var(--text-faint)" }}>
                    Loading audit logs…
                  </td>
                </tr>
              )}
              {!loading && loadError && (
                <tr>
                  <td colSpan="8" style={{ textAlign: "center", padding: "2rem" }}>
                    Unable to load audit logs.{" "}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => load()}>Try Again</button>
                  </td>
                </tr>
              )}
              {!loading && !loadError && logs.length === 0 && (
                <tr>
                  <td colSpan="8" style={{ textAlign: "center", padding: "2rem", color: "var(--text-faint)" }}>
                    No audit records match these filters.
                  </td>
                </tr>
              )}
              {!loading &&
                logs.map((log) => (
                  <tr key={log.id ?? `${log.timestamp}-${log.action}`}>
                    <td style={{ fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                      {log.timestamp ? new Date(log.timestamp).toLocaleString() : "—"}
                    </td>
                    <td>
                      <strong>{log.full_name || log.username || (log.user_id ? `#${log.user_id}` : "System")}</strong>
                      {log.username && log.full_name && (
                        <small style={{ display: "block", color: "var(--text-faint)", fontSize: "0.7rem" }}>{log.username}</small>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${["LOGIN_BLOCKED", "SALE_FAILED", "AUTHZ_DENIED", "ACCOUNT_LOCKED"].includes(log.action) || log.status === "FAILED" ? "badge-danger" : log.module === "SECURITY" ? "badge-warning" : "badge-primary"}`}>
                        {log.action}
                      </span>
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{log.module || "—"}</td>
                    <td style={{ fontSize: "0.78rem" }}>
                      {[log.entity_type, log.entity_id].filter(Boolean).join(" #") || "—"}
                    </td>
                    <td style={{ fontSize: "0.78rem", maxWidth: "280px" }}>
                      <span className="cell-truncate" style={{ display: "block" }} title={log.description}>
                        {log.description || "—"}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.72rem", fontFamily: "monospace" }}>{log.ip_address || "—"}</td>
                    <td>
                      <span className={`badge ${log.status === "FAILED" ? "badge-danger" : "badge-secondary"}`}>
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="table-footer">
          <span>Page {pagination.page} of {Math.max(1, pagination.totalPages)} · {pagination.total} record{pagination.total === 1 ? "" : "s"} · timestamps shown in your local timezone</span>
          <div className="pagination">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pagination.page <= 1}>‹ Prev</button>
            <button onClick={() => setPage((p) => Math.min(pagination.totalPages || 1, p + 1))} disabled={pagination.page >= pagination.totalPages}>Next ›</button>
          </div>
        </div>
      </div>
    </div>
  );
};
