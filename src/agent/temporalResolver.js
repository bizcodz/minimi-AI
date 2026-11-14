/**
 * Deterministic Temporal Date Resolver
 * Resolves relative date expressions ("yesterday", "last Tuesday", "3 November")
 * to precise UTC time windows [startUtc, endUtc] using the configured timezone.
 */

const DAYS_OF_WEEK = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTH_NAMES = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

/**
 * Get date parts in target timezone
 */
export function getZonedDateParts(date = new Date(), timeZone = 'Asia/Kolkata') {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    weekday: 'long',
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }

  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10) - 1, // 0-indexed
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
    weekday: map.weekday.toLowerCase(),
  };
}

/**
 * Convert a zoned year, month, day to UTC start of day and end of day
 */
export function zonedDayToUtcWindow(year, month, day, timeZone = 'Asia/Kolkata') {
  const pad = (n) => String(n).padStart(2, '0');
  const monthStr = pad(month + 1);
  const dayStr = pad(day);

  const isoDateStr = `${year}-${monthStr}-${dayStr}`;
  const startLocal = new Date(`${isoDateStr}T00:00:00.000`);
  const endLocal = new Date(`${isoDateStr}T23:59:59.999`);

  const tzOffsetMs = getTimezoneOffsetMs(isoDateStr, timeZone);

  const startUtc = new Date(startLocal.getTime() - tzOffsetMs);
  const endUtc = new Date(endLocal.getTime() - tzOffsetMs);

  return {
    startUtc: startUtc.toISOString(),
    endUtc: endUtc.toISOString(),
    isoDate: isoDateStr,
  };
}

/**
 * Compute timezone offset in milliseconds for a specific date string
 */
function getTimezoneOffsetMs(dateStr, timeZone) {
  const utcDate = new Date(`${dateStr}T12:00:00Z`);
  const invDate = new Date(
    utcDate.toLocaleString('en-US', { timeZone })
  );
  return invDate.getTime() - utcDate.getTime();
}

/**
 * Deterministically resolve temporal expressions from text
 *
 * @param {string} text - User message
 * @param {Object} options - { referenceDate: Date, timeZone: string }
 * @returns {Object|null} - Resolved temporal object or null
 */
export function resolveTemporalReference(text, options = {}) {
  if (!text || typeof text !== 'string') return null;

  const referenceDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
  const timeZone = options.timeZone || 'Asia/Kolkata';

  const zonedNow = getZonedDateParts(referenceDate, timeZone);
  const lower = text.toLowerCase();

  // 1. Explicit calendar date: "3 November", "November 3", "3rd November", "Nov 3"
  // Prioritized first because sentences often combine "on 3 November... still correct today?"
  const dateRegex = /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?\b|\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/;
  const dateMatch = lower.match(dateRegex);

  if (dateMatch) {
    let day, monthName, year;

    if (dateMatch[1] && dateMatch[2]) {
      day = parseInt(dateMatch[1], 10);
      monthName = dateMatch[2];
      year = dateMatch[3] ? parseInt(dateMatch[3], 10) : zonedNow.year;
    } else {
      monthName = dateMatch[4];
      day = parseInt(dateMatch[5], 10);
      year = dateMatch[6] ? parseInt(dateMatch[6], 10) : zonedNow.year;
    }

    const monthIndex = MONTH_NAMES[monthName];

    if (monthIndex !== undefined && day >= 1 && day <= 31) {
      if (!dateMatch[3] && !dateMatch[6]) {
        if (monthIndex > zonedNow.month || (monthIndex === zonedNow.month && day > zonedNow.day)) {
          year = zonedNow.year - 1;
        }
      }

      const win = zonedDayToUtcWindow(year, monthIndex, day, timeZone);
      return {
        type: 'explicit_date',
        label: `${day} ${monthName} ${year}`,
        isoDate: win.isoDate,
        startUtc: win.startUtc,
        endUtc: win.endUtc,
        confidence: 1.0,
        isAmbiguous: false,
      };
    }
  }

  // 2. ISO format: "2026-11-03"
  const isoMatch = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const win = zonedDayToUtcWindow(year, month, day, timeZone);

    return {
      type: 'iso_date',
      label: isoMatch[0],
      isoDate: win.isoDate,
      startUtc: win.startUtc,
      endUtc: win.endUtc,
      confidence: 1.0,
      isAmbiguous: false,
    };
  }

  // 3. "last <weekday>" (e.g. "last Tuesday", "last Monday")
  const lastWeekdayMatch = lower.match(/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/);
  if (lastWeekdayMatch) {
    const targetDayName = lastWeekdayMatch[1];
    const targetDayIndex = DAYS_OF_WEEK[targetDayName];
    const currentDayIndex = DAYS_OF_WEEK[zonedNow.weekday] !== undefined
      ? DAYS_OF_WEEK[zonedNow.weekday]
      : (new Date(zonedNow.year, zonedNow.month, zonedNow.day).getDay());

    let diff = (currentDayIndex - targetDayIndex + 7) % 7;
    if (diff === 0) diff = 7;

    const target = new Date(Date.UTC(zonedNow.year, zonedNow.month, zonedNow.day - diff));
    const win = zonedDayToUtcWindow(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), timeZone);

    return {
      type: 'last_weekday',
      label: `last ${targetDayName}`,
      weekday: targetDayName,
      daysAgo: diff,
      isoDate: win.isoDate,
      startUtc: win.startUtc,
      endUtc: win.endUtc,
      confidence: 1.0,
      isAmbiguous: false,
    };
  }

  // 4. "on <weekday>" (e.g. "On Monday we shortlisted...")
  const onWeekdayMatch = lower.match(/\b(?:on\s+)(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (onWeekdayMatch) {
    const targetDayName = onWeekdayMatch[1];
    const targetDayIndex = DAYS_OF_WEEK[targetDayName];
    const currentDayIndex = new Date(zonedNow.year, zonedNow.month, zonedNow.day).getDay();

    let diff = (currentDayIndex - targetDayIndex + 7) % 7;
    if (diff === 0) diff = 7;

    const target = new Date(Date.UTC(zonedNow.year, zonedNow.month, zonedNow.day - diff));
    const win = zonedDayToUtcWindow(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), timeZone);

    return {
      type: 'weekday',
      label: `on ${targetDayName}`,
      weekday: targetDayName,
      daysAgo: diff,
      isoDate: win.isoDate,
      startUtc: win.startUtc,
      endUtc: win.endUtc,
      confidence: 0.9,
      isAmbiguous: false,
    };
  }

  // 5. "yesterday"
  if (/\byesterday\b/.test(lower)) {
    const targetDay = zonedNow.day - 1;
    const target = new Date(Date.UTC(zonedNow.year, zonedNow.month, targetDay));
    const win = zonedDayToUtcWindow(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), timeZone);

    return {
      type: 'relative_day',
      label: 'yesterday',
      isoDate: win.isoDate,
      startUtc: win.startUtc,
      endUtc: win.endUtc,
      confidence: 1.0,
      isAmbiguous: false,
    };
  }

  // 6. "N days ago" (e.g. "2 days ago", "3 days ago")
  const daysAgoMatch = lower.match(/\b(\d+)\s+days?\s+ago\b/);
  if (daysAgoMatch) {
    const numDays = parseInt(daysAgoMatch[1], 10);
    const target = new Date(Date.UTC(zonedNow.year, zonedNow.month, zonedNow.day - numDays));
    const win = zonedDayToUtcWindow(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), timeZone);
    return {
      type: 'relative_days_ago',
      label: `${numDays} days ago`,
      isoDate: win.isoDate,
      startUtc: win.startUtc,
      endUtc: win.endUtc,
      confidence: 1.0,
      isAmbiguous: false,
    };
  }

  // 7. "last week"
  if (/\blast\s+week\b/.test(lower)) {
    const endTarget = new Date(Date.UTC(zonedNow.year, zonedNow.month, zonedNow.day - 7));
    const startTarget = new Date(Date.UTC(zonedNow.year, zonedNow.month, zonedNow.day - 14));
    const winStart = zonedDayToUtcWindow(startTarget.getUTCFullYear(), startTarget.getUTCMonth(), startTarget.getUTCDate(), timeZone);
    const winEnd = zonedDayToUtcWindow(endTarget.getUTCFullYear(), endTarget.getUTCMonth(), endTarget.getUTCDate(), timeZone);

    return {
      type: 'relative_range',
      label: 'last week',
      startUtc: winStart.startUtc,
      endUtc: winEnd.endUtc,
      confidence: 0.85,
      isAmbiguous: false,
    };
  }

  // 8. "today" (matched only if inquiry is explicitly about today's events, e.g. "what did i ask today", "today we discussed")
  if (/\b(?:what did i ask (?:you )?today|earlier today|today we discussed|today's conversation)\b/.test(lower)) {
    const win = zonedDayToUtcWindow(zonedNow.year, zonedNow.month, zonedNow.day, timeZone);
    return {
      type: 'relative_day',
      label: 'today',
      isoDate: win.isoDate,
      startUtc: win.startUtc,
      endUtc: win.endUtc,
      confidence: 1.0,
      isAmbiguous: false,
    };
  }

  // 9. Ambiguity check (e.g. "a few days ago", "some time back", "the other day")
  if (/\b(?:a\s+few\s+days\s+ago|some\s+time\s+back|the\s+other\s+day)\b/.test(lower)) {
    return {
      type: 'ambiguous',
      label: 'ambiguous relative period',
      confidence: 0.4,
      isAmbiguous: true,
      clarificationPrompt: 'Could you please specify which date or day you are referring to (for example, "last Tuesday" or "3 November")?',
    };
  }

  return null;
}
