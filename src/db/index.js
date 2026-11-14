import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createRequire } from 'node:module';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import * as schema from './schema.js';
import { setupFts } from './fts.js';

const require = createRequire(import.meta.url);

let sqliteInstance = null;
let dbInstance = null;
let currentDbPath = null;

export function createSqliteInstance(dbPath = ':memory:') {
  let sqlite;
  try {
    const BetterSqlite = require('better-sqlite3');
    sqlite = new BetterSqlite(dbPath);
  } catch (e) {
    const { DatabaseSync } = require('node:sqlite');
    sqlite = new DatabaseSync(dbPath);

    sqlite.pragma = function (pragmaStr) {
      try {
        return sqlite.exec(`PRAGMA ${pragmaStr}`);
      } catch (_) {
        return null;
      }
    };

    const origPrepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = function (sql) {
      const stmt = origPrepare(sql);
      const origAll = stmt.all.bind(stmt);
      const origGet = stmt.get.bind(stmt);

      stmt._raw = false;
      stmt.raw = function (isRaw = true) {
        stmt._raw = isRaw;
        return stmt;
      };

      stmt.all = function (...args) {
        const res = origAll(...args);
        if (stmt._raw && Array.isArray(res)) {
          return res.map((row) => (row ? Object.values(row) : []));
        }
        return res;
      };

      stmt.get = function (...args) {
        const res = origGet(...args);
        if (stmt._raw && res) {
          return Object.values(res);
        }
        return res;
      };

      return stmt;
    };

    sqlite.transaction = function (fn) {
      return function (...args) {
        sqlite.exec('BEGIN TRANSACTION');
        try {
          const res = fn(...args);
          sqlite.exec('COMMIT');
          return res;
        } catch (err) {
          sqlite.exec('ROLLBACK');
          throw err;
        }
      };
    };
  }
  return sqlite;
}

export function createTestDb() {
  const sqlite = createSqliteInstance(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  initTables(sqlite);
  setupFts(sqlite);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

// Synchronous wrapper for getDatabase
export function getDatabase(dbPath = config.resolvedDbPath) {
  const resolved = dbPath === ':memory:' ? ':memory:' : path.resolve(dbPath);
  if (dbInstance && sqliteInstance && currentDbPath === resolved) {
    return { db: dbInstance, sqlite: sqliteInstance };
  }

  if (sqliteInstance) {
    closeDatabase();
  }

  // Ensure directory exists if using file-based DB
  if (resolved !== ':memory:') {
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const sqlite = createSqliteInstance(resolved);

  // Performance and integrity pragma settings
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');

  // Auto-initialize base tables if they don't exist
  initTables(sqlite);

  // Setup FTS5 virtual table and triggers
  setupFts(sqlite);

  const db = drizzle(sqlite, { schema });

  sqliteInstance = sqlite;
  dbInstance = db;
  currentDbPath = resolved;

  return { db, sqlite };
}

function initTables(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'other',
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_entities (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
      query TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      research_run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      snippet TEXT NOT NULL,
      raw_content TEXT,
      published_date TEXT,
      retrieved_at TEXT NOT NULL,
      score REAL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS fact_observations (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      evidence_id TEXT REFERENCES evidence(id) ON DELETE SET NULL,
      fact_type TEXT NOT NULL DEFAULT 'general',
      claim TEXT NOT NULL,
      value TEXT NOT NULL,
      currency TEXT DEFAULT 'USD',
      billing_interval TEXT,
      change_type TEXT NOT NULL DEFAULT 'no_change',
      observed_at TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      status TEXT NOT NULL DEFAULT 'no_change'
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_entities_normalized ON entities(normalized_name);
    CREATE INDEX IF NOT EXISTS idx_fact_entity ON fact_observations(entity_id);
    CREATE INDEX IF NOT EXISTS idx_fact_observed ON fact_observations(observed_at);
  `);
}

export function closeDatabase() {
  if (sqliteInstance) {
    try {
      sqliteInstance.close();
    } catch (e) {
      // Ignore if already closed
    }
    sqliteInstance = null;
    dbInstance = null;
    currentDbPath = null;
  }
}

export { schema };
