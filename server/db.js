const Database = require('better-sqlite3');
const path = require('path');
const cron = require('node-cron');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'tracker.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create schema
db.exec(`
  CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    sender_email TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS opens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    opened_at TEXT NOT NULL,
    user_agent TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_emails_sent_at ON emails(sent_at);
  CREATE INDEX IF NOT EXISTS idx_opens_email_id ON opens(email_id);
`);

// Auto-delete emails older than RETENTION_DAYS (default 7)
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '7', 10);

function deleteOldEmails() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const result = db.prepare(
    `DELETE FROM emails WHERE sent_at < ?`
  ).run(cutoff.toISOString());
  if (result.changes > 0) {
    console.log(`[cron] Deleted ${result.changes} emails older than ${RETENTION_DAYS} days`);
  }
}

// Run daily at midnight
cron.schedule('0 0 * * *', deleteOldEmails);
// Also run once on startup to clean up stale data immediately
deleteOldEmails();

// --- Query helpers ---

const insertEmail = db.prepare(`
  INSERT OR IGNORE INTO emails (id, recipient, subject, sent_at, sender_email)
  VALUES (@id, @recipient, @subject, @sent_at, @sender_email)
`);

const insertOpen = db.prepare(`
  INSERT INTO opens (email_id, opened_at, user_agent)
  VALUES (@email_id, @opened_at, @user_agent)
`);

const getEmails = db.prepare(`
  SELECT 
    e.id, e.recipient, e.subject, e.sent_at, e.sender_email,
    COUNT(o.id) AS open_count,
    MAX(o.opened_at) AS last_opened_at
  FROM emails e
  LEFT JOIN opens o ON o.email_id = e.id
  GROUP BY e.id
  ORDER BY e.sent_at DESC
`);

const getOpensForEmail = db.prepare(`
  SELECT opened_at, user_agent FROM opens
  WHERE email_id = ?
  ORDER BY opened_at DESC
`);

const getEmail = db.prepare(`SELECT * FROM emails WHERE id = ?`);

module.exports = {
  db,
  insertEmail,
  insertOpen,
  getEmails,
  getOpensForEmail,
  getEmail,
};
