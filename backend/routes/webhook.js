const express = require('express');
const router = express.Router();
const { db } = require('../db');
const crypto = require('crypto');

router.post('/paystack', (req, res) => {
  const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(JSON.stringify(req.body)).digest('hex');
  if (hash !== req.headers['x-paystack-signature']) return res.status(401).send('Unauthorized');

  const event = req.body;
  if (event.event === 'charge.success') {
    const { reference, metadata, amount } = event.data;
    const schoolId = metadata.school_id;
    const plan = metadata.plan; // 'termly' or 'annual'

    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + (plan === 'annual' ? 12 : 4));

    db.prepare(`UPDATE schools SET subscription_status = 'active', subscription_expiry = ? WHERE id = ?`)
      .run(expiry.toISOString(), schoolId);

    db.prepare(`INSERT INTO payments (id, school_id, amount, reference, status, created_at)
                VALUES (?, ?, ?, ?, 'success', ?)`)
      .run(crypto.randomUUID(), schoolId, amount, reference, new Date().toISOString());
  }
  res.sendStatus(200);
});

module.exports = router;
