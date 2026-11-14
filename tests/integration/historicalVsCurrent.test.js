import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { AgentOrchestrator } from '../../src/agent/agentOrchestrator.js';
import crypto from 'crypto';

describe('Historical vs Current Comparison Pipeline', () => {
  let sqlite;
  let db;
  let orchestrator;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    db = testDb.db;

    orchestrator = new AgentOrchestrator(db, sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('detects a price change between historical baseline and current web search', async () => {
    // 1. Seed historical entity & baseline fact from "last Tuesday" (Nov 10 2026)
    const entId = crypto.randomUUID();
    const pastDate = '2026-11-10T10:00:00Z';
    const convId = crypto.randomUUID();
    const pastMsgId = crypto.randomUUID();

    sqlite.prepare(`INSERT INTO conversations VALUES (?, 'Postgres Hosting', ?, ?)`).run(convId, pastDate, pastDate);
    sqlite.prepare(`INSERT INTO messages VALUES (?, ?, 'user', 'Tell me about Supabase pricing', ?)`).run(pastMsgId, convId, pastDate);
    sqlite.prepare(`INSERT INTO entities VALUES (?, 'Supabase', 'supabase', 'product', NULL, ?, ?)`).run(entId, pastDate, pastDate);
    sqlite.prepare(`INSERT INTO message_entities VALUES (?, ?, ?, ?)`).run(crypto.randomUUID(), pastMsgId, entId, pastDate);

    // Baseline historical observation: $25/mo
    sqlite.prepare(`
      INSERT INTO fact_observations (id, entity_id, message_id, fact_type, claim, value, currency, billing_interval, change_type, observed_at, confidence, status)
      VALUES (?, ?, ?, 'pricing', 'Supabase standard pricing plan', '$25/mo', 'USD', 'monthly', 'no_change', ?, 1.0, 'no_change')
    `).run(crypto.randomUUID(), entId, pastMsgId, pastDate);

    // 2. Mock fresh search result returning a new price: $29/mo
    orchestrator.webSearchTool.search = vi.fn().mockResolvedValue([
      {
        title: 'Supabase Pricing Update',
        url: 'https://supabase.com/pricing',
        snippet: 'Supabase Pro plan is now $29/mo with 8GB compute included.',
        publishedDate: '2026-11-13',
        retrievalTimestamp: new Date().toISOString(),
        score: 0.99,
      },
    ]);

    // 3. User asks: "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since?"
    const result = await orchestrator.process({
      message: 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since?',
    });

    // 4. Assert change was detected
    expect(result.changeReports.length).toBeGreaterThan(0);
    const report = result.changeReports.find((r) => r.entityName === 'Supabase');
    expect(report).toBeDefined();
    expect(report.status).toBe('confirmed_change');
    expect(report.changeType).toBe('increase');
    expect(report.summary).toContain('Price increased from USD 25 to USD 29');

    // 5. Verify historical observation is NEVER overwritten, but preserved alongside the new one
    const allObs = sqlite.prepare(`SELECT * FROM fact_observations WHERE entity_id = ? ORDER BY observed_at ASC`).all(entId);
    expect(allObs).toHaveLength(2);
    expect(allObs[0].value).toBe('$25/mo'); // Historical baseline intact!
    expect(allObs[1].value).toBe('$29/mo'); // New observation recorded!
  });
});
