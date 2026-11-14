import { config } from '../../config.js';

/**
 * Web Search Tool using Tavily Search API
 * Exactly one external tool for the research agent.
 */
export class WebSearchTool {
  constructor(apiKey = config.TAVILY_API_KEY, options = {}) {
    this.apiKey = apiKey;
    this.timeoutMs = options.timeoutMs || config.SEARCH_TIMEOUT_MS;
    this.maxResults = options.maxResults || config.MAX_SEARCH_RESULTS_PER_CALL;
  }

  /**
   * Tool definition schema formatted for OpenAI function calling
   */
  getToolDefinition() {
    return {
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Search the public web for fresh, authoritative information on companies, products, current pricing, plans, and technical features.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The focused search query (e.g., "Supabase postgres pricing plans 2026", "HubSpot CRM pricing changes")',
            },
          },
          required: ['query'],
        },
      },
    };
  }

  /**
   * Execute web search with timeout, retry, URL validation, and sanitization
   *
   * @param {string} query
   * @returns {Promise<Array<Object>>}
   */
  async search(query) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }

    const trimmedQuery = query.trim();

    // Check API Key
    if (!this.apiKey) {
      console.warn('TAVILY_API_KEY is not configured.');
      return [];
    }

    let lastError = null;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: this.apiKey,
            query: trimmedQuery,
            search_depth: 'advanced',
            include_answer: false,
            include_images: false,
            include_raw_content: false,
            max_results: this.maxResults,
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Tavily API responded with status ${response.status}: ${errorBody}`);
        }

        const data = await response.json();
        return this.processResults(data.results || [], trimmedQuery);
      } catch (err) {
        lastError = err;
        // If aborted (timeout) or 4xx, don't keep retrying aggressively
        if (err.name === 'AbortError') {
          console.warn(`Web search timeout after ${this.timeoutMs}ms for query "${trimmedQuery}"`);
          break;
        }

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 500;
          await new Promise((res) => setTimeout(res, delay));
        }
      }
    }

    console.error(`Web search failed for "${trimmedQuery}":`, lastError?.message);
    return [];
  }

  /**
   * Process, validate, deduplicate, and sanitize Tavily results
   */
  processResults(rawResults, originalQuery) {
    const seenUrls = new Set();
    const processed = [];
    const nowIso = new Date().toISOString();

    for (const item of rawResults) {
      if (!item || !item.url) continue;

      // Validate URL
      if (!isValidHttpUrl(item.url)) continue;

      // Normalize URL to deduplicate (strip trailing slash and query tracking params)
      const normalizedUrl = normalizeUrl(item.url);
      if (seenUrls.has(normalizedUrl)) continue;
      seenUrls.add(normalizedUrl);

      // Sanitize text snippets (treat all web content as untrusted data)
      const sanitizedTitle = sanitizeUntrustedContent(item.title || 'Web Search Result');
      const sanitizedContent = sanitizeUntrustedContent(item.content || item.snippet || '');

      processed.push({
        title: sanitizedTitle,
        url: item.url,
        snippet: sanitizedContent,
        publishedDate: item.published_date || null,
        retrievalTimestamp: nowIso,
        score: typeof item.score === 'number' ? item.score : 1.0,
        sourceMetadata: {
          originalQuery,
          domain: getDomain(item.url),
        },
      });
    }

    return processed;
  }
}

/**
 * Validates that string is a valid HTTP/HTTPS URL
 */
export function isValidHttpUrl(string) {
  try {
    const parsed = new URL(string);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/**
 * Normalize URL for deduplication
 */
export function normalizeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    // Strip common tracking parameters
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid'].forEach(
      (param) => parsed.searchParams.delete(param)
    );
    let href = parsed.toString();
    if (href.endsWith('/')) {
      href = href.slice(0, -1);
    }
    return href.toLowerCase();
  } catch (_) {
    return rawUrl.trim().toLowerCase();
  }
}

/**
 * Extract domain name from URL
 */
function getDomain(urlStr) {
  try {
    return new URL(urlStr).hostname;
  } catch (_) {
    return 'unknown';
  }
}

/**
 * Sanitize untrusted web content:
 * - Strip potential prompt injection delimiters (system instructions markers)
 * - Strip script/html tags
 * - Normalize excessive whitespace
 */
export function sanitizeUntrustedContent(content) {
  if (!content || typeof content !== 'string') return '';

  return content
    // Remove script tags and html tags
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    // Defuse prompt injection tags or simulated chat delimiters
    .replace(/<\|im_start\|>/gi, '')
    .replace(/<\|im_end\|>/gi, '')
    .replace(/\[SYSTEM_INSTRUCTION\]/gi, '')
    .replace(/\[INSTRUCTION\]/gi, '')
    .replace(/```(?:system|admin)/gi, '```text')
    // Normalize spaces
    .replace(/\s+/g, ' ')
    .trim();
}
