// db.js — uses better-sqlite3 (synchronous, fast, no async needed)
// This fixes the mismatch between sql.js (async) and better-sqlite3 (sync) APIs

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH  = path.join(DATA_DIR, 'edumaster.db');

let db = null;

function initDB() {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS schools (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      email               TEXT,
      subscription_status TEXT DEFAULT 'inactive',
      subscription_expiry TEXT,
      payment_reference   TEXT,
      updated_at          TEXT,
      created_at          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id          TEXT PRIMARY KEY,
      school_id   TEXT NOT NULL,
      amount      INTEGER,
      reference   TEXT UNIQUE,
      plan        TEXT,
      status      TEXT DEFAULT 'success',
      created_at  TEXT NOT NULL,
      FOREIGN KEY (school_id) REFERENCES schools(id)
    );
  `);

  console.log('Database initialised at', DB_PATH);
  return Promise.resolve(); // keep async interface for server.js
}

// Export db accessor — used by routes
function getDB() {
  if(!db) throw new Error('Database not initialised. Call initDB() first.');
  return db;
}

module.exports = { initDB, getDB };
