import { describe, it, expect } from 'vitest';
import {
  deduplicateQueries,
  normalizeQuery,
  cleanQueryForSearch,
} from '../../src/agent/researchPlanner.js';

describe('Query Deduplication and Cleaning', () => {
  it('deduplicates equivalent queries with varied casing, stop-words, and whitespace', () => {
    const queries = [
      'HubSpot pricing plans 2026',
      'hubspot pricing plans 2026',
      'pricing plans for HubSpot in 2026',
      'Salesforce CRM updates',
    ];

    const deduplicated = deduplicateQueries(queries);
    expect(deduplicated).toHaveLength(2);
    expect(deduplicated[0]).toBe('HubSpot pricing plans 2026');
    expect(deduplicated[1]).toBe('Salesforce CRM updates');
  });

  it('normalizes queries correctly', () => {
    const q1 = normalizeQuery('The pricing of Supabase');
    const q2 = normalizeQuery('Supabase pricing');
    expect(q1).toBe(q2);
  });

  it('cleans conversational filler prefixes from user queries', () => {
    const cleaned = cleanQueryForSearch('What did I ask you on 3 November regarding CRM?');
    expect(cleaned).not.toContain('what did i ask you on');
    expect(cleaned.toLowerCase()).toContain('crm');
  });
});
