'use strict';

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { get, run, all, _save } = require('../db');

// Admin key: btoa('NobelKirui' + YYYY-MM-DD)
// Accepts today and yesterday to handle timezone differences
function isValidAdminKey(key) {
  if (!key) return false;
  const make      = (d) => Buffer.from('NobelKirui' + d).toString('base64');
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return key === make(today) || key === make(yesterday);
}

// GET /api/license/health
router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// POST /api/license/verify
router.post('/verify', (req, res) => {
  try {
    const { schoolId } = req.body;
    if (!schoolId) return res.status(400).json({ error: 'schoolId required' });

    const school = get('SELECT * FROM schools WHERE id = ?', [schoolId]);
    if (!school) return res.json({ status: 'not_registered' });

    const now    = new Date();
    const nowISO = now.toISOString();

    if (school.subscription_status === 'active' && school.subscription_expiry > nowISO) {
      const daysLeft = Math.ceil(
        (new Date(school.subscription_expiry) - now) / (1000 * 60 * 60 * 24)
      );
      return res.json({
        status:     'active',
        expires:    school.subscription_expiry,
        daysLeft,
        schoolName: school.name
      });
    }

    if (school.subscription_status === 'active' && school.subscription_expiry <= nowISO) {
      run("UPDATE schools SET subscription_status='expired', updated_at=? WHERE id=?",
        [nowISO, schoolId]);
      return res.json({ status: 'expired', expires: school.subscription_expiry, daysLeft: 0 });
    }

    return res.json({ status: school.subscription_status || 'inactive', expires: null });

  } catch (err) {
    console.error('[/verify]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/license/register
router.post('/register', (req, res) => {
  try {
    const { schoolId, schoolName, email } = req.body;
    if (!schoolId || !schoolName) {
      return res.status(400).json({ error: 'schoolId and schoolName required' });
    }

    const exists = get('SELECT id, subscription_status FROM schools WHERE id=?', [schoolId]);
    if (exists) {
      return res.json({ message: 'Already registered', status: exists.subscription_status });
    }

    const now = new Date().toISOString();
    run(
      `INSERT INTO schools (id, name, email, subscription_status, created_at, updated_at)
       VALUES (?, ?, ?, 'inactive', ?, ?)`,
      [schoolId, schoolName, email || '', now, now]
    );

    console.log(`[REGISTER] ${schoolName} (${schoolId})`);
    return res.json({ status: 'inactive', requiresPayment: true });

  } catch (err) {
    console.error('[/register]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/license/paylink
router.post('/paylink', (req, res) => {
  try {
    const { schoolId, plan, email } = req.body;
    if (!schoolId || !plan || !email) {
      return res.status(400).json({ error: 'schoolId, plan and email required' });
    }

    const amount    = plan === 'annual' ? 8000 : 3000;
    const reference = `EDU-${schoolId}-${Date.now()}`;

    const payload = {
      email,
      amount:   amount * 100,
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
      .then(resp => {
        res.json({
          authorization_url: resp.data.data.authorization_url,
          reference,
          amount,
          plan
        });
      })
      .catch(err => {
        console.error('[/paylink Paystack]', err.response?.data || err.message);
        res.status(500).json({ error: err.response?.data?.message || err.message });
      });

  } catch (err) {
    console.error('[/paylink]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/license/admin/activate
router.post('/admin/activate', (req, res) => {
  try {
    const { schoolId, months, adminKey, paymentRef } = req.body;

    if (!isValidAdminKey(adminKey)) {
      console.warn('[ADMIN] Bad key from', req.ip);
      return res.status(403).json({
        error: 'Invalid or expired admin key. In browser console run: btoa("NobelKirui" + new Date().toISOString().slice(0,10))'
      });
    }

    if (!schoolId || !months) {
      return res.status(400).json({ error: 'schoolId and months required' });
    }

    const school = get('SELECT * FROM schools WHERE id=?', [schoolId]);
    if (!school) {
      return res.status(404).json({
        error: 'School not found. They must open and login to the timetable app first.'
      });
    }

    const now    = new Date();
    let baseDate = now;

    // Extend from current expiry if still active — never reset early
    if (
      school.subscription_status === 'active' &&
      school.subscription_expiry &&
      new Date(school.subscription_expiry) > now
    ) {
      baseDate = new Date(school.subscription_expiry);
    }

    const expiry = new Date(baseDate);
    expiry.setMonth(expiry.getMonth() + parseInt(months));

    run(
      `UPDATE schools
       SET subscription_status='active', subscription_expiry=?, payment_reference=?, updated_at=?
       WHERE id=?`,
      [expiry.toISOString(), paymentRef || 'MANUAL-ADMIN', now.toISOString(), schoolId]
    );

    // Log payment record
    try {
      run(
        `INSERT INTO payments (id, school_id, amount, reference, plan, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'manual', ?)`,
        [
          'manual-' + Date.now(),
          schoolId,
          parseInt(months) >= 12 ? 800000 : parseInt(months) >= 6 ? 500000 : 300000,
          paymentRef || ('MANUAL-' + Date.now()),
          parseInt(months) >= 12 ? 'annual' : 'termly',
          now.toISOString()
        ]
      );
    } catch (e) { /* ignore duplicate reference */ }

    const daysLeft = Math.ceil((expiry - now) / 86400000);
    console.log(`[ACTIVATE] ${school.name} | ${months}mo | Ref:${paymentRef || 'MANUAL'} | Exp:${expiry.toISOString()}`);

    return res.json({
      success:    true,
      schoolId,
      schoolName: school.name,
      months:     parseInt(months),
      paymentRef: paymentRef || 'MANUAL-ADMIN',
      expires:    expiry.toISOString(),
      daysLeft
    });

  } catch (err) {
    console.error('[/admin/activate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/license/admin/schools
router.get('/admin/schools', (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.query.adminKey;
    if (!isValidAdminKey(adminKey)) {
      return res.status(403).json({ error: 'Invalid admin key' });
    }

    const schools = all(
      'SELECT id, name, email, subscription_status, subscription_expiry, created_at FROM schools ORDER BY created_at DESC'
    );

    const now    = new Date();
    const result = schools.map(s => ({
      ...s,
      daysLeft: s.subscription_expiry
        ? Math.max(0, Math.ceil((new Date(s.subscription_expiry) - now) / 86400000))
        : null
    }));

    return res.json({ schools: result, count: result.length });

  } catch (err) {
    console.error('[/admin/schools]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;


