import { describe, it, expect } from 'vitest';
import { extractEntitiesDeterministically } from '../../src/agent/entityExtractor.js';

describe('Entity Extractor', () => {
  it('extracts CRM tools and aliases', () => {
    const text = 'On Monday we shortlisted HubSpot, Salesforce, Pipedrive, Zoho CRM, and Close for sales.';
    const entities = extractEntitiesDeterministically(text);

    const names = entities.map((e) => e.name);
    expect(names).toContain('HubSpot');
    expect(names).toContain('Salesforce');
    expect(names).toContain('Pipedrive');
    expect(names).toContain('Zoho CRM');
    expect(names).toContain('Close');
  });

  it('extracts database and hosting providers', () => {
    const text = 'Compare Supabase, Neon, Render, Railway, and AWS RDS for PostgreSQL hosting.';
    const entities = extractEntitiesDeterministically(text);

    const names = entities.map((e) => e.name);
    expect(names).toContain('Supabase');
    expect(names).toContain('Neon');
    expect(names).toContain('Render');
    expect(names).toContain('Railway');
    expect(names).toContain('AWS RDS');
    expect(names).toContain('PostgreSQL');
  });

  it('normalizes names consistently', () => {
    const text1 = 'Check hubspot crm';
    const text2 = 'Check HubSpot';

    const [e1] = extractEntitiesDeterministically(text1);
    const [e2] = extractEntitiesDeterministically(text2);

    expect(e1.normalizedName).toBe('hubspot');
    expect(e2.normalizedName).toBe('hubspot');
  });

  it('extracts custom capitalized entities safely while skipping common stop words', () => {
    const text = 'What did we decide about Linear and Datadog yesterday?';
    const entities = extractEntitiesDeterministically(text);

    const names = entities.map((e) => e.name);
    expect(names).toContain('Linear');
    expect(names).toContain('Datadog');
    expect(names).not.toContain('What');
    expect(names).not.toContain('Yesterday');
  });
});
