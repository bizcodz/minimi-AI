import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../../src/server.js';
import crypto from 'crypto';

describe('Server & Router Integration', () => {
  it('creates application and initializes chat and conversation routes', () => {
    const { app, db, sqlite, orchestrator } = createApp();

    expect(app).toBeDefined();
    expect(db).toBeDefined();
    expect(sqlite).toBeDefined();
    expect(orchestrator).toBeDefined();
  });

  it('handles chat streaming callback events accurately', async () => {
    const { orchestrator } = createApp();

    // Mock search tool
    orchestrator.webSearchTool.search = vi.fn().mockResolvedValue([
      {
        title: 'Neon Serverless',
        url: 'https://neon.tech/pricing',
        snippet: 'Launch tier is $19/mo',
        publishedDate: '2026-02-01',
        retrievalTimestamp: new Date().toISOString(),
        score: 0.95,
      },
    ]);

    const events = [];
    const res = await orchestrator.process({
      message: 'What is the current pricing of Neon?',
      onEvent: (event, data) => {
        events.push({ event, data });
      },
    });

    expect(res.conversationId).toBeDefined();
    expect(res.response).toBeDefined();

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain('status');
    expect(eventTypes).toContain('memory');
    expect(eventTypes).toContain('search_start');
    expect(eventTypes).toContain('sources');
    expect(eventTypes).toContain('done');
  });
});
