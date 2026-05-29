'use strict';

const express = require('express');
const cors    = require('cors');
const dotenv  = require('dotenv');
const { initDB } = require('./db');

dotenv.config();

const app = express();

// Allow all origins (frontend on Netlify + local dev)
app.use(cors());

// Raw body for Paystack webhook — MUST come before express.json()
app.use('/api/webhook/paystack', express.raw({ type: 'application/json' }));

// JSON parser for all other routes
app.use(express.json());

// Health check — frontend pings this every 10 min to keep Render awake
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Routes
app.use('/api/license', require('./routes/license'));
app.use('/api/webhook', require('./routes/webhook'));

// 404 — always JSON, never HTML
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Global error handler — always JSON, never HTML
// Critical: without this, Express returns an HTML error page which
// breaks frontend JSON.parse() and causes "SyntaxError: Unexpected token <"
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Server error', message: err.message });
});

const PORT = process.env.PORT || 5000;

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[SERVER] EduMaster running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[FATAL] DB init failed:', err.message);
    process.exit(1);
  });


