// server.js — EduMaster License Server entry point
'use strict';

const express  = require('express');
const cors     = require('cors');
const dotenv   = require('dotenv');
const { initDB } = require('./db');

dotenv.config();

const app = express();

// ── CORS: allow your Netlify frontend and local dev ───────────────────────
const allowedOrigins = [
  'https://lustrous-panda-6c1a79.netlify.app',
  'http://localhost:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5500'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (Postman, mobile apps, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    // Also allow any netlify.app subdomain
    if (/\.netlify\.app$/.test(origin)) return callback(null, true);
    callback(null, true); // Open for now — tighten after testing
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-paystack-signature', 'x-admin-key']
}));

// ── Raw body for Paystack webhook (MUST come before express.json) ─────────
app.use('/api/webhook/paystack', express.raw({ type: 'application/json' }));

// ── JSON body for all other routes ────────────────────────────────────────
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────
// Pinged every 10 min by the frontend to keep Render free tier from sleeping.
// When Render sleeps, it returns an HTML error page instead of JSON —
// this endpoint wakes it up before that happens.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────────────────────────────
app.use('/api/license', require('./routes/license'));
app.use('/api/webhook', require('./routes/webhook'));

// ── 404 handler — always returns JSON, never HTML ─────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

// ── Global error handler — always returns JSON, never HTML ────────────────
// This is critical: without this, Express returns an HTML error page on
// uncaught errors, which breaks the frontend's JSON.parse() call.
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ── Start server after database is ready ──────────────────────────────────
const PORT = process.env.PORT || 5000;

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[SERVER] EduMaster License Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[SERVER] Failed to initialise database:', err.message);
    process.exit(1);
  });
