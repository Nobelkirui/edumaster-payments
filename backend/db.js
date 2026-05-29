
'use strict';

const initSqlJs = require('sql.js');
const path = require('path');
const fs   = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH  = path.join(DATA_DIR, 'edumaster.db');

let db = null;

async function initDB() {
  // Create data directory if needed
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  // Load existing database file if it exists, otherwise create fresh
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('[DB] Loaded existing database from', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new database at', DB_PATH);
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS schools (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      email               TEXT DEFAULT '',
      subscription_status TEXT DEFAULT 'inactive',
      subscription_expiry TEXT,
      payment_reference   TEXT,
      updated_at          TEXT,
      created_at          TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id          TEXT PRIMARY KEY,
      school_id   TEXT NOT NULL,
      amount      INTEGER DEFAULT 0,
      reference   TEXT UNIQUE,
      plan        TEXT DEFAULT 'termly',
      status      TEXT DEFAULT 'success',
      created_at  TEXT NOT NULL
    );
  `);

  // Save to disk after every write
  _save();
  console.log('[DB] Tables ready');
}

// Save the in-memory database to disk
function _save() {
  if (!db) return;
  try {
    const data   = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (e) {
    console.error('[DB] Save error:', e.message);
  }
}

// getDB() — called by all routes
function getDB() {
  if (!db) throw new Error('Database not initialised. initDB() must complete first.');
  return db;
}

// ── sql.js helper wrappers ──────────────────────────────────────────────
// sql.js has a different API from better-sqlite3.
// These wrappers make the routes work the same way.

// Run a write query (INSERT, UPDATE, DELETE) and save to disk
function run(sql, params) {
  const stmt = db.prepare(sql);
  stmt.run(params || []);
  stmt.free();
  _save();
}

// Get a single row — returns a plain object or null
function get(sql, params) {
  const stmt    = db.prepare(sql);
  const results = [];
  stmt.bind(params || []);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results.length > 0 ? results[0] : null;
}

// Get all rows — returns array of plain objects
function all(sql, params) {
  const stmt    = db.prepare(sql);
  const results = [];
  stmt.bind(params || []);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

module.exports = { initDB, getDB, run, get, all, _save };
