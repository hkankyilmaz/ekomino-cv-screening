// Results table — the local equivalent of the "CV Results" Google Sheets tab in the project brief.
// Uses Node.js's built-in SQLite module, so nothing extra has to be installed.
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(path.join(DATA_DIR, "cv"), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "ekomino.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS candidates (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name            TEXT NOT NULL,
    source               TEXT NOT NULL DEFAULT 'web',      -- web | folder
    uploaded_at          TEXT NOT NULL,
    processed_at         TEXT,                             -- when n8n wrote the result
    processing_ms        INTEGER,                          -- hand-off to n8n → result written
    candidate            TEXT,
    email                TEXT,
    score                INTEGER,
    education            INTEGER,
    technical            INTEGER,
    experience           INTEGER,
    language             INTEGER,
    projects             INTEGER,
    strengths            TEXT,
    gaps                 TEXT,
    decision             TEXT NOT NULL DEFAULT 'processing',
    interview_questions  TEXT,
    mail_subject         TEXT,
    mail_body            TEXT,
    approval_status      TEXT,                             -- Pending | Approved | Rejected | Timed out | NULL
    mail_status          TEXT,                             -- Draft created | Sent | Not sent
    mail_sent_at         TEXT,
    mail_recipient       TEXT,
    decided_at           TEXT,
    resume_url           TEXT,
    n8n_execution_id     TEXT,
    error                TEXT
  );

  -- Values the HR user changed on the Performance page (override the .env defaults)
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_alerts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    source     TEXT NOT NULL,
    message    TEXT NOT NULL
  );
`);

const FIELDS = [
  "file_name", "source", "uploaded_at", "processed_at", "processing_ms", "candidate", "email",
  "score", "education", "technical", "experience", "language", "projects", "strengths", "gaps",
  "decision", "interview_questions", "mail_subject", "mail_body", "approval_status", "mail_status",
  "mail_sent_at", "mail_recipient", "decided_at", "resume_url", "n8n_execution_id", "error",
];

const now = () => new Date().toISOString();

function addCandidate(fileName, source) {
  const r = db
    .prepare("INSERT INTO candidates (file_name, source, uploaded_at) VALUES (?, ?, ?)")
    .run(fileName, source, now());
  return Number(r.lastInsertRowid);
}

function updateCandidate(id, values) {
  const keys = Object.keys(values).filter((k) => FIELDS.includes(k));
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const params = keys.map((k) => (values[k] === undefined ? null : values[k]));
  db.prepare(`UPDATE candidates SET ${set} WHERE id = ?`).run(...params, id);
}

const getCandidate = (id) => db.prepare("SELECT * FROM candidates WHERE id = ?").get(id);
const listCandidates = () => db.prepare("SELECT * FROM candidates ORDER BY id DESC").all();

function addAlert(source, message) {
  db.prepare("INSERT INTO system_alerts (created_at, source, message) VALUES (?, ?, ?)").run(
    now(),
    source,
    String(message).slice(0, 2000)
  );
}

const listAlerts = (limit = 20) =>
  db.prepare("SELECT * FROM system_alerts ORDER BY id DESC LIMIT ?").all(limit);

function getSettings() {
  const out = {};
  for (const r of db.prepare("SELECT key, value FROM settings").all()) out[r.key] = r.value;
  return out;
}

function saveSettings(values) {
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  for (const [k, v] of Object.entries(values)) stmt.run(k, v);
}

function resetSettings() {
  db.exec("DELETE FROM settings;");
}

function clearAll() {
  // IDs keep counting up (sqlite_sequence is kept), so a late n8n callback for an old run can
  // never land on a new candidate that happens to get the same number.
  db.exec("DELETE FROM candidates; DELETE FROM system_alerts;");
}

module.exports = {
  DATA_DIR,
  now,
  addCandidate,
  updateCandidate,
  getCandidate,
  listCandidates,
  addAlert,
  listAlerts,
  getSettings,
  saveSettings,
  resetSettings,
  clearAll,
};
