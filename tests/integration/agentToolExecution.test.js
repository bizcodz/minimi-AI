import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.js';
import { AgentOrchestrator } from '../../src/agent/agentOrchestrator.js';
import crypto from 'crypto';

describe('Bounded Agent Tool Execution', () => {
  let sqlite;
  let db;
  let orchestrator;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    db = testDb.db;

    orchestrator = new AgentOrchestrator(db, sqlite, {
      maxCalls: 4,
      maxRounds: 2,
    });
  });

  afterEach(() => {
    sqlite.close();
  });

  it('bounds search calls to maximum 4 calls even if multiple entities are asked', async () => {
    const searchCalls = [];
    orchestrator.webSearchTool.search = vi.fn().mockImplementation(async (query) => {
      searchCalls.push(query);
      return [
        {
          title: `Result for ${query}`,
          url: `https://example.com/${encodeURIComponent(query)}`,
          snippet: 'Pricing is $20/mo',
          retrievalTimestamp: new Date().toISOString(),
          score: 1.0,
        },
      ];
    });

    // Query mentioning 6 entities: HubSpot, Salesforce, Pipedrive, Zoho CRM, Close, Copper
    const message = 'Has any pricing changed for HubSpot, Salesforce, Pipedrive, Zoho CRM, Close, or Copper?';
    await orchestrator.process({ message });

    expect(searchCalls.length).toBeLessThanOrEqual(4);
    expect(orchestrator.webSearchTool.search).toHaveBeenCalledTimes(searchCalls.length);
  });

  it('does NOT trigger web search for pure episodic memory questions', async () => {
    const searchSpy = vi.fn();
    orchestrator.webSearchTool.search = searchSpy;

    // Seed historical conversation
    const convId = crypto.randomUUID();
    const nowIso = new Date('2026-11-03T10:00:00Z').toISOString();
    sqlite.prepare(`INSERT INTO conversations VALUES (?, 'Discussion', ?, ?)`).run(convId, nowIso, nowIso);
    sqlite.prepare(`INSERT INTO messages VALUES (?, ?, 'user', 'What are good CRM tools?', ?)`).run(crypto.randomUUID(), convId, nowIso);

    // Ask what was asked on 3 November
    await orchestrator.process({
      message: 'What did I ask you on 3 November?',
      conversationId: convId,
    });

    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('handles native OpenAI tool_calls response and executes web_search tool', async () => {
    // Configure orchestrator with a mock OpenAI client
    const searchMock = vi.fn().mockResolvedValue([
      {
        title: 'HubSpot Pricing',
        url: 'https://hubspot.com/pricing',
        snippet: 'HubSpot Starter is $20/mo',
        publishedDate: '2026-01-01',
        retrievalTimestamp: new Date().toISOString(),
        score: 1.0,
      },
    ]);
    orchestrator.webSearchTool.search = searchMock;
    orchestrator.openaiApiKey = 'mock-openai-key';

    let round = 0;
    orchestrator.openai.chat.completions.create = vi.fn().mockImplementation(async (params) => {
      round++;
      if (round === 1) {
        // Model decides to invoke web_search tool
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_123',
                    type: 'function',
                    function: {
                      name: 'web_search',
                      arguments: JSON.stringify({ query: 'HubSpot pricing 2026' }),
                    },
                  },
                ],
              },
            },
          ],
        };
      }
      // Round 2: Model outputs final synthesis grounded in tool results
      return {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'HubSpot Starter CRM starts at $20/mo [1].',
            },
          },
        ],
      };
    });

    const res = await orchestrator.process({
      message: 'Check HubSpot pricing updates',
    });

    expect(searchMock).toHaveBeenCalledWith('HubSpot pricing 2026');
    expect(res.response).toContain('HubSpot');
    expect(res.citations).toHaveLength(1);
    expect(res.citations[0].url).toBe('https://hubspot.com/pricing');
  });

  it('records insufficient_evidence status when search results lack pricing data', async () => {
    orchestrator.webSearchTool.search = vi.fn().mockResolvedValue([
      {
        title: 'Neon Serverless Architecture',
        url: 'https://neon.tech/architecture',
        snippet: 'Neon separates compute from storage using pageservers and safekeepers.',
        publishedDate: '2026-01-01',
        retrievalTimestamp: new Date().toISOString(),
        score: 0.95,
      },
    ]);

    const res = await orchestrator.process({
      message: 'Has Neon changed pricing?',
    });

    const neonReport = res.changeReports.find((r) => r.entityName === 'Neon');
    expect(neonReport).toBeDefined();
    expect(neonReport.status).toBe('insufficient_evidence');
  });
});
