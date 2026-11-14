import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSearchTool } from '../../src/agent/tools/webSearch.js';

describe('Web Search Adapter (Tavily Mocked)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('formats tool definition correctly for OpenAI function calling', () => {
    const tool = new WebSearchTool('mock-key');
    const def = tool.getToolDefinition();

    expect(def.type).toBe('function');
    expect(def.function.name).toBe('web_search');
    expect(def.function.parameters.required).toContain('query');
  });

  it('parses structured search results and deduplicates equivalent URLs', async () => {
    const mockResponse = {
      results: [
        {
          title: 'Supabase Pricing',
          url: 'https://supabase.com/pricing?utm_source=test',
          content: 'Pro plan starts at $25/mo per organization.',
          published_date: '2026-01-15',
          score: 0.98,
        },
        {
          title: 'Supabase Pricing Duplicate',
          url: 'https://supabase.com/pricing/',
          content: 'Duplicate listing.',
          published_date: '2026-01-15',
          score: 0.95,
        },
        {
          title: 'Neon Serverless Postgres',
          url: 'https://neon.tech/pricing',
          content: 'Launch plan is $19/mo.',
          published_date: '2026-02-01',
          score: 0.92,
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const tool = new WebSearchTool('test-api-key');
    const results = await tool.search('postgres hosting pricing');

    expect(results).toHaveLength(2); // Second Supabase URL deduplicated
    expect(results[0].title).toBe('Supabase Pricing');
    expect(results[0].snippet).toContain('Pro plan starts at $25/mo');
    expect(results[1].title).toBe('Neon Serverless Postgres');
    expect(results[0].retrievalTimestamp).toBeDefined();
  });

  it('retries on transient HTTP 500 error before succeeding', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 500, text: async () => 'Internal Server Error' };
      }
      return {
        ok: true,
        json: async () => ({
          results: [{ title: 'Success', url: 'https://example.com', content: 'Info' }],
        }),
      };
    });

    const tool = new WebSearchTool('test-key', { timeoutMs: 5000 });
    const results = await tool.search('test query');

    expect(callCount).toBe(2);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Success');
  });

  it('handles search timeout safely without throwing unhandled exceptions', async () => {
    global.fetch = vi.fn().mockImplementation(async (url, opts) => {
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const tool = new WebSearchTool('test-key', { timeoutMs: 50 });
    const results = await tool.search('slow search');

    expect(results).toEqual([]);
  });
});
