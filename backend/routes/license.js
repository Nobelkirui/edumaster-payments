const express = require("express");
const router = express.Router();
const axios = require("axios");
const { db } = require("../db");

// Verify license / subscription status
router.post("/verify", (req, res) => {
  const { schoolId } = req.body;
  if (!schoolId) return res.status(400).json({ error: "schoolId required" });

  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
  if (!school) {
    return res.json({
      status: "not_registered",
      message: "Please register first",
    });
  }

  // If the school is registered and active, always return active (no expiry check)
  if (school.subscription_status === "active") {
    return res.json({ status: "active", expires: school.subscription_expiry || null });
  }

  return res.json({ status: school.subscription_status || "inactive", expires: null });
});

// Register a new school — activates subscription immediately
router.post("/register", (req, res) => {
  const { schoolId, schoolName, email } = req.body;
  if (!schoolId || !schoolName)
    return res.status(400).json({ error: "Missing fields" });

  const exists = db
    .prepare("SELECT id, subscription_status FROM schools WHERE id = ?")
    .get(schoolId);

  if (exists) {
    return res.json({
      message: "Already registered",
      status: exists.subscription_status,
    });
  }

  // Insert with subscription_status = "active" immediately — no trial period
  db.prepare(
    "INSERT INTO schools (id, name, email, subscription_status) VALUES (?, ?, ?, ?)"
  ).run(schoolId, schoolName, email || "", "active");

  return res.json({
    message: "School registered successfully",
    status: "active",
  });
});

// Create a Paystack payment link (return URL for redirect)
router.post("/paylink", (req, res) => {
  const { schoolId, plan, email } = req.body;
  const amount = plan === "annual" ? 8000 : 3000;
  const reference = `EDU-${schoolId}-${Date.now()}`;

  const payload = {
    email,
    amount: amount * 100,
    currency: "KES",
    reference,
    metadata: { school_id: schoolId, plan },
    callback_url: `https://lustrous-panda-6c1a79.netlify.app//payment-success.html`,
  };

  axios
    .post("https://api.paystack.co/transaction/initialize", payload, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    })
    .then((response) => {
      // After successful payment, update the school's subscription status
      db.prepare(
        "UPDATE schools SET subscription_status = ?, subscription_expiry = ? WHERE id = ?"
      ).run(
        "active",
        new Date(Date.now() + (plan === "annual" ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString(),
        schoolId
      );

      res.json({
        authorization_url: response.data.data.authorization_url,
        reference,
      });
    })
    .catch((err) => res.status(500).json({ error: err.message }));
});

module.exports = router;
