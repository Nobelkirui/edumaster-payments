const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const db = new Database(path.join(__dirname, 'data.db'));

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schools (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      subscription_status TEXT DEFAULT 'trial',
      subscription_expiry TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      school_id TEXT,
      amount INTEGER,
      reference TEXT UNIQUE,
      status TEXT,
      created_at TEXT
    );
  `);

  // Add a default trial record for a demo school (optional)
  const demoId = 'demo_school';
  const existing = db.prepare('SELECT id FROM schools WHERE id = ?').get(demoId);
  if (!existing) {
    const trialExpiry = new Date();
    trialExpiry.setDate(trialExpiry.getDate() + 14);
    db.prepare(`INSERT INTO schools (id, name, email, subscription_status, subscription_expiry, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`).run(demoId, 'Demo School', 'demo@example.com', 'trial', trialExpiry.toISOString(), new Date().toISOString());
  }
}

module.exports = { db, initDB };
