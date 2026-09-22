const express = require('express');
const cors = require('cors');
require('dotenv').config();

// ---------------------------------------------------------------------------
// Security headers — thin re-implementation of helmet-style defaults so the
// project keeps a single express dependency. Every header below is a standard
// OWASP-recommended protection for a browser-facing pharmacy application.
// ---------------------------------------------------------------------------
const DEFAULT_SECURITY_HEADERS = {
  'X-DNS-Prefetch-Control': 'on',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=()',
  'X-XSS-Protection': '0', // modern browsers ignore this header; CSP is the fix
};

/** Convert a Node headers object into Express res.set(...) calls. */
function applySecurityHeaders(req, res, next) {
  const headers = {
    ...DEFAULT_SECURITY_HEADERS,
    'Content-Security-Policy': process.env.NODE_ENV === 'production'
      ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
      : "default-src 'self' http://localhost:*; script-src 'self' 'unsafe-inline' http://localhost:*; style-src 'self' 'unsafe-inline' http://localhost:*; img-src 'self' data: https: http:; font-src 'self' http:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self' http://localhost:*",
  };

  // Allow the health endpoint (no auth) to be health-checked by uptime monitors.
  // Everything else keeps a strict same-origin policy.
  for (const [key, value] of Object.entries(headers)) {
    res.set(key, value);
  }
  next();
}

const { seedData } = require('./seed');
const db = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const medicineRoutes = require('./routes/medicineRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const salesRoutes = require('./routes/salesRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const userRoutes = require('./routes/userRoutes');
const aiRoutes = require('./routes/aiRoutes');
const dataRoutes = require('./routes/dataRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const reportRoutes = require('./routes/reportRoutes');
const auditRoutes = require('./routes/auditRoutes');
const ddiRoutes = require('./routes/ddiRoutes');

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = (process.env.FRONTEND_URL || '').trim();
const allowedOrigins = new Set();
if (FRONTEND_URL) {
  try {
    const url = new URL(FRONTEND_URL);
    allowedOrigins.add(url.origin);
  } catch (e) {
    // allow literal entries like 'https://example.onrender.com'
    allowedOrigins.add(FRONTEND_URL);
  }
}
allowedOrigins.add('http://localhost:3000');
allowedOrigins.add('http://localhost:3001');
allowedOrigins.add('http://localhost:5173');

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow server-to-server or non-browser requests
    if (allowedOrigins.has(origin) || /\.onrender\.com$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
    credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
};

// Security headers — set on every response (no external dependency).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'"
  );
  res.setHeader('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  next();
});

// Middleware — enforce request size limits to prevent oversized payloads.
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Audit middleware — injects req.auditLog() on every request
const { auditMiddleware } = require('./middleware/auditMiddleware');
app.use(auditMiddleware);

// Rate limiting — protects every API route from abuse / bot floods.
const { apiLimiter } = require('./middleware/rateLimit');
app.use('/api', apiLimiter);

// Guest read-only enforcement — blocks ALL write requests made with a
// guest token, server-side, before any controller runs.
const { enforceGuestReadOnly } = require('./middleware/auth');
app.use(enforceGuestReadOnly);

/*
 * GLOBAL AUTHENTICATION GATE.
 *
 * Every /api route requires a valid JWT with an open server-side session,
 * EXCEPT the explicit public endpoints whitelisted below (login, guest
 * entry, health). This guarantees no data route can ever be mounted
 * without authentication by accident.
 */
const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/guest',
  '/api/health',
]);
const { authenticate } = require('./middleware/auth');
app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) return next();
  return authenticate(req, res, next);
});



// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/medicines', medicineRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/ddi', ddiRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Pharmacy Management System API', version: '1.0.0', time: new Date() });
});

// Error handling middleware — never leaks SQL / internal details in production
app.use((err, req, res, next) => {
  console.error("Global express error handler:", err);
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  res.status(err.status || 500).json({
    error: isProd ? 'Internal Server Error' : (err.message || 'Internal Server Error')
  });
});

async function startServer() {
  await db.initializeDB();
  const { startAuditArchiveScheduler } = require('./services/auditArchiveService');
  startAuditArchiveScheduler();
  await seedData();

  // Seed the local DDI fallback dataset (idempotent).
  const { ensureDdiSeeded } = require('./services/ddiService');
  await ensureDdiSeeded();

  const server = require('http').createServer(app);
  const io = require('./socket').init(server, corsOptions);
  
  io.on('connection', (socket) => {
    console.log('Client connected to socket.io');
    socket.on('disconnect', () => {
      console.log('Client disconnected');
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(` Pharm Server is UP →  http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}

startServer().catch((err) => {
  console.error('Unable to start server:', err.message);
  process.exit(1);
});
