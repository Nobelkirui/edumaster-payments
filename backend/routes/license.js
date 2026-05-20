// Admin activation endpoint (protect with a hardcoded key)
router.post('/admin/activate', (req, res) => {
  const { schoolId, months, key } = req.body;
  // Replace with your own secret key (keep it safe)
  if (key !== 'YOUR_SUPER_SECRET_KEY_2025') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!schoolId || !months) {
    return res.status(400).json({ error: 'Missing schoolId or months' });
  }
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + parseInt(months));
  try {
    db.run(
      `UPDATE schools SET subscription_status = 'active', subscription_expiry = ? WHERE id = ?`,
      [expiry.toISOString(), schoolId]
    );
    res.json({ success: true, expires: expiry.toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
