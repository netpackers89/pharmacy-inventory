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
} from "lucide-react";
import {
  usersAPI,
  suppliersAPI,
  categoriesAPI,
  settingsAPI,
} from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

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
        <div style={{ textAlign: "center", padding: "5rem", color: "#ef4444" }}>
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
                  color: "#64748b",
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
const SuppliersPanel = () => {
  const { toast, withLoading } = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editSup, setEditSup] = useState(null);
  const [form, setForm] = useState({
    name: "",
    contact_person: "",
    phone: "",
    email: "",
    address: "",
  });

  const load = () => {
    setLoading(true);
    suppliersAPI
      .getAll()
      .then((r) => {
        setSuppliers(r.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);

  const filtered = suppliers.filter((s) =>
    s.name?.toLowerCase().includes(search.toLowerCase()),
  );

  const openAdd = () => {
    setEditSup(null);
    setForm({
      name: "",
      contact_person: "",
      phone: "",
      email: "",
      address: "",
    });
    setShowModal(true);
  };
  const openEdit = (s) => {
    setEditSup(s);
    setForm({
      name: s.name,
      contact_person: s.contact_person || "",
      phone: s.phone || "",
      email: s.email || "",
      address: s.address || "",
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editSup) {
        await suppliersAPI.update(editSup.supplier_id, form);
      } else {
        await suppliersAPI.create(form);
      }
      setShowModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save");
    }
  };

  const toggleStatus = async (s) => {
    const newStatus = s.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await suppliersAPI.update(s.supplier_id, { status: newStatus });
      load();
    } catch {
      toast.error("Operation failed");
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
        <h2 className="settings-section-title">Suppliers</h2>
        <button onClick={openAdd} className="settings-add-btn">
          <Plus size={15} /> Add Supplier
        </button>
      </div>
      <div className="settings-search">
        <Search size={15} />
        <input
          type="text"
          placeholder="Search suppliers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div
        style={{
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        }}
      >
        {loading && <p style={{ color: "#64748b" }}>Loading...</p>}
        {!loading &&
          filtered.map((s) => (
            <div key={s.supplier_id} className="supplier-card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <h3
                    style={{
                      fontWeight: 800,
                      color: "#0f172a",
                      marginBottom: "0.25rem",
                    }}
                  >
                    {s.name}
                  </h3>
                  <span
                    className={`badge ${s.status === "ACTIVE" ? "badge-success" : "badge-danger"}`}
                  >
                    {s.status}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "0.35rem" }}>
                  <button
                    onClick={() => openEdit(s)}
                    className="tbl-action-btn edit"
                  >
                    <Edit size={13} />
                  </button>
                  <button
                    onClick={() => toggleStatus(s)}
                    className={`tbl-action-btn ${s.status === "ACTIVE" ? "deactivate" : "activate"}`}
                  >
                    {s.status === "ACTIVE" ? (
                      <UserX size={13} />
                    ) : (
                      <UserCheck size={13} />
                    )}
                  </button>
                </div>
              </div>
              <div
                style={{
                  marginTop: "0.75rem",
                  fontSize: "0.82rem",
                  color: "#475569",
                  lineHeight: 1.8,
                }}
              >
                {s.contact_person && <div>👤 {s.contact_person}</div>}
                {s.phone && <div>📞 {s.phone}</div>}
                {s.email && <div>📧 {s.email}</div>}
                {s.address && <div>📍 {s.address}</div>}
              </div>
              <div
                style={{
                  marginTop: "0.75rem",
                  display: "flex",
                  gap: "1rem",
                  fontSize: "0.8rem",
                  color: "#64748b",
                  borderTop: "1px solid #f1f5f9",
                  paddingTop: "0.5rem",
                }}
              >
                <span>{s.total_batches || 0} Batches</span>
                <span>
                  ETB {parseFloat(s.total_value || 0).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        {!loading && filtered.length === 0 && (
          <p
            style={{
              color: "#94a3b8",
              gridColumn: "1/-1",
              textAlign: "center",
              padding: "2rem",
            }}
          >
            No suppliers found.
          </p>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: "500px" }}>
            <div className="modal-header">
              <h3>{editSup ? "Edit Supplier" : "Add Supplier"}</h3>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "1.5rem",
                  cursor: "pointer",
                  color: "#64748b",
                }}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group full-width">
                  <label>Company Name *</label>
                  <input
                    required
                    className="form-control"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Contact Person</label>
                  <input
                    className="form-control"
                    value={form.contact_person}
                    onChange={(e) =>
                      setForm({ ...form, contact_person: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    className="form-control"
                    value={form.phone}
                    onChange={(e) =>
                      setForm({ ...form, phone: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    className="form-control"
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                  />
                </div>
                <div className="form-group full-width">
                  <label>Address</label>
                  <textarea
                    rows="2"
                    className="form-control"
                    value={form.address}
                    onChange={(e) =>
                      setForm({ ...form, address: e.target.value })
                    }
                  />
                </div>
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
    </div>
  );
};

// ─── CATEGORIES PANEL ─────────────────────────────────────────────────────────
const CategoriesPanel = () => {
  const { toast, withLoading } = useToast();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [expanded, setExpanded] = useState({});
  const [subForms, setSubForms] = useState({}); // { cat_id: name }

  const load = () => {
    setLoading(true);
    categoriesAPI
      .getAll()
      .then((r) => {
        setCategories(r.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);

  const addCategory = async () => {
    if (!newCatName.trim()) return;
    try {
      await categoriesAPI.create({ name: newCatName.trim() });
      setNewCatName("");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed");
    }
  };

  const toggleCat = async (cat) => {
    try {
      await categoriesAPI.update(cat.category_id, {
        status: cat.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      });
      load();
    } catch {
      toast.error("Operation failed");
    }
  };

  const addSubcat = async (catId) => {
    const name = subForms[catId]?.trim();
    if (!name) return;
    try {
      await categoriesAPI.addSubcategory(catId, { name });
      setSubForms((p) => ({ ...p, [catId]: "" }));
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed");
    }
  };

  const toggleSubcat = async (sub) => {
    try {
      await categoriesAPI.updateSubcategory(sub.sub_category_id, {
        status: sub.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      });
      load();
    } catch {
      toast.error("Operation failed");
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
        <h2 className="settings-section-title">Categories & Subcategories</h2>
      </div>
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <input
          className="form-control"
          placeholder="New category name..."
          value={newCatName}
          onChange={(e) => setNewCatName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addCategory()}
          style={{ flex: 1 }}
        />
        <button onClick={addCategory} className="settings-add-btn">
          <Plus size={15} /> Add
        </button>
      </div>

      {loading && <p style={{ color: "#64748b" }}>Loading...</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {categories.map((cat) => (
          <div key={cat.category_id} className="cat-card">
            <div
              className="cat-header"
              onClick={() =>
                setExpanded((p) => ({
                  ...p,
                  [cat.category_id]: !p[cat.category_id],
                }))
              }
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                }}
              >
                <span className="cat-arrow">
                  {expanded[cat.category_id] ? "▼" : "▶"}
                </span>
                <strong style={{ color: "#0f172a" }}>{cat.name}</strong>
                <span className="badge badge-secondary">
                  {cat.sub_categories?.length || 0} sub
                </span>
                <span
                  className={`badge ${cat.status === "ACTIVE" ? "badge-success" : "badge-danger"}`}
                >
                  {cat.status}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCat(cat);
                }}
                className={`tbl-action-btn ${cat.status === "ACTIVE" ? "deactivate" : "activate"}`}
                style={{ fontSize: "0.75rem" }}
              >
                {cat.status === "ACTIVE" ? "Deactivate" : "Activate"}
              </button>
            </div>

            {expanded[cat.category_id] && (
              <div className="cat-body">
                {cat.sub_categories?.map((sub) => (
                  <div key={sub.sub_category_id} className="subcat-row">
                    <span>└ {sub.name}</span>
                    <div
                      style={{
                        display: "flex",
                        gap: "0.35rem",
                        alignItems: "center",
                      }}
                    >
                      <span
                        className={`badge ${sub.status === "ACTIVE" ? "badge-success" : "badge-danger"}`}
                      >
                        {sub.status}
                      </span>
                      <button
                        onClick={() => toggleSubcat(sub)}
                        className={`tbl-action-btn ${sub.status === "ACTIVE" ? "deactivate" : "activate"}`}
                        style={{ fontSize: "0.72rem" }}
                      >
                        {sub.status === "ACTIVE" ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </div>
                ))}
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    marginTop: "0.5rem",
                  }}
                >
                  <input
                    className="form-control"
                    placeholder="Add subcategory..."
                    style={{
                      flex: 1,
                      padding: "0.4rem 0.75rem",
                      fontSize: "0.85rem",
                    }}
                    value={subForms[cat.category_id] || ""}
                    onChange={(e) =>
                      setSubForms((p) => ({
                        ...p,
                        [cat.category_id]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) =>
                      e.key === "Enter" && addSubcat(cat.category_id)
                    }
                  />
                  <button
                    onClick={() => addSubcat(cat.category_id)}
                    className="settings-add-btn"
                    style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}
                  >
                    + Add
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {!loading && categories.length === 0 && (
          <p style={{ color: "#94a3b8", textAlign: "center" }}>
            No categories yet. Add one above.
          </p>
        )}
      </div>
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
        <p style={{ color: "#64748b" }}>Loading...</p>
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
                color: "#64748b",
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
              <span style={{ color: "#64748b", fontWeight: 700 }}>%</span>
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
              background: saved ? "#10b981" : "#2563eb",
              color: "white",
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

  useEffect(() => {
    setLoading(true);
    // fetch audit logs
    import("../services/api").then(({ default: api }) => {
      api
        .get("/audit-logs")
        .then((r) => {
          setLogs(r.data);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    });
  }, []);

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
        <h2 className="settings-section-title">Audit Logs</h2>
        <span
          style={{ fontSize: "0.8rem", color: "#94a3b8", fontStyle: "italic" }}
        >
          Read-only — cannot edit or delete
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="custom-table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Action</th>
              <th>Table</th>
              <th>Record ID</th>
              <th>Before</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan="7"
                  style={{ textAlign: "center", padding: "2rem" }}
                >
                  Loading audit logs...
                </td>
              </tr>
            )}
            {!loading && logs.length === 0 && (
              <tr>
                <td
                  colSpan="7"
                  style={{
                    textAlign: "center",
                    padding: "2rem",
                    color: "#94a3b8",
                  }}
                >
                  No audit logs recorded yet.
                </td>
              </tr>
            )}
            {!loading &&
              logs.map((log) => (
                <tr key={log.audit_id}>
                  <td style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td>
                    <strong>{log.user_name || `#${log.user_id}`}</strong>
                  </td>
                  <td>
                    <span className="badge badge-primary">{log.action}</span>
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
                    {log.table_name}
                  </td>
                  <td>{log.record_id}</td>
                  <td
                    style={{
                      fontSize: "0.75rem",
                      maxWidth: "150px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {log.old_values
                      ? JSON.stringify(log.old_values).substring(0, 50) + "..."
                      : "—"}
                  </td>
                  <td
                    style={{
                      fontSize: "0.75rem",
                      maxWidth: "150px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {log.new_values
                      ? JSON.stringify(log.new_values).substring(0, 50) + "..."
                      : "—"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
