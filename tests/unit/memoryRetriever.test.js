import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { MemoryRetriever } from '../../src/agent/memoryRetriever.js';
import crypto from 'crypto';

describe('Memory Retriever (Three-Tier Memory)', () => {
  let sqlite;
  let db;
  let retriever;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    db = testDb.db;
    retriever = new MemoryRetriever(db, sqlite, 'Asia/Kolkata');
  });

  afterEach(() => {
    sqlite.close();
  });

  it('retrieves messages matching temporal range and FTS5 keyword', async () => {
    const convId = crypto.randomUUID();
    const nowIso = new Date('2026-11-10T10:00:00Z').toISOString(); // Last Tuesday

    // Insert conversation & message
    sqlite.prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at)
      VALUES (?, 'CRM Discussion', ?, ?)
    `).run(convId, nowIso, nowIso);

    sqlite.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, created_at)
      VALUES (?, ?, 'user', 'We shortlisted HubSpot and Salesforce for our sales team.', ?)
    `).run(crypto.randomUUID(), convId, nowIso);

    // Query on Saturday Nov 14 asking about "last Tuesday"
    const refDate = new Date('2026-11-14T06:30:00Z');
    const result = await retriever.retrieve('What did I ask you last Tuesday about CRM?', {
      referenceDate: refDate,
    });

    expect(result.episodic.length).toBeGreaterThan(0);
    expect(result.episodic[0].content).toContain('HubSpot');
    expect(result.hasHistoricalContext).toBe(true);
  });

  it('retrieves linked research memory and fact observations', async () => {
    const entId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    sqlite.prepare(`
      INSERT INTO entities (id, name, normalized_name, type, created_at, updated_at)
      VALUES (?, 'Supabase', 'supabase', 'product', ?, ?)
    `).run(entId, nowIso, nowIso);

    sqlite.prepare(`
      INSERT INTO fact_observations (id, entity_id, fact_type, claim, value, observed_at, confidence, status)
      VALUES (?, ?, 'pricing', 'Supabase Pro Plan', '$25/mo', ?, 1.0, 'no_change')
    `).run(crypto.randomUUID(), entId, nowIso);

    const result = await retriever.retrieve('Has Supabase changed pricing?');
    expect(result.research.observations.length).toBe(1);
    expect(result.research.observations[0].value).toBe('$25/mo');
  });
});
