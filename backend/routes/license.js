const express = require('express');
const router = express.Router();
const axios = require('axios');
const { db } = require('../db');

// Verify license / subscription status
router.post('/verify', (req, res) => {
  const { schoolId } = req.body;
  if (!schoolId) return res.status(400).json({ error: 'schoolId required' });

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
  if (!school) {
    return res.json({ status: 'not_registered', message: 'Please register first' });
  }

  const now = new Date().toISOString();
  if (school.subscription_status === 'active' && school.subscription_expiry > now) {
    return res.json({ status: 'active', expires: school.subscription_expiry });
  } else if (school.subscription_status === 'active' && school.subscription_expiry <= now) {
    db.prepare('UPDATE schools SET subscription_status = ? WHERE id = ?').run('expired', schoolId);
    return res.json({ status: 'expired', expires: school.subscription_expiry });
  } else {
    return res.json({ status: 'inactive', expires: null });
  }
});

// Register a new school (called after school registration in frontend)
router.post('/register', (req, res) => {
  const { schoolId, schoolName, email } = req.body;
  if (!schoolId || !schoolName) return res.status(400).json({ error: 'Missing fields' });

  const exists = db.prepare('SELECT id FROM schools WHERE id = ?').get(schoolId);
  if (exists) return res.json({ message: 'Already registered', status: exists.subscription_status });

  db.prepare('INSERT INTO schools (id, name, email, subscription_status) VALUES (?, ?, ?, ?)').run(schoolId, schoolName, email, 'inactive');
  return res.json({ message: 'School registered successfully', status: 'inactive' });
});

// Create a Paystack payment link (return URL for redirect)
router.post('/paylink', (req, res) => {
  const { schoolId, plan, email } = req.body;
  const amount = plan === 'annual' ? 8000 : 3000;
  const reference = `EDU-${schoolId}-${Date.now()}`;

  const payload = {
    email,
    amount: amount * 1000,
    currency: 'KES',
    reference,
    metadata: { school_id: schoolId, plan },
    callback_url: `https://your-frontend-url.com/payment-success.html`  // optional
  };

  axios.post('https://api.paystack.co/transaction/initialize', payload, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
  }).then(response => {
    res.json({ authorization_url: response.data.data.authorization_url, reference });
  }).catch(err => res.status(500).json({ error: err.message }));
});

module.exports = router;
