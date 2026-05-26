// routes/license.js
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { getDB } = require('../db');

// ── Helper: validate daily-rotating admin key ─────────────────────────────
// Frontend generates:  btoa('NobelKirui' + YYYY-MM-DD)
// Accepts today AND yesterday (handles timezone edge cases)
function isValidAdminKey(key) {
  if (!key) return false;
  const make = (d) => Buffer.from('NobelKirui' + d).toString('base64');
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return key === make(today) || key === make(yesterday);
}

// ── GET /health ───────────────────────────────────────────────────────────
// Lightweight ping used by the frontend keep-alive to prevent Render cold-start
router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── POST /verify ─────────────────────────────────────────────────────────
// Called by frontend on login and every 30 min to check subscription status
router.post('/verify', (req, res) => {
  try {
    const { schoolId } = req.body;
    if (!schoolId) return res.status(400).json({ error: 'schoolId required' });

    const db = getDB();
    const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);

    if (!school) {
      return res.json({ status: 'not_registered', message: 'School not registered' });
    }

    const now    = new Date();
    const nowISO = now.toISOString();

    if (school.subscription_status === 'active' && school.subscription_expiry > nowISO) {
      const daysLeft = Math.ceil(
        (new Date(school.subscription_expiry) - now) / (1000 * 60 * 60 * 24)
      );
      return res.json({
        status:     'active',
        expires:    school.subscription_expiry,
        daysLeft:   daysLeft,
        schoolName: school.name
      });
    }

    if (school.subscription_status === 'active' && school.subscription_expiry <= nowISO) {
      db.prepare("UPDATE schools SET subscription_status = 'expired', updated_at = ? WHERE id = ?")
        .run(nowISO, schoolId);
      return res.json({ status: 'expired', expires: school.subscription_expiry, daysLeft: 0 });
    }

    return res.json({ status: school.subscription_status || 'inactive', expires: null });

  } catch (err) {
    console.error('[/verify error]', err.message);
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// ── POST /register ────────────────────────────────────────────────────────
// Called once after a school creates an account in the frontend.
// NO trial — school starts as 'inactive' and must pay to access.
router.post('/register', (req, res) => {
  try {
    const { schoolId, schoolName, email } = req.body;
    if (!schoolId || !schoolName) {
      return res.status(400).json({ error: 'schoolId and schoolName are required' });
    }

    const db = getDB();
    const exists = db.prepare('SELECT id, subscription_status FROM schools WHERE id = ?').get(schoolId);

    if (exists) {
      return res.json({ message: 'Already registered', status: exists.subscription_status });
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO schools (id, name, email, subscription_status, subscription_expiry, created_at, updated_at)
      VALUES (?, ?, ?, 'inactive', NULL, ?, ?)
    `).run(schoolId, schoolName, email || '', now, now);

    console.log(`[REGISTER] New school: ${schoolName} (${schoolId})`);

    return res.json({
      status:          'inactive',
      requiresPayment: true,
      message:         'Registered. Please subscribe to activate access.'
    });

  } catch (err) {
    console.error('[/register error]', err.message);
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// ── POST /paylink ─────────────────────────────────────────────────────────
// Generates a Paystack checkout URL and returns it to the frontend
router.post('/paylink', (req, res) => {
  try {
    const { schoolId, plan, email } = req.body;
    if (!schoolId || !plan || !email) {
      return res.status(400).json({ error: 'schoolId, plan, and email are required' });
    }

    // Pricing in KES
    const amount    = plan === 'annual' ? 8000 : 3000;
    const reference = `EDU-${schoolId}-${Date.now()}`;

    const payload = {
      email,
      amount:   amount * 100,   // Paystack uses smallest currency unit
      currency: 'KES',
      reference,
      metadata: {
        school_id: schoolId,
        plan,
        custom_fields: [
          { display_name: 'School ID', variable_name: 'school_id', value: schoolId },
          { display_name: 'Plan',      variable_name: 'plan',      value: plan     }
        ]
      },
      callback_url: process.env.FRONTEND_URL || 'https://lustrous-panda-6c1a79.netlify.app/'
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
        console.error('[Paystack error]', err.response?.data || err.message);
        res.status(500).json({ error: err.response?.data?.message || err.message });
      });

  } catch (err) {
    console.error('[/paylink error]', err.message);
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// ── POST /admin/activate ──────────────────────────────────────────────────
// Called from the admin panel to manually activate or extend a subscription.
// Protected by daily-rotating admin key.
router.post('/admin/activate', (req, res) => {
  try {
    const { schoolId, months, adminKey, paymentRef } = req.body;

    if (!isValidAdminKey(adminKey)) {
      console.warn('[ADMIN] Invalid admin key from IP:', req.ip);
      return res.status(403).json({
        error: 'Invalid or expired admin key. Generate a new one in your browser console: btoa("NobelKirui" + new Date().toISOString().slice(0,10))'
      });
    }

    if (!schoolId || !months) {
      return res.status(400).json({ error: 'schoolId and months are required' });
    }

    const db     = getDB();
    const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);

    if (!school) {
      return res.status(404).json({
        error: 'School not found. The school must login to the timetable app at least once before you can activate.'
      });
    }

    const now      = new Date();
    const nowISO   = now.toISOString();
    let   baseDate = now;

    // If already active and not yet expired, extend from current expiry date
    if (
      school.subscription_status === 'active' &&
      school.subscription_expiry &&
      new Date(school.subscription_expiry) > now
    ) {
      baseDate = new Date(school.subscription_expiry);
    }

    const expiry = new Date(baseDate);
    expiry.setMonth(expiry.getMonth() + parseInt(months));

    db.prepare(`
      UPDATE schools
      SET subscription_status  = 'active',
          subscription_expiry  = ?,
          payment_reference    = ?,
          updated_at           = ?
      WHERE id = ?
    `).run(expiry.toISOString(), paymentRef || 'MANUAL-ADMIN', nowISO, schoolId);

    // Log the payment reference
    try {
      db.prepare(`
        INSERT INTO payments (id, school_id, amount, reference, plan, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'manual', ?)
      `).run(
        `manual-${Date.now()}`, schoolId,
        months === 12 ? 800000 : months === 6 ? 500000 : 300000,
        paymentRef || 'MANUAL-ADMIN',
        months >= 12 ? 'annual' : 'termly',
        nowISO
      );
    } catch(e) { /* duplicate reference — ignore */ }

    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

    console.log(`[ADMIN ACTIVATE] ${school.name} (${schoolId}) | ${months} months | Ref: ${paymentRef || 'MANUAL'} | Expires: ${expiry.toISOString()}`);

    return res.json({
      success:    true,
      schoolId,
      schoolName: school.name,
      months:     parseInt(months),
      paymentRef: paymentRef || 'MANUAL-ADMIN',
      expires:    expiry.toISOString(),
      daysLeft,
      message:    `Subscription activated for ${months} month(s)`
    });

  } catch (err) {
    console.error('[/admin/activate error]', err.message);
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// ── GET /admin/schools ────────────────────────────────────────────────────
// Returns all registered schools (for admin dashboard)
router.get('/admin/schools', (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.query.adminKey;
    if (!isValidAdminKey(adminKey)) {
      return res.status(403).json({ error: 'Invalid admin key' });
    }

    const db      = getDB();
    const schools = db.prepare('SELECT id, name, email, subscription_status, subscription_expiry, created_at FROM schools ORDER BY created_at DESC').all();
    const now     = new Date().toISOString();

    const result = schools.map(s => ({
      ...s,
      daysLeft: s.subscription_expiry
        ? Math.max(0, Math.ceil((new Date(s.subscription_expiry) - new Date()) / 86400000))
        : null
    }));

    return res.json({ schools: result, count: result.length });

  } catch (err) {
    console.error('[/admin/schools error]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
