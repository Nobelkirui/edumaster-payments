const express = require('express');
const router = express.Router();
const db = require('../db');
const axios = require('axios');

// Verify license / subscription status
router.post('/verify', async (req, res) => {
  const { schoolId } = req.body;
  if (!schoolId) return res.status(400).json({ error: 'schoolId required' });

  const school = db.get('SELECT * FROM schools WHERE id = ?', [schoolId]);
  if (!school) {
    return res.json({ status: 'not_registered', message: 'Please register first' });
  }

  const now = new Date().toISOString();
  if (school.subscription_status === 'active' && school.subscription_expiry > now) {
    return res.json({ status: 'active', expires: school.subscription_expiry });
  } else if (school.subscription_status === 'active' && school.subscription_expiry <= now) {
    db.run('UPDATE schools SET subscription_status = ? WHERE id = ?', ['expired', schoolId]);
    return res.json({ status: 'expired', expires: school.subscription_expiry });
  } else {
    return res.json({ status: 'inactive', expires: null });
  }
});

// Register a new school
router.post('/register', async (req, res) => {
  const { schoolId, schoolName, email } = req.body;
  if (!schoolId || !schoolName) return res.status(400).json({ error: 'Missing fields' });

  const exists = db.get('SELECT id FROM schools WHERE id = ?', [schoolId]);
  if (exists) return res.json({ message: 'Already registered', status: exists.subscription_status });

  const trialExpiry = new Date();
  trialExpiry.setDate(trialExpiry.getDate() + 14);
  db.run(
    `INSERT INTO schools (id, name, email, subscription_status, subscription_expiry, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [schoolId, schoolName, email, 'trial', trialExpiry.toISOString(), new Date().toISOString()]
  );

  res.json({ status: 'trial', expires: trialExpiry.toISOString() });
});

// Create Paystack payment link
router.post('/paylink', async (req, res) => {
  const { schoolId, plan, email } = req.body;
  const amount = plan === 'annual' ? 8000 : 3000;
  const reference = `EDU-${schoolId}-${Date.now()}`;

  try {
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: amount * 100,
        currency: 'KES',
        reference,
        metadata: { school_id: schoolId, plan },
      },
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      }
    );
    res.json({ authorization_url: response.data.data.authorization_url, reference });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
