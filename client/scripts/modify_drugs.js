const fs = require('fs');
const file = '/home/netsanetdesta/Downloads/pharmacy-inventory-main/pharmacy-inventory-main/client/src/pages/Drugs.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Initial form state
content = content.replace(
  "prescription_type: 'OTC',",
  "prescription_type: 'OTC',\n    barcode: '',\n    qr_code: '',\n    abc_category: '',\n    ven_category: '',\n    reorder_level: 50,\n    max_level: 500,"
);

// 2. handleOpenEditModal
content = content.replace(
  "prescription_type: med.prescription_type || 'OTC',",
  "prescription_type: med.prescription_type || 'OTC',\n      barcode: med.barcode || '',\n      qr_code: med.qr_code || '',\n      abc_category: med.abc_category || '',\n      ven_category: med.ven_category || '',\n      reorder_level: med.reorder_level || 50,\n      max_level: med.max_level || 500,"
);

// 3. Validation
content = content.replace(
  "const handleSubmitForm = async (e) => {\n    e.preventDefault();\n    try {",
  "const handleSubmitForm = async (e) => {\n    e.preventDefault();\n    if (!formData.barcode && !formData.qr_code) {\n      alert('At least one of Barcode or QR Code is required.');\n      return;\n    }\n    try {"
);

// 4. Badges Column Header
content = content.replace(
  "<th>Type</th>",
  "<th>Type</th>\n                <th>ABC/VEN</th>"
);

// 5. Badges Column Body
content = content.replace(
  "<td><span className=\"badge\">{med.prescription_type}</span></td>",
  "<td><span className=\"badge\">{med.prescription_type}</span></td>\n                    <td>\n                      {med.abc_category && <span className=\"badge\" style={{ background: med.abc_category === 'A' ? '#eff6ff' : med.abc_category === 'B' ? '#fff7ed' : '#f8fafc', color: med.abc_category === 'A' ? '#2563eb' : med.abc_category === 'B' ? '#ea580c' : '#64748b', marginRight: '4px' }}>{med.abc_category}</span>}\n                      {med.ven_category && <span className=\"badge\" style={{ background: med.ven_category === 'V' ? '#fef2f2' : med.ven_category === 'E' ? '#f0fdf4' : '#f8fafc', color: med.ven_category === 'V' ? '#dc2626' : med.ven_category === 'E' ? '#16a34a' : '#64748b' }}>{med.ven_category}</span>}\n                    </td>"
);

// 6. Identification Section
content = content.replace(
  "{/* SECTION B – Clinical Info */}",
  `{/* Medicine Identification Section */}\n              <div style={{ marginBottom: '1.5rem', border: '1.5px solid #e2e8f0', padding: '1.25rem', borderRadius: '10px' }}>\n                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid #e2e8f0' }}>\n                  Medicine Identification\n                </h3>\n                <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>At least one identification code is required</p>\n                <div className="form-grid">\n                  <div className="form-group">\n                    <label>Barcode</label>\n                    <input type="text" className="form-control" value={formData.barcode} onChange={e => setFormData({ ...formData, barcode: e.target.value })} placeholder="e.g. 6281234567890" />\n                  </div>\n                  <div className="form-group">\n                    <label>QR Code</label>\n                    <input type="text" className="form-control" value={formData.qr_code} onChange={e => setFormData({ ...formData, qr_code: e.target.value })} placeholder="e.g. https://... or QR data" />\n                  </div>\n                  <div className="form-group">\n                    <label>ABC Category</label>\n                    <select className="form-control" value={formData.abc_category} onChange={e => setFormData({ ...formData, abc_category: e.target.value })}>\n                      <option value="">— Not Classified —</option>\n                      <option value="A">A - High Value</option>\n                      <option value="B">B - Medium Value</option>\n                      <option value="C">C - Low Value</option>\n                    </select>\n                  </div>\n                  <div className="form-group">\n                    <label>VEN Category</label>\n                    <select className="form-control" value={formData.ven_category} onChange={e => setFormData({ ...formData, ven_category: e.target.value })}>\n                      <option value="">— Not Classified —</option>\n                      <option value="V">V - Vital</option>\n                      <option value="E">E - Essential</option>\n                      <option value="N">N - Non-Essential</option>\n                    </select>\n                  </div>\n                  <div className="form-group">\n                    <label>Reorder Level</label>\n                    <input type="number" className="form-control" value={formData.reorder_level} onChange={e => setFormData({ ...formData, reorder_level: parseInt(e.target.value)||0 })} />\n                  </div>\n                  <div className="form-group">\n                    <label>Max Level</label>\n                    <input type="number" className="form-control" value={formData.max_level} onChange={e => setFormData({ ...formData, max_level: parseInt(e.target.value)||0 })} />\n                  </div>\n                </div>\n              </div>\n\n              {/* SECTION B – Clinical Info */}`
);

// 7. Add Import Modal State and functions
const importState = `\n  const [isImportModalOpen, setIsImportModalOpen] = useState(false);\n  const [importLoading, setImportLoading] = useState(false);\n  const [importPreview, setImportPreview] = useState(null);\n  const [importResults, setImportResults] = useState(null);\n\n  const handleFileUpload = (e) => {\n    const file = e.target.files[0];\n    if (!file) return;\n    const reader = new FileReader();\n    reader.onload = async (evt) => {\n      const text = evt.target.result;\n      const lines = text.split('\\n').filter(l => l.trim() !== '');\n      if (lines.length < 2) return;\n      const headers = lines[0].split(',').map(h => h.trim());\n      const data = lines.slice(1).map(line => {\n        const values = line.split(',');\n        const obj = {};\n        headers.forEach((h, i) => obj[h] = values[i]?.trim());\n        return obj;\n      });\n      \n+      setImportLoading(true);\n+      try {\n+        const res = await medicinesAPI.previewImport(data);\n+        setImportPreview(res.data);\n+      } catch (err) {\n+        alert('Preview failed');\n+      }\n+      setImportLoading(false);\n+    };\n+    reader.readAsText(file);\n+  };\n+\n+  const handleConfirmImport = async () => {\n+    setImportLoading(true);\n+    try {\n+      const res = await medicinesAPI.confirmImport(importPreview);\n+      setImportResults(res.data);\n+      fetchMedicines();\n+    } catch (err) {\n+      alert('Import failed');\n+    }\n+    setImportLoading(false);\n+  };\n\n+  const closeImportModal = () => {\n+    setIsImportModalOpen(false);\n+    setImportPreview(null);\n+    setImportResults(null);\n+  };\n`;
content = content.replace(
  "const [addInitialStock, setAddInitialStock] = useState(false);",
  "const [addInitialStock, setAddInitialStock] = useState(false);\n" + importState
);

// 8. Import Button
content = content.replace(
  "<button className=\"btn-scan\" style={{ background: '#2563eb' }} onClick={handleOpenAddModal}>",
  `<button className="btn-scan" style={{ background: '#10b981', marginRight: '10px' }} onClick={() => setIsImportModalOpen(true)}>
          <span className="btn-scan-label">Import</span>
        </button>
        <button className="btn-scan" style={{ background: '#2563eb' }} onClick={handleOpenAddModal}>`
);

// 9. Import Modal JSX
const importModalJSX = `\n      {isImportModalOpen && (\n        <div className="modal-overlay">\n          <div className="modal-card" style={{ maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto' }}>\n            <div className="modal-header">\n              <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Import Medicines</h2>\n              <button onClick={closeImportModal} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' }}>×</button>\n            </div>\n            {!importPreview && !importResults && (\n              <div style={{ padding: '2rem', textAlign: 'center', border: '2px dashed #cbd5e1', borderRadius: '10px', marginTop: '1rem' }}>\n                <p>Upload CSV File</p>\n                <input type="file" accept=".csv" onChange={handleFileUpload} />\n              </div>\n            )}\n            {importLoading && <p style={{ textAlign: 'center', padding: '1rem' }}>Loading...</p>}\n            {importPreview && !importResults && !importLoading && (\n              <div>\n                <table className="custom-table" style={{ marginTop: '1rem' }}>\n                  <thead>\n                    <tr><th>Row</th><th>Medicine</th><th>Batch</th><th>Qty</th><th>Decision</th></tr>\n                  </thead>\n                  <tbody>\n                    {importPreview.map((row, i) => (\n                      <tr key={i}>\n                        <td>{row.Row || i+1}</td>\n                        <td>{row.Medicine}</td>\n                        <td>{row.Batch}</td>\n                        <td>{row.Qty}</td>\n                        <td>\n                          {row.Decision && row.Decision.includes('Existing medicine + existing batch') && '🟢 '}\n                          {row.Decision && row.Decision.includes('Existing medicine + new batch') && '🔵 '}\n                          {row.Decision && row.Decision.includes('New medicine + new batch') && '🆕 '}\n                          {row.Decision}\n                        </td>\n                      </tr>\n                    ))}\n                  </tbody>\n                </table>\n                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>\n                  <button onClick={handleConfirmImport} style={{ padding: '0.7rem 1.5rem', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Confirm Import</button>\n                </div>\n              </div>\n            )}\n            {importResults && (\n              <div style={{ padding: '2rem', textAlign: 'center' }}>\n                <h3 style={{ color: '#10b981' }}>Import Successful!</h3>\n                <p>{importResults.message || 'Records imported.'}</p>\n                <button onClick={closeImportModal} style={{ padding: '0.5rem 1rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', marginTop: '1rem' }}>Close</button>\n              </div>\n            )}\n          </div>\n        </div>\n      )}\n`;
content = content.replace(
  "{isModalOpen && (",
  importModalJSX + "\n      {isModalOpen && ("
);

fs.writeFileSync(file, content, 'utf8');
console.log('Modified Drugs.jsx');
