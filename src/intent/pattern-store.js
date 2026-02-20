'use strict';

const fs = require('fs');
const path = require('path');

class PatternStore {
  /**
   * @param {string} filePath - Path to the JSON persistence file
   */
  constructor(filePath) {
    this._filePath = filePath;
    this._entries = {};       // { [normalizedQuery]: LearningEntry }
    this._version = 1;
    this._persistTimer = null;
    this._persistPending = false;
  }

  /**
   * Load entries from disk. Handles missing/corrupted files gracefully.
   */
  load() {
    try {
      if (!fs.existsSync(this._filePath)) {
        this._entries = {};
        return;
      }
      const raw = fs.readFileSync(this._filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data && typeof data.entries === 'object' && data.entries !== null) {
        this._entries = data.entries;
        this._version = data.version || 1;
      } else {
        this._entries = {};
      }
    } catch (err) {
      // Corrupted or unreadable file — log warning, start fresh
      console.warn(`[PatternStore] Failed to load ${this._filePath}: ${err.message}. Starting with empty store.`);
      this._entries = {};
    }
  }

  /**
   * Exact lookup by normalized key. O(1).
   * @param {string} normalizedQuery
   * @returns {object|null} LearningEntry or null
   */
  get(normalizedQuery) {
    return this._entries[normalizedQuery] || null;
  }

  /**
   * Get all entries for fuzzy comparison.
   * @returns {Array<{key: string, entry: object}>}
   */
  getAll() {
    return Object.keys(this._entries).map(key => ({
      key,
      entry: this._entries[key]
    }));
  }

  /**
   * Add or update a learning entry.
   * If entry exists: update intent, increment hitCount, refresh lastUsedAt.
   * If new: initialize hitCount=1, set timestamps.
   * @param {string} normalizedQuery
   * @param {object} intent - { skillId, action, params, suggestedReply }
   */
  put(normalizedQuery, intent) {
    const now = new Date().toISOString();
    const existing = this._entries[normalizedQuery];
    if (existing) {
      existing.intent = intent;
      existing.hitCount += 1;
      existing.lastUsedAt = now;
    } else {
      this._entries[normalizedQuery] = {
        intent,
        hitCount: 1,
        createdAt: now,
        lastUsedAt: now
      };
    }
    this._schedulePersist();
  }

  /**
   * Increment hit count for an existing entry.
   * @param {string} normalizedQuery
   */
  recordHit(normalizedQuery) {
    const entry = this._entries[normalizedQuery];
    if (entry) {
      entry.hitCount += 1;
      entry.lastUsedAt = new Date().toISOString();
      this._schedulePersist();
    }
  }

  /**
   * Remove a learning entry by normalized key.
   * @param {string} normalizedQuery
   * @returns {boolean} true if entry existed and was removed
   */
  remove(normalizedQuery) {
    if (this._entries[normalizedQuery]) {
      delete this._entries[normalizedQuery];
      this._schedulePersist();
      return true;
    }
    return false;
  }

  /**
   * @returns {number} Total number of entries
   */
  size() {
    return Object.keys(this._entries).length;
  }

  /**
   * Export all entries as a JSON string.
   * @returns {string}
   */
  exportJSON() {
    return JSON.stringify({
      version: this._version,
      entries: this._entries
    }, null, 2);
  }

  /**
   * Merge imported entries into the store.
   * For duplicate keys, keeps the entry with the higher hitCount.
   * @param {string} jsonString - JSON string of PatternStoreFile format
   * @throws {Error} if JSON is malformed or invalid
   */
  importJSON(jsonString) {
    let data;
    try {
      data = JSON.parse(jsonString);
    } catch (err) {
      throw new Error(`Import failed: malformed JSON — ${err.message}`);
    }

    if (!data || typeof data.entries !== 'object' || data.entries === null) {
      throw new Error('Import failed: invalid format — missing or invalid "entries" field');
    }

    for (const [key, imported] of Object.entries(data.entries)) {
      const existing = this._entries[key];
      if (!existing) {
        // New entry — add it
        this._entries[key] = imported;
      } else {
        // Duplicate key — keep the one with higher hitCount
        if (imported.hitCount > existing.hitCount) {
          this._entries[key] = imported;
        }
      }
    }

    this._schedulePersist();
  }

  /**
   * Schedule a debounced persist. Writes at most once per 5 seconds.
   * @private
   */
  _schedulePersist() {
    if (this._persistTimer) return; // already scheduled
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._writeToDisk();
    }, 5000);
  }

  /**
   * Force an immediate persist (useful for testing and shutdown).
   */
  flush() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._writeToDisk();
  }

  /**
   * Write current state to disk.
   * @private
   */
  _writeToDisk() {
    try {
      const dir = path.dirname(this._filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = JSON.stringify({
        version: this._version,
        entries: this._entries
      }, null, 2);
      fs.writeFileSync(this._filePath, data, 'utf-8');
    } catch (err) {
      console.error(`[PatternStore] Failed to persist to ${this._filePath}: ${err.message}`);
    }
  }
}

module.exports = { PatternStore };
