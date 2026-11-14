/**
 * FTS5 setup and search helpers for SQLite
 */

export function setupFts(sqlite) {
  // Create FTS5 virtual table for full-text search on messages
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      message_id UNINDEXED,
      conversation_id UNINDEXED,
      content,
      created_at UNINDEXED,
      tokenize = 'porter unicode61'
    );

    -- Trigger for insert
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(message_id, conversation_id, content, created_at)
      VALUES (new.id, new.conversation_id, new.content, new.created_at);
    END;

    -- Trigger for delete
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE message_id = old.id;
    END;

    -- Trigger for update
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      UPDATE messages_fts
      SET content = new.content, created_at = new.created_at
      WHERE message_id = old.id;
    END;
  `);
}

/**
 * Sanitize query for FTS5 syntax
 * Prevents syntax errors on special characters like quotes, colons, asterisks
 */
export function sanitizeFtsQuery(query) {
  if (!query || typeof query !== 'string') return '';
  // Remove special FTS characters except alphanumeric and whitespace
  const sanitized = query
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .map((word) => `"${word}"*`)
    .join(' OR ');

  return sanitized || `"${query.replace(/"/g, '""')}"`;
}

/**
 * Search messages using FTS5 with BM25 ranking
 */
export function searchMessagesFts(sqlite, query, limit = 10) {
  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];

  try {
    const stmt = sqlite.prepare(`
      SELECT 
        m.id,
        m.conversation_id,
        m.role,
        m.content,
        m.created_at,
        c.title AS conversation_title,
        bm25(messages_fts) AS rank
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.message_id
      JOIN conversations c ON c.id = m.conversation_id
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    return stmt.all(sanitized, limit);
  } catch (err) {
    console.warn('FTS5 search fallback for query:', query, err.message);
    // Fallback to LIKE if FTS expression fails
    const fallbackStmt = sqlite.prepare(`
      SELECT 
        m.id,
        m.conversation_id,
        m.role,
        m.content,
        m.created_at,
        c.title AS conversation_title,
        0 AS rank
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.content LIKE ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `);
    return fallbackStmt.all(`%${query}%`, limit);
  }
}
