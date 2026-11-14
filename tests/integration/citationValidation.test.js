import { describe, it, expect } from 'vitest';
import { ResponseGenerator } from '../../src/agent/responseGenerator.js';

describe('Citation Validation Pipeline', () => {
  it('maps bracketed citations [1], [2] to retrieved sources and returns metadata', () => {
    const sources = [
      {
        title: 'HubSpot Pricing 2026',
        url: 'https://hubspot.com/pricing',
        snippet: 'Starter CRM is $20 per seat per month.',
        publishedDate: '2026-01-10',
      },
      {
        title: 'Salesforce Small Business',
        url: 'https://salesforce.com/starter',
        snippet: 'Starter Suite starts at $25/user/month.',
        publishedDate: '2026-02-01',
      },
    ];

    const modelResponse = 'HubSpot offers a Starter plan at $20 [1], whereas Salesforce starts at $25 [2].';
    const validation = ResponseGenerator.validateCitations(modelResponse, sources);

    expect(validation.isValid).toBe(true);
    expect(validation.citations).toHaveLength(2);
    expect(validation.citations[0].url).toBe('https://hubspot.com/pricing');
    expect(validation.citations[1].url).toBe('https://salesforce.com/starter');
  });

  it('strips nonexistent citation indexes like [7] without crashing', () => {
    const sources = [
      {
        title: 'Supabase Pricing',
        url: 'https://supabase.com/pricing',
        snippet: 'Pro is $25.',
      },
    ];

    const modelResponse = 'Supabase Pro is $25 [1]. Another untrusted fact [7].';
    const validation = ResponseGenerator.validateCitations(modelResponse, sources);

    expect(validation.isValid).toBe(false); // Flagged because [7] was invalid
    expect(validation.citations).toHaveLength(1);
    expect(validation.citations[0].url).toBe('https://supabase.com/pricing');
    expect(validation.text).not.toContain('[7]');
  });

  it('defuses unverified or hallucinated markdown URLs into plain text', () => {
    const sources = [
      {
        title: 'Neon Tech',
        url: 'https://neon.tech/pricing',
        snippet: 'Launch tier is $19',
      },
    ];

    const modelResponse = 'Check [Neon Docs](https://neon.tech/docs) and [Fake Pricing](https://untrusted-site.com/fake).';
    const validation = ResponseGenerator.validateCitations(modelResponse, sources);

    // Verified domain (neon.tech) retained as link
    expect(validation.text).toContain('[Neon Docs](https://neon.tech/docs)');
    // Hallucinated domain (untrusted-site.com) stripped into plain text
    expect(validation.text).toContain('Fake Pricing');
    expect(validation.text).not.toContain('https://untrusted-site.com/fake');
  });
});
