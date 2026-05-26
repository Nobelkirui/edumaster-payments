const express  = require('express');
const cors     = require('cors');
const dotenv   = require('dotenv');
const { initDB } = require('./db');

dotenv.config();

const app = express();

// CORS — allow your Netlify frontend
app.use(cors({
  origin: ['https://lustrous-panda-6c1a79.netlify.app', 'http://localhost:3000', 'http://localhost:5000'],
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-paystack-signature']
}));

// IMPORTANT: raw body for Paystack webhook signature verification
// Must be registered BEFORE express.json()
app.use('/api/webhook/paystack', express.raw({ type: 'application/json' }));

// JSON body parser for all other routes
app.use(express.json());

// Health check — keeps Render free tier warm (pinged every 10 min by frontend)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Routes
app.use('/api/license', require('./routes/license'));
app.use('/api/webhook', require('./routes/webhook'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler — always returns JSON, never HTML
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

const PORT = process.env.PORT || 5000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`EduMaster License Server running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});
