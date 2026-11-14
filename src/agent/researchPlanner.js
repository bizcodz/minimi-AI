import { config } from '../config.js';

/**
 * Research Planner
 * Analyzes user query, temporal context, and conversation memory
 * to plan bounded, non-redundant search queries.
 */
export class ResearchPlanner {
  constructor(options = {}) {
    this.maxCalls = options.maxCalls || config.MAX_SEARCH_CALLS_PER_REQUEST;
    this.maxRounds = options.maxRounds || config.MAX_TOOL_ROUNDS;
  }

  /**
   * Determine whether web search is required or if the query can be satisfied purely via memory
   *
   * @param {string} userMessage
   * @param {Object} memoryContext - Output from MemoryRetriever
   * @returns {Object} - { needsSearch: boolean, reason: string, suggestedQueries: Array<string> }
   */
  evaluateSearchNeed(userMessage, memoryContext) {
    const lower = userMessage.toLowerCase();

    // 1. Pure recall queries: "What did I ask you...", "What was the list...", "Show me what we spoke about"
    const isPureRecall =
      /^(what|show|tell)\s+(did\s+i|was\s+the|were\s+the)\s+(ask|talk|speak|discuss|list)/i.test(userMessage) ||
      /^(what\s+did\s+i\s+ask\s+you)\b/i.test(userMessage) ||
      (memoryContext.temporal && !/\b(change|pricing|price|today|current|still|updated|latest|new|ship)\b/i.test(lower));

    if (isPureRecall && !/\b(still\s+correct|changed?|today|latest)\b/i.test(lower)) {
      return {
        needsSearch: false,
        reason: 'Query is a pure episodic recall of past conversation history.',
        suggestedQueries: [],
      };
    }

    // 2. Freshness check, change detection, or explicit current state queries
    const requiresFreshness =
      /\b(changed?|pricing|price|today|current|still\s+correct|latest|new\s+plans?|shipped?|updates?)\b/i.test(lower) ||
      /\b(has\s+any\s+of\s+them|is\s+your\s+answer\s+still)\b/i.test(lower) ||
      !memoryContext.hasHistoricalContext;

    if (!requiresFreshness) {
      return {
        needsSearch: false,
        reason: 'Sufficient context already exists in conversation history.',
        suggestedQueries: [],
      };
    }

    // Formulate targeted queries from entities or recalled topics
    const queries = [];
    const entities = memoryContext.entities || [];

    if (entities.length > 0) {
      for (const ent of entities) {
        if (ent.type === 'company' || ent.type === 'product') {
          if (/\b(pricing|price)\b/i.test(lower)) {
            queries.push(`${ent.name} pricing plans 2026`);
          } else if (/\b(shipped|feature|update)\b/i.test(lower)) {
            queries.push(`${ent.name} latest product updates features 2026`);
          } else {
            queries.push(`${ent.name} current status pricing 2026`);
          }
        }
      }
    }

    // If no specific entities found, fall back to cleaned user query
    if (queries.length === 0) {
      queries.push(cleanQueryForSearch(userMessage));
    }

    // Deduplicate and cap to execution limit
    const deduplicated = deduplicateQueries(queries).slice(0, this.maxCalls);

    return {
      needsSearch: true,
      reason: 'User asks for current status, change detection, or external facts.',
      suggestedQueries: deduplicated,
    };
  }
}

/**
 * Clean user message into a clean search query
 */
export function cleanQueryForSearch(text) {
  return text
    .replace(/^(what did i ask you on|what did i ask|has any of them|is your answer still correct today)/gi, '')
    .replace(/[?!.]/g, '')
    .trim();
}

/**
 * Deduplicate search queries based on normalized tokens
 */
export function deduplicateQueries(queries) {
  const seen = new Set();
  const result = [];

  for (const q of queries) {
    if (!q || typeof q !== 'string') continue;
    const normalized = normalizeQuery(q);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(q.trim());
    }
  }

  return result;
}

/**
 * Normalize query string for deduplication
 */
export function normalizeQuery(query) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => !['the', 'a', 'an', 'for', 'in', 'of', 'and', 'or', 'to'].includes(w))
    .sort()
    .join(' ');
}
