import { describe, it, expect } from 'vitest';
import {
  compareValues,
  extractPriceNumber,
  findEquivalentHistorical,
} from '../../src/agent/changeDetector.js';

describe('Change Detector', () => {
  it('detects price increases accurately', () => {
    const res = compareValues('$20/mo', '$25/mo', 'pricing');
    expect(res.status).toBe('confirmed_change');
    expect(res.changeType).toBe('increase');
    expect(res.summary).toContain('Price increased from USD 20 to USD 25');
  });

  it('detects price decreases accurately', () => {
    const res = compareValues('$50/mo', '$35/mo', 'pricing');
    expect(res.status).toBe('confirmed_change');
    expect(res.changeType).toBe('decrease');
    expect(res.summary).toContain('Price decreased from USD 50 to USD 35');
  });

  it('detects unchanged pricing', () => {
    const res = compareValues('$25/mo', '$25/mo', 'pricing');
    expect(res.status).toBe('no_change');
    expect(res.changeType).toBe('no_change');
  });

  it('detects pricing model changes (e.g. monthly to annual or currency change)', () => {
    const res = compareValues('$25/mo', '€25/mo', 'pricing', 'USD', 'EUR');
    expect(res.status).toBe('confirmed_change');
    expect(res.changeType).toBe('model_change');
  });

  it('detects feature removal or deprecation', () => {
    const res = compareValues('Includes free compute', 'Free compute discontinued and deprecated', 'feature');
    expect(res.status).toBe('confirmed_change');
    expect(res.changeType).toBe('feature_removal');
  });

  it('detects feature additions', () => {
    const res = compareValues('Single region only', 'Now supports multi-region read replicas', 'feature');
    expect(res.status).toBe('confirmed_change');
    expect(res.changeType).toBe('feature_addition');
  });

  it('extracts price numbers from various formats', () => {
    expect(extractPriceNumber('$29/mo')).toBe(29);
    expect(extractPriceNumber('£15.50 per user')).toBe(15.5);
    expect(extractPriceNumber('Free tier $0')).toBe(0);
    expect(extractPriceNumber('Custom quote')).toBeNull();
  });

  it('finds equivalent historical plan via fuzzy matching', () => {
    const historical = [
      { id: '1', entityId: 'ent-1', claim: 'Supabase Pro Plan', value: '$25/mo' },
      { id: '2', entityId: 'ent-1', claim: 'Supabase Free Tier', value: '$0' },
    ];

    const finding = { entityId: 'ent-1', claim: 'pro tier pricing' };
    const match = findEquivalentHistorical(finding, historical);

    expect(match).not.toBeNull();
    expect(match.id).toBe('1');
  });
});
