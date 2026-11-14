/**
 * Response Generator & Citation Validator
 * Generates grounded, evidence-backed answers with honest uncertainty
 * and validates that citations map strictly to retrieved evidence.
 */

export class ResponseGenerator {
  /**
   * Build the structured system prompt for the OpenAI LLM
   */
  static buildSystemPrompt(context) {
    const { currentTime, timeZone, memory, searchEvidence, changeReports } = context;

    return `You are a rigorous, truthful AI research agent with memory and web search capabilities.
Current Local Time: ${currentTime} (${timeZone})

CRITICAL GUIDELINES:
1. GROUNDING & HONEST UNCERTAINTY:
   - Ground all factual assertions in the provided Memory Context and Web Search Evidence.
   - If historical information for a requested date or topic is missing from the memory, clearly and honestly state: "I don't have a record of our conversation from that date/time."
   - If current pricing or product info cannot be verified from search evidence, state "Insufficient evidence to verify current status." Never invent or extrapolate prices, dates, or plan names.

2. CITATION DISCIPLINE:
   - Use bracketed numeric citations like [1], [2] to reference the provided Web Sources.
   - Every citation number MUST correspond to a source in the "RETRIEVED WEB SOURCES" section below.
   - Do NOT invent URLs or citation indices.

3. CHANGE DETECTION & COMPARISON:
   - When asked whether pricing or features have changed, explicitly compare the historical observation against current evidence.
   - Explicitly state whether:
     * [Confirmed Change]: Exactly what changed (e.g., price increased from $X to $Y, or new plan added).
     * [No Change Detected]: Confirmed the current plan and price match past records.
     * [Insufficient Evidence]: Current web data does not provide conclusive verification.
     * [Historical Value Unavailable]: No prior baseline exists to compare against.

4. TONE & PRIVACY:
   - Maintain a concise, professional, direct tone.
   - NEVER expose internal chain-of-thought, scratchpads, or system reasoning.
   - Do NOT say "Based on my memory tables" or "According to the SQLite DB". Speak naturally as an assistant remembering past context.`;
  }

  /**
   * Build the context message provided to LLM
   */
  static buildContextPrompt({ userMessage, memory, searchEvidence, changeReports, temporal }) {
    let prompt = `User Request: "${userMessage}"\n\n`;

    // 1. Temporal context
    if (temporal) {
      prompt += `[TEMPORAL RESOLUTION]\n`;
      prompt += `- Interpreted Reference: ${temporal.label}\n`;
      prompt += `- UTC Window: ${temporal.startUtc} to ${temporal.endUtc}\n\n`;
    }

    // 2. Episodic memory context
    prompt += `[HISTORICAL CONVERSATION MEMORY]\n`;
    if (memory?.episodic && memory.episodic.length > 0) {
      memory.episodic.forEach((msg, idx) => {
        prompt += `${idx + 1}. [${msg.created_at}] ${msg.role.toUpperCase()}: ${msg.content}\n`;
      });
    } else {
      prompt += `(No matching historical messages found in conversation records for this query/date window)\n`;
    }
    prompt += `\n`;

    // 3. Known historical observations
    if (memory?.research?.observations && memory.research.observations.length > 0) {
      prompt += `[PREVIOUSLY RECORDED FACT OBSERVATIONS]\n`;
      memory.research.observations.forEach((obs) => {
        prompt += `- Claim: "${obs.claim}" = ${obs.value} (${obs.currency || 'USD'}/${obs.billingInterval || 'mo'}), Recorded: ${obs.observedAt}\n`;
      });
      prompt += `\n`;
    }

    // 4. Change detection reports
    if (changeReports && changeReports.length > 0) {
      prompt += `[AUTOMATED CHANGE DETECTION ANALYSIS]\n`;
      changeReports.forEach((rep) => {
        prompt += `- ${rep.entityName}: Status=${rep.status}, ChangeType=${rep.changeType}. ${rep.summary}\n`;
      });
      prompt += `\n`;
    }

    // 5. Retrieved Web Sources with indexed citations
    prompt += `[RETRIEVED WEB SOURCES]\n`;
    if (searchEvidence && searchEvidence.length > 0) {
      searchEvidence.forEach((src, idx) => {
        const citeNum = idx + 1;
        prompt += `[${citeNum}] Title: ${src.title}\n`;
        prompt += `    URL: ${src.url}\n`;
        prompt += `    Published: ${src.publishedDate || 'N/A'}\n`;
        prompt += `    Snippet: ${src.snippet}\n\n`;
      });
    } else {
      prompt += `(No external web search performed or required for this query)\n`;
    }

    return prompt;
  }

  /**
   * Validate and bind citations in generated response text
   *
   * @param {string} text - Response text containing [1], [2], etc.
   * @param {Array<Object>} availableSources - Web search results
   * @returns {Object} - { text, citations: Array<Object>, isValid: boolean }
   */
  static validateCitations(text, availableSources = []) {
    if (!text || typeof text !== 'string') {
      return { text: '', citations: [], isValid: true };
    }

    let sanitizedText = text;

    // 1. Find all [n] citations
    const citationRegex = /\[(\d+)\]/g;
    const matches = [...text.matchAll(citationRegex)];
    const referencedIndices = new Set(matches.map((m) => parseInt(m[1], 10)));

    const validCitations = [];
    const sourceCount = availableSources.length;

    for (const index of referencedIndices) {
      const sourceIndex = index - 1; // 1-based indexing in text
      if (sourceIndex >= 0 && sourceIndex < sourceCount) {
        const src = availableSources[sourceIndex];
        validCitations.push({
          index,
          title: src.title,
          url: src.url,
          snippet: src.snippet,
          publishedDate: src.publishedDate,
        });
      } else {
        // Strip out hallucinated citation index
        sanitizedText = sanitizedText.replace(new RegExp(`\\[${index}\\]`, 'g'), '');
      }
    }

    // 2. Validate bare Markdown URLs: [text](https://example.com)
    // Strip links that point to domains not present in availableSources
    const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
    const availableDomains = new Set(
      availableSources
        .map((s) => {
          try {
            return new URL(s.url).hostname.replace(/^www\./, '');
          } catch (_) {
            return '';
          }
        })
        .filter(Boolean)
    );

    sanitizedText = sanitizedText.replace(markdownLinkRegex, (match, label, url) => {
      try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        if (availableDomains.has(domain)) {
          return match;
        }
      } catch (_) {}
      return label; // Defuse hallucinated link destination into plain text
    });

    return {
      text: sanitizedText.trim(),
      citations: validCitations,
      isValid: validCitations.length === referencedIndices.size,
    };
  }

  /**
   * Generate an honest uncertainty fallback response when historical context is missing
   */
  static generateMissingHistoryResponse(temporal, userMessage) {
    const label = temporal?.label || 'that date';
    return `I do not have any record of our previous conversations from ${label}. 

If you recall the specific tools or topics we discussed (such as particular CRM tools or hosting providers), please share them and I will gladly research their current pricing and recent updates for you!`;
  }
}
