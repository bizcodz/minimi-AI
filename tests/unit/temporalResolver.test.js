import { describe, it, expect } from 'vitest';
import {
  resolveTemporalReference,
  getZonedDateParts,
  zonedDayToUtcWindow,
} from '../../src/agent/temporalResolver.js';

describe('Temporal Date Resolver', () => {
  // Reference date: Friday, 14 November 2026 12:00:00 (Asia/Kolkata)
  const refDate = new Date('2026-11-14T06:30:00Z'); // 12:00:00 PM IST
  const timeZone = 'Asia/Kolkata';

  it('correctly identifies zoned date parts for Asia/Kolkata', () => {
    const parts = getZonedDateParts(refDate, timeZone);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(10); // November (0-indexed)
    expect(parts.day).toBe(14);
    expect(parts.weekday).toBe('saturday'); // Nov 14 2026 is Saturday in IST
  });

  it('resolves "yesterday" accurately to previous day UTC window', () => {
    const res = resolveTemporalReference('What did I ask you yesterday?', {
      referenceDate: refDate,
      timeZone,
    });

    expect(res).not.toBeNull();
    expect(res.label).toBe('yesterday');
    expect(res.isoDate).toBe('2026-11-13');
    expect(res.confidence).toBe(1.0);
    expect(res.startUtc).toContain('2026-11-12T18:30:00'); // 00:00 IST is 18:30 UTC previous day
  });

  it('resolves "last Tuesday"', () => {
    // Current is Saturday Nov 14. Last Tuesday was Nov 10.
    const res = resolveTemporalReference('Last Tuesday I asked you about Postgres hosting. Has any pricing changed since?', {
      referenceDate: refDate,
      timeZone,
    });

    expect(res).not.toBeNull();
    expect(res.label).toBe('last tuesday');
    expect(res.isoDate).toBe('2026-11-10');
    expect(res.isAmbiguous).toBe(false);
  });

  it('resolves explicit calendar date "3 November"', () => {
    const res = resolveTemporalReference('What did I ask you on 3 November? Is your answer still correct today?', {
      referenceDate: refDate,
      timeZone,
    });

    expect(res).not.toBeNull();
    expect(res.isoDate).toBe('2026-11-03');
    expect(res.isAmbiguous).toBe(false);
  });

  it('resolves explicit ISO date "2026-11-03"', () => {
    const res = resolveTemporalReference('Check records from 2026-11-03', {
      referenceDate: refDate,
      timeZone,
    });

    expect(res).not.toBeNull();
    expect(res.isoDate).toBe('2026-11-03');
  });

  it('resolves relative period "2 days ago"', () => {
    const res = resolveTemporalReference('We discussed this 2 days ago', {
      referenceDate: refDate,
      timeZone,
    });

    expect(res).not.toBeNull();
    expect(res.label).toBe('2 days ago');
    expect(res.isoDate).toBe('2026-11-12');
  });

  it('flags ambiguous temporal expressions and prompts for clarification', () => {
    const res = resolveTemporalReference('Can you check what we discussed a few days ago?', {
      referenceDate: refDate,
      timeZone,
    });

    expect(res).not.toBeNull();
    expect(res.isAmbiguous).toBe(true);
    expect(res.clarificationPrompt).toContain('Could you please specify which date');
  });

  it('returns null when no temporal expression is present', () => {
    const res = resolveTemporalReference('What is the current pricing of Supabase?', {
      referenceDate: refDate,
      timeZone,
    });

    expect(res).toBeNull();
  });
});
