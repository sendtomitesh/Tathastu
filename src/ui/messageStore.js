/**
 * SQLite-backed persistent message store for conversation history.
 * Keeps last MAX_MESSAGES_PER_TENANT messages per tenant (default = 'default' for single-tenant).
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const MAX_MESSAGES_PER_TENANT = 500;
const DEFAULT_TENANT_ID = 'default';

function getDbPath() {
  const envPath = process.env.MESSAGE_DB_PATH;
  if (envPath) return path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
  return path.join(process.cwd(), 'data', 'messages.db');
}

let db = null;

function init() {
  if (db) return;
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      is_audio INTEGER DEFAULT 0,
      original_lang TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_tenant_timestamp ON messages(tenant_id, timestamp);
  `);
}

function rowToMessage(row) {
  return {
    id: row.id,
    type: row.type,
    text: row.text,
    timestamp: row.timestamp,
    isAudio: Boolean(row.is_audio),
    originalLang: row.original_lang || null,
  };
}

/**
 * Load messages for one tenant (oldest first). Returns at most MAX_MESSAGES_PER_TENANT.
 * @param {string} tenantId - 'default' for single-tenant
 * @returns {Array<{ id, type, text, timestamp, isAudio?, originalLang? }>}
 */
function loadForTenant(tenantId = DEFAULT_TENANT_ID) {
  if (!db) init();
  const rows = db.prepare(
    `SELECT id, tenant_id, type, text, timestamp, is_audio, original_lang
     FROM messages WHERE tenant_id = ? ORDER BY timestamp ASC`
  ).all(tenantId);
  return rows.map(rowToMessage);
}

/**
 * Append one message and prune to keep last MAX_MESSAGES_PER_TENANT per tenant.
 * @param {string} tenantId
 * @param {object} message - { id, type, text, timestamp, isAudio?, originalLang? }
 */
function append(tenantId, message) {
  if (!db) init();
  const tenant = tenantId || DEFAULT_TENANT_ID;
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, tenant_id, type, text, timestamp, is_audio, original_lang)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    message.id,
    tenant,
    message.type || 'user',
    message.text || '',
    message.timestamp || Date.now(),
    message.isAudio ? 1 : 0,
    message.originalLang || null
  );
  // Keep only last MAX_MESSAGES_PER_TENANT per tenant (delete oldest)
  const count = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ?`).get(tenant);
  if (count.n > MAX_MESSAGES_PER_TENANT) {
    const cutoff = db.prepare(
      `SELECT timestamp FROM messages WHERE tenant_id = ? ORDER BY timestamp DESC LIMIT 1 OFFSET ?`
    ).get(tenant, MAX_MESSAGES_PER_TENANT);
    if (cutoff) {
      db.prepare(`DELETE FROM messages WHERE tenant_id = ? AND timestamp <= ?`).run(tenant, cutoff.timestamp);
    }
  }
}

module.exports = {
  init,
  loadForTenant,
  append,
  DEFAULT_TENANT_ID,
  getDbPath,
};
