const express = require('express');
const router = express.Router();
const axios = require('axios');
const { db } = require('../db');

// ─────────────────────────────────────────────────────────
// Helper: validate admin key (daily-rotating token)
// Token = btoa('NobelKirui' + YYYY-MM-DD)
// Accepts today's and yesterday's token to handle timezones
// ─────────────────────────────────────────────────────────
function isValidAdminKey(key) {
  if (!key) return false;
  const makeToken = (dateStr) => Buffer.from('NobelKirui' + dateStr).toString('base64');
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return key === makeToken(today) || key === makeToken(yesterday);
}

// ─────────────────────────────────────────────────────────
// POST /api/license/verify
// Called by frontend on every login and every 30 min
// Returns subscription status and expiry date
// ─────────────────────────────────────────────────────────
router.post('/verify', (req, res) => {
  const { schoolId } = req.body;
  if (!schoolId) return res.status(400).json({ error: 'schoolId required' });

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
  if (!school) {
    return res.json({ status: 'not_registered', message: 'School not registered' });
  }

  const now = new Date().toISOString();

  if (school.subscription_status === 'active' && school.subscription_expiry > now) {
    // Calculate days remaining for frontend display
    const daysLeft = Math.ceil(
      (new Date(school.subscription_expiry) - new Date()) / (1000 * 60 * 60 * 24)
    );
    return res.json({
      status: 'active',
      expires: school.subscription_expiry,
      daysLeft,
      schoolName: school.name
    });
  }

  if (school.subscription_status === 'active' && school.subscription_expiry <= now) {
    // Mark as expired
    db.prepare('UPDATE schools SET subscription_status = ? WHERE id = ?')
      .run('expired', schoolId);
    return res.json({
      status: 'expired',
      expires: school.subscription_expiry,
      daysLeft: 0,
      message: 'Subscription has expired. Please renew.'
    });
  }

  // inactive, expired, or any other status
  return res.json({
    status: school.subscription_status || 'inactive',
    expires: null,
    daysLeft: null
  });
});

// ─────────────────────────────────────────────────────────
// POST /api/license/register
// Called once after school creates account.
// NO trial - school starts as 'inactive' and must pay.
// ─────────────────────────────────────────────────────────
router.post('/register', (req, res) => {
  const { schoolId, schoolName, email } = req.body;
  if (!schoolId || !schoolName) {
    return res.status(400).json({ error: 'schoolId and schoolName are required' });
  }

  const exists = db.prepare('SELECT id, subscription_status FROM schools WHERE id = ?').get(schoolId);
  if (exists) {
    return res.json({
      message: 'Already registered',
      status: exists.subscription_status
    });
  }

  // Register with inactive status - billing starts immediately on payment
  db.prepare(`
    INSERT INTO schools (id, name, email, subscription_status, subscription_expiry, created_at)
    VALUES (?, ?, ?, 'inactive', NULL, ?)
  `).run(schoolId, schoolName, email || '', new Date().toISOString());

  return res.json({
    message: 'School registered. Please subscribe to activate access.',
    status: 'inactive',
    requiresPayment: true
  });
});

// ─────────────────────────────────────────────────────────
// POST /api/license/paylink
// Generates a Paystack payment URL for the school
// ─────────────────────────────────────────────────────────
router.post('/paylink', (req, res) => {
  const { schoolId, plan, email } = req.body;
  if (!schoolId || !plan || !email) {
    return res.status(400).json({ error: 'schoolId, plan, and email are required' });
  }

  // Pricing: termly = 3,000 KES | annual = 8,000 KES
  const amount = plan === 'annual' ? 8000 : 3000;
  const reference = `EDU-${schoolId}-${Date.now()}`;

  const payload = {
    email,
    amount: amount * 100, // Paystack uses kobo/cents
    currency: 'KES',
    reference,
    metadata: {
      school_id: schoolId,
      plan,
      custom_fields: [
        { display_name: 'School ID', variable_name: 'school_id', value: schoolId },
        { display_name: 'Plan', variable_name: 'plan', value: plan }
      ]
    },
    callback_url: process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/payment-success.html`
      : 'https://lustrous-panda-6c1a79.netlify.app/payment-success.html'
  };

  axios.post('https://api.paystack.co/transaction/initialize', payload, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
  })
    .then(response => {
      res.json({
        authorization_url: response.data.data.authorization_url,
        reference,
        amount,
        plan
      });
    })
    .catch(err => {
      console.error('Paystack error:', err.response?.data || err.message);
      res.status(500).json({ error: err.response?.data?.message || err.message });
    });
});

// ─────────────────────────────────────────────────────────
// POST /api/license/admin/activate
// Called from admin panel to manually activate a subscription
// Secured with daily-rotating admin key
// ─────────────────────────────────────────────────────────
router.post('/admin/activate', (req, res) => {
  const { schoolId, months, adminKey, paymentRef } = req.body;

  // Validate rotating admin key
  if (!isValidAdminKey(adminKey)) {
    return res.status(403).json({ error: 'Invalid or expired admin key' });
  }

  if (!schoolId || !months) {
    return res.status(400).json({ error: 'schoolId and months are required' });
  }

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
  if (!school) {
    return res.status(404).json({ error: 'School not found. Ask school to login first.' });
  }

  // Calculate expiry: if currently active and not expired, extend from current expiry
  // Otherwise, start from today
  const now = new Date();
  let baseDate = now;
  if (
    school.subscription_status === 'active' &&
    school.subscription_expiry &&
    new Date(school.subscription_expiry) > now
  ) {
    baseDate = new Date(school.subscription_expiry); // extend from current expiry
  }

  const expiry = new Date(baseDate);
  expiry.setMonth(expiry.getMonth() + parseInt(months));

  db.prepare(`
    UPDATE schools
    SET subscription_status = 'active',
        subscription_expiry = ?,
        payment_reference = ?,
        updated_at = ?
    WHERE id = ?
  `).run(expiry.toISOString(), paymentRef || 'MANUAL-ADMIN', now.toISOString(), schoolId);

  // Log the activation
  console.log(`[ADMIN ACTIVATE] School: ${schoolId} | Months: ${months} | Ref: ${paymentRef || 'MANUAL'} | Expires: ${expiry.toISOString()}`);

  return res.json({
    success: true,
    schoolId,
    schoolName: school.name,
    months: parseInt(months),
    paymentRef: paymentRef || 'MANUAL',
    expires: expiry.toISOString(),
    message: `Subscription activated for ${months} month(s)`
  });
});

// ─────────────────────────────────────────────────────────
// POST /api/license/webhook (Paystack webhook - auto-activate)
// This endpoint auto-activates when Paystack confirms payment
// Set this URL in your Paystack dashboard under Webhooks
// ─────────────────────────────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  // Verify Paystack signature
  const crypto = require('crypto');
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.body)
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(req.body);

  if (event.event === 'charge.success') {
    const { reference, metadata } = event.data;
    const schoolId = metadata?.school_id;
    const plan = metadata?.plan || 'termly';
    const months = plan === 'annual' ? 12 : 3;

    if (schoolId) {
      const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
      const now = new Date();
      let baseDate = now;

      if (
        school?.subscription_status === 'active' &&
        school?.subscription_expiry &&
        new Date(school.subscription_expiry) > now
      ) {
        baseDate = new Date(school.subscription_expiry);
      }

      const expiry = new Date(baseDate);
      expiry.setMonth(expiry.getMonth() + months);

      db.prepare(`
        UPDATE schools
        SET subscription_status = 'active',
            subscription_expiry = ?,
            payment_reference = ?,
            updated_at = ?
        WHERE id = ?
      `).run(expiry.toISOString(), reference, now.toISOString(), schoolId);

      console.log(`[WEBHOOK] Auto-activated: ${schoolId} | Plan: ${plan} | Ref: ${reference} | Expires: ${expiry.toISOString()}`);
    }
  }

  res.json({ received: true });
});

module.exports = router;
