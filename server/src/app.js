const express = require('express');
const cors = require('cors');
require('dotenv').config();

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

const app = express();
const PORT = process.env.PORT || 5000;
// Build CORS options from env; allow frontend URL and onrender subdomains
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

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Audit middleware — injects req.auditLog() on every request
const { auditMiddleware } = require('./middleware/auditMiddleware');
app.use(auditMiddleware);


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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Pharmacy Management System API', version: '1.0.0', time: new Date() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Global express error handler:", err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

async function startServer() {
  await db.initializeDB();
  await seedData();

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
