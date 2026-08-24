# Pharmacy Inventory

Full-stack pharmacy inventory and POS application (React frontend + Express backend).

Repository layout
- `client/` — React + Vite frontend (UI components, pages, assets).
- `server/` — Express API, Socket.IO, PostgreSQL access, and services.

Important developer scripts
- `client/scripts/` — generator and patch scripts that update `client/src/pages/*` (moved here):
	- `generate_inventory.js` — generates `client/src/pages/Inventory.jsx`.
	- `generate_pos.js` — generates `client/src/pages/POS.jsx`.
	- `modify_drugs.js` — patch script that updates `client/src/pages/Drugs.jsx`.
	- `modify_reports.js` — patch script that updates `client/src/pages/Reports.jsx`.
- `server/scripts/` — server-side helpers:
	- `test_db.js` — small DB helper to exercise the DB connection / insert sample audit log.

If you don't need these one-time dev scripts, you can remove them. They are not required at runtime.

Requirements
- Node.js 16+ (recommended)
- npm
- PostgreSQL (or Supabase)

Local development (recommended)
1. Install dependencies for both projects from repository root:

```bash
cd client
npm install
cd ../server
npm install
```

2. Create environment files
- Copy `server/.env.example` → `server/.env` and set `DATABASE_URL` and other values.
- Create `.env` values for `client` if you use `VITE_API_URL` locally.

3. Start the server and client in separate terminals

Server:
```bash
cd server
npm run dev
```

Client:
```bash
cd client
npm run dev
```

Open the client in your browser (Vite will show the local URL, typically `http://localhost:5173`).

Database
- The server will create necessary tables and seed data on first run if configured to do so. Use a PostgreSQL database locally or a hosted Supabase instance and set `DATABASE_URL` in `server/.env`.

Developer scripts (how to run)
- Regenerate Inventory page (writes `client/src/pages/Inventory.jsx`):
	- `node client/scripts/generate_inventory.js`
- Regenerate POS page (writes `client/src/pages/POS.jsx`):
	- `node client/scripts/generate_pos.js`
- Apply patches to pages (these scripts modify client files in-place):
	- `node client/scripts/modify_drugs.js`
	- `node client/scripts/modify_reports.js`
- Test DB connection / insert audit log (server):
	- `node server/scripts/test_db.js` (ensure `server/.env` exists and PostgreSQL is reachable)

Features / Website functionality
- Authentication: login and role-based access (admin, pharmacist).
- Dashboard: summaries and KPIs.
- Drugs / Medicines: create, edit, import CSV, ABC/VEN classification, barcode/QR fields, reorder/max levels.
- Inventory: manage batches, add stock, physical counts, bin cards, movements history, low-stock 'What to Buy' list.
- POS: search/scan items, cart, prescription handling (frequency, duration, route), AI-based interaction checks, checkout and sales recording.
- Reports: sales, performance, and an Audit Log (user actions, CRUD events) with CSV export.
- Suppliers & Users management.
- Settings: app configuration, tax/pricing rules.
- Real-time updates via Socket.IO for live stock and POS events.

Notes and next steps
- I moved the five identified scripts into `client/scripts` and `server/scripts` to keep the repo organized. If you prefer a different location, tell me where and I will relocate them.
- Want me to run the moved scripts or start the dev servers here? I can run them if you want — say which commands to execute.

